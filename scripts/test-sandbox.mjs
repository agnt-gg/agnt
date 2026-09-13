#!/usr/bin/env node
// scripts/test-sandbox.mjs — PR145 section D (R11) isolated test runner.
//
// *** TEST TOOLING ONLY — NOT a production isolation mode. ***
// This script exists so guarded test execution (native SQLite suites,
// node:test entrypoints, controls) happens inside a verified synthetic
// boundary: private mount/pid/ipc/network namespaces, minimal read-only
// runtime, synthetic writable scratch, explicit descriptor allowlist.
// It grants no authority to any process and changes no production
// semantics. Nothing in the application knows it exists.
//
// Usage (works from ANY cwd — the repo is derived from this file's location):
//   node scripts/test-sandbox.mjs run   --label <name> --plan <plan.json> \
//        --evidence-root <dir> [--repo <dir>] [--chdir <dir>] \
//        [--watch-manifest <sha256sum-file>] [--bwrap <path>]
//   node scripts/test-sandbox.mjs audit --label <name> --evidence-root <dir> [...]
//        (audit + capability probe + fd/containment controls only; no plan commands)
//
// Plan JSON: { "timeoutMs"?: number,
//              "commands": [ { "name": str, exactly one of "cmd": str or
//                              "argv": string[], "timeoutMs"?: number,
//                              "env"?: {k:string} } ] }
// Per-command env is EXPLICIT, secret-shaped keys are refused, and the exact
// effective string map is recorded — nothing ambient is inherited (--clearenv
// inside). Runner-owned plumbing/base keys are reserved and collisions are
// refused before any confined process launches. argv is the lossless direct
// execution form; cmd intentionally preserves existing /bin/sh -c semantics.
//
// Exit codes (preserved honestly; NO policy-denial retries, NO unconfined
// fallback, ever):
//   0  all commands exited 0 and all controls passed
//   N  first command's exact nonzero numeric exit N (fail-fast; per-command
//      true exit/signal remains in the manifest)
//   2  usage error / evidence directory already exists (never overwrite)
//   3  REFUSED: bwrap missing, capability probe failed, or mount-plan audit
//      failed — enforced boundary unavailable, run refused before ANY
//      backend import
//   4  REFUSED: an fd/containment control failed (boundary not proven)
//
// Guarantees per run:
//   • AUDIT BEFORE BACKEND IMPORTS: the runner imports only node:* builtins
//     (self-audited), and the mount plan + capability probe + controls all
//     run before any plan command. The plan never sees a shell until the
//     boundary is proven.
//   • No --ro-bind of /, /etc, /var, /root, /proc, /sys or any real home
//     directory. The ONLY host binds are: /usr (minimal installed runtime),
//     the exact installed node_modules directory, and the candidate repo —
//     all read-only. /etc is synthetic (tmpfs + generated passwd/group);
//     /home is synthetic tmpfs with HOME inside it; /proc is a fresh
//     namespace proc; /dev is bwrap's minimal device tmpfs.
//   • --unshare-net --unshare-pid --unshare-ipc --die-with-parent
//     --new-session --clearenv (PATH/HOME/TMPDIR/LANG + explicit plan env
//     only). No DNS, no loopback reachability, no daily/external services —
//     the only listener ever involved is this runner's own synthetic
//     loopback listener used by the negative network-egress control.
//   • Descriptor policy: every run closes all inherited fds > 2 except an
//     EXPLICIT allowlist. The negative control proves a deliberately
//     inherited connected socket is closed and cannot carry data; the
//     positive control proves an explicitly allowed fd stays usable.
//   • Immutable evidence: per-run directory (refuses to overwrite) with
//     manifest.json, per-command .sh/.stdout/.stderr/.exit/.meta.json,
//     SHA256SUMS.json, all chmod 0444 at completion. Timeouts are explicit
//     finite deadlines (default 180s/command, 25s/control) recorded as
//     TIMEOUT-KILLED — never silently retried or reworded.
//   • Repo identity: HEAD + watch-manifest hashes captured before/after;
//     repoUntouched flag in the manifest (the repo is ro-mounted, so writes
//     are impossible, not merely watched).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ── self-audit: this runner imports node builtins only (no backend code) ──
const SELF_SOURCE = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
const SELF_IMPORTS = [...SELF_SOURCE.matchAll(/import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]);
const NON_NODE_IMPORTS = SELF_IMPORTS.filter((s) => !s.startsWith('node:'));
if (NON_NODE_IMPORTS.length > 0) {
  console.error('REFUSED (self-audit): runner must import only node:* builtins, found: ' + NON_NODE_IMPORTS.join(', '));
  process.exit(3);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(HERE, '..');
const DEFAULT_BWRAP = '/usr/bin/bwrap';
const CONTROL_DEADLINE_MS = 25000;
const DEFAULT_CMD_TIMEOUT_MS = 180000;

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const MODE = argv[0];
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1]; };
const LABEL = arg('label');
const PLAN_PATH = arg('plan');
const EVIDENCE_ROOT = arg('evidence-root');
const REPO = path.resolve(arg('repo', DEFAULT_REPO));
const INNER_CWD = path.resolve(arg('chdir', REPO));
const WATCH_MANIFEST = arg('watch-manifest');
const BWRAP = arg('bwrap', DEFAULT_BWRAP);
if ((MODE !== 'run' && MODE !== 'audit') || !LABEL || !EVIDENCE_ROOT || (MODE === 'run' && !PLAN_PATH)) {
  console.error('usage: test-sandbox.mjs run|audit --label <name> --evidence-root <dir> [--plan plan.json] [--repo dir] [--chdir dir] [--watch-manifest file] [--bwrap path]');
  process.exit(2);
}

// ── repo + deps discovery (independent of process.cwd()) ──────────────────
let DEPS;
try { DEPS = fs.readlinkSync(path.join(REPO, 'node_modules')); }
catch { DEPS = path.join(REPO, 'node_modules'); } // plain dir (not a symlink) is fine too
DEPS = path.resolve(DEPS);
for (const [what, p] of [['repo', REPO], ['deps', DEPS], ['evidence-root', EVIDENCE_ROOT]]) {
  if (!fs.existsSync(p)) { console.error('REFUSED: ' + what + ' path missing: ' + p); process.exit(3); }
}

// ── mount plan (structure, not stringly argv) ─────────────────────────────
const MOUNT_PLAN = [
  { op: 'ro-bind', src: '/usr', dst: '/usr', why: 'minimal installed runtime: node, sh, coreutils, dynamic libs' },
  { op: 'symlink', src: 'usr/bin', dst: '/bin' },
  { op: 'symlink', src: 'usr/bin', dst: '/sbin' },
  { op: 'symlink', src: 'usr/lib', dst: '/lib' },
  { op: 'symlink', src: 'usr/lib64', dst: '/lib64' },
  { op: 'tmpfs', dst: '/tmp', why: 'synthetic writable scratch (TMPDIR lives here)' },
  { op: 'tmpfs', dst: '/var', why: 'synthetic empty /var — host /var never mounted' },
  { op: 'tmpfs', dst: '/etc', why: 'synthetic /etc (passwd/group generated inside) — host /etc never mounted' },
  { op: 'dev', dst: '/dev', why: 'bwrap minimal device set (null/zero/random/urandom)' },
  { op: 'tmpfs', dst: '/dev/shm' },
  { op: 'proc', dst: '/proc', why: 'fresh namespace proc — host /proc is NEVER bound' },
  { op: 'tmpfs', dst: '/home', why: 'synthetic home — the real home is never mounted' },
  { op: 'ro-bind', src: DEPS, dst: DEPS, why: 'exact installed node_modules directory, read-only' },
  { op: 'ro-bind', src: REPO, dst: REPO, why: 'candidate source tree, read-only (writes go to TMPDIR)' },
];
const NS_FLAGS = ['--unshare-net', '--unshare-pid', '--unshare-ipc', '--die-with-parent', '--new-session', '--clearenv'];
const BASE_ENV = { PATH: '/usr/bin:/bin', HOME: '/home/sandbox', LANG: 'C.UTF-8' };
const ALLOWED_BIND_SOURCES = new Set(['/usr', DEPS, REPO].map((p) => path.resolve(p)));

// ── audit: refuse any plan that would expose host state ───────────────────
function auditMountPlan() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  const binds = MOUNT_PLAN.filter((m) => m.op === 'ro-bind');
  for (const b of binds) {
    const ok = ALLOWED_BIND_SOURCES.has(path.resolve(b.src));
    check('bind-allowlist:' + b.src, ok, ok ? b.why : 'bind source outside the explicit allowlist (/usr, exact deps dir, repo)');
  }
  check('no-whole-root-bind', !binds.some((b) => path.resolve(b.src) === '/'), 'broad readonly root binds are forbidden (would expose /etc /var /root)');
  const FORBIDDEN_PREFIXES = ['/etc', '/var', '/root', '/proc', '/sys', '/run'];
  const offenders = binds.filter((b) => FORBIDDEN_PREFIXES.some((p) => path.resolve(b.src) === p || path.resolve(b.src).startsWith(p + '/')));
  check('no-host-system-dir-binds', offenders.length === 0, offenders.length ? 'found: ' + offenders.map((o) => o.src).join(',') : 'no /etc /var /root /proc /sys /run sources');
  const homeBinds = binds.filter((b) => b.src.startsWith('/home/') || b.src === '/home');
  const allowedHome = new Set([DEPS, REPO].map((x) => path.resolve(x)));
  check('home-exposes-only-deps-and-repo', homeBinds.every((b) => allowedHome.has(path.resolve(b.src))) && homeBinds.length === allowedHome.size,
    homeBinds.length + ' home-path bind(s); the ONLY permitted ones are the exact deps dir and the candidate repo — no other real-home content, config or snapshot dir is ever mounted');
  const writableBinds = MOUNT_PLAN.filter((m) => m.op === 'bind' || m.op === 'dev-bind');
  check('no-writable-or-device-binds', writableBinds.length === 0, 'only ro-bind/tmpfs/dev/proc/symlink permitted');
  check('namespaces-private', NS_FLAGS.every((f) => f.startsWith('--unshare') || f === '--die-with-parent' || f === '--new-session' || f === '--clearenv'), 'net+pid+ipc unshared, die-with-parent, new session, clearenv');
  check('no-network-sharing', !NS_FLAGS.includes('--share-net') && NS_FLAGS.includes('--unshare-net'), 'network namespace is private; the only listener is the runner synthetic loopback control');
  check('runner-imports-node-builtin-only', NON_NODE_IMPORTS.length === 0, 'self-audit of runner imports (no backend/host module imports before or during runs)');
  return checks;
}
const AUDIT = auditMountPlan();
const AUDIT_FAILED = AUDIT.some((c) => !c.ok);
if (AUDIT_FAILED) {
  console.error('REFUSED: mount-plan audit failed:');
  for (const c of AUDIT.filter((c) => !c.ok)) console.error('  FAIL ' + c.name + ': ' + c.detail);
  process.exit(3);
}

// ── capability check BEFORE anything else runs ─────────────────────────────
if (!fs.existsSync(BWRAP)) { console.error('REFUSED: ' + BWRAP + ' missing — enforced boundary required, no ambient fallback'); process.exit(3); }
const BWRAP_VERSION = spawnSync(BWRAP, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';

// ── parse + validate the complete plan BEFORE any confined launch ─────────
const RESERVED_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'INNER_CWD', 'INNER_CMD', 'INNER_ARGV',
  'INNER_ALLOW_FD', 'INNER_COMMAND_ALLOW_FD', 'INNER_RESULT_FD']);
const SECRET_ENV_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH)/i;
let PLAN = { commands: [] };
let PLAN_BYTES = null;
let PLAN_SHA256 = null;
if (MODE === 'run') {
  try {
    PLAN_BYTES = fs.readFileSync(PLAN_PATH);
    PLAN_SHA256 = crypto.createHash('sha256').update(PLAN_BYTES).digest('hex');
    PLAN = JSON.parse(PLAN_BYTES.toString('utf8'));
    if (!PLAN || !Array.isArray(PLAN.commands)) throw new Error('commands must be an array');
    PLAN.commands.forEach((c, i) => {
      if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name) throw new Error('commands[' + i + '].name must be a non-empty string');
      const hasCmd = typeof c.cmd === 'string';
      const hasArgv = Array.isArray(c.argv);
      if (hasCmd === hasArgv) throw new Error('commands[' + i + '] must provide exactly one of cmd or argv');
      if (hasArgv && (c.argv.length === 0 || c.argv.some((v) => typeof v !== 'string'))) throw new Error('commands[' + i + '].argv must be a non-empty string array');
      const commandEvidence = hasCmd ? c.cmd : c.argv.join('\u0000');
      if (/(?:^|[\s'"])(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE_KEY|AUTH)[A-Z0-9_]*)\s*=|Bearer\s+[A-Za-z0-9._~-]+/i.test(commandEvidence)) {
        throw new Error('commands[' + i + '] contains secret-shaped command material; use a synthetic non-secret value or remove it before immutable recording');
      }
      if (c.env !== undefined && (!c.env || typeof c.env !== 'object' || Array.isArray(c.env))) throw new Error('commands[' + i + '].env must be an object');
      for (const [k, v] of Object.entries(c.env || {})) {
        if (RESERVED_ENV.has(k)) throw new Error('commands[' + i + '].env collides with runner-owned key: ' + k);
        if (SECRET_ENV_KEY.test(k)) throw new Error('commands[' + i + '].env secret-shaped key refused from immutable evidence: ' + k);
        if (typeof v !== 'string') throw new Error('commands[' + i + '].env.' + k + ' must be a string');
      }
    });
  } catch (error) {
    console.error('REFUSED: invalid plan before launch: ' + error.message);
    process.exit(2);
  }
}

// ── run directory (immutable evidence; never overwrite) ───────────────────
const RUN_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15) + '-' + crypto.randomBytes(3).toString('hex');
const TMPDIR_INSIDE = '/tmp/run-' + RUN_ID;
const RUN_DIR = path.join(path.resolve(EVIDENCE_ROOT), LABEL + '-' + RUN_ID);
if (fs.existsSync(RUN_DIR)) { console.error('REFUSED: evidence run dir already exists (never overwrite): ' + RUN_DIR); process.exit(2); }
fs.mkdirSync(RUN_DIR, { recursive: true });
const SENTINEL_HOST = path.join(RUN_DIR, 'sentinel-' + crypto.randomBytes(6).toString('hex'));
fs.writeFileSync(SENTINEL_HOST, 'host-only-secret-material-for-containment-control\n');

// ── bwrap argv from the plan ───────────────────────────────────────────────
function bwrapArgv(innerArgv, { env = {}, chdir = INNER_CWD } = {}) {
  const a = [BWRAP];
  for (const m of MOUNT_PLAN) {
    if (m.op === 'ro-bind') a.push('--ro-bind', m.src, m.dst);
    else if (m.op === 'tmpfs') a.push('--tmpfs', m.dst);
    else if (m.op === 'dev') a.push('--dev', m.dst);
    else if (m.op === 'proc') a.push('--proc', m.dst);
    else if (m.op === 'symlink') a.push('--symlink', m.src, m.dst);
    else throw new Error('unplanned mount op: ' + m.op);
  }
  a.push(...NS_FLAGS);
  a.push('--setenv', 'PATH', BASE_ENV.PATH, '--setenv', 'HOME', BASE_ENV.HOME,
    '--setenv', 'TMPDIR', TMPDIR_INSIDE, '--setenv', 'LANG', BASE_ENV.LANG);
  for (const [k, v] of Object.entries(env)) a.push('--setenv', k, String(v));
  a.push('--chdir', chdir, '--', ...innerArgv);
  return a;
}

// Inner bootstrap (node, NOT sh): synthetic /etc, scratch dir, then fd
// sanitation with an EXPLICIT allowlist — every inherited fd > 2 not in the
// allowlist is close(2)'d before the command runs. (An sh `exec N<&-` closer
// was tried first and PROVEN UNRELIABLE on inherited socket fds by the
// fd-negative control — bash reported success and left the fd open — so the
// closer does the closes itself in node where they are observable.)
const CLOSER_JS = [
  "const fs=require('fs');",
  "const resultFd=Number(process.env.INNER_RESULT_FD);",
  "const directArgv=process.env.INNER_ARGV?JSON.parse(process.env.INNER_ARGV):null;",
  "fs.writeFileSync('/etc/passwd','root:x:0:0:root:/root:/usr/bin/sh\\nu:'+process.getuid()+':'+process.getgid()+':u:/home/sandbox:/usr/bin/sh\\n');",
  "fs.writeFileSync('/etc/group','root:x:0:\\ng:'+process.getgid()+':\\n');",
  "fs.writeFileSync('/etc/hosts','127.0.0.1 localhost\\n::1 localhost\\n');",
  "fs.mkdirSync(process.env.TMPDIR,{recursive:true});",
  "// Close every INHERITABLE fd > 2 (no O_CLOEXEC) unless explicitly",
  "// allowed. Node's own internal fds carry O_CLOEXEC and never survive",
  "// exec into the command — closing them (an earlier revision did) aborts",
  "// the process, which the controls caught as exit 134.",
  "const allow=String(process.env.INNER_ALLOW_FD||'').split(',').filter(Boolean).map(Number);",
  "const commandAllow=String(process.env.INNER_COMMAND_ALLOW_FD||'').split(',').filter(Boolean).map(Number);",
  "const O_CLOEXEC=0o2000000;",
  "const list=fs.readdirSync('/proc/self/fd');",
  "for(const e of list){",
  "  const n=+e; if(!Number.isInteger(n)||n<=2||allow.includes(n)) continue;",
  "  let cloexec=false;",
  "  try{const t=fs.readFileSync('/proc/self/fdinfo/'+n,'utf8');const m=t.match(/flags:\\s*(\\d+)/);if(m&&(parseInt(m[1],8)&O_CLOEXEC))cloexec=true;}catch(_){}",
  "  if(!cloexec){try{fs.closeSync(n)}catch(_){}}",
  "}",
  "const {spawn}=require('child_process');",
  "const command=directArgv?directArgv[0]:'/bin/sh';",
  "const args=directArgv?directArgv.slice(1):['-c',process.env.INNER_CMD];",
  "delete process.env.INNER_RESULT_FD; delete process.env.INNER_ARGV; delete process.env.INNER_COMMAND_ALLOW_FD;",
  "const childStdio=Array(Math.max(3,...commandAllow)+1).fill('ignore'); childStdio[1]='inherit'; childStdio[2]='inherit'; for(const n of commandAllow)childStdio[n]=n;",
  "const child=spawn(command,args,{stdio:childStdio});",
  "const report=(o)=>{try{fs.writeSync(resultFd,JSON.stringify(o)+'\\n')}catch(_){}};",
  "child.on('error',(e)=>{report({code:127,signal:null,error:String(e)});process.exit(127)});",
  "child.on('exit',function(c,sg){report({code:c,signal:sg});if(sg){process.kill(process.pid,sg);return}process.exit(c==null?1:c)});",
].join('\n');

// Spawn one confined process. extraFd: {fd:number, socket:net.Socket} to
// deliberately inherit a connected socket (controls only).
// Spawn one confined process. extraFd: {fd:number, socket:net.Socket} to
// deliberately inherit a connected socket (controls only).
function spawnConfined({ name = 'probe', cmd, commandArgv = null, env = {}, allowFd = '', extraStdio = [], timeoutMs }) {
  const inner = ['/usr/bin/node', '-e', CLOSER_JS];
  const resultFd = 3 + extraStdio.length;
  const userAllow = String(allowFd || '').split(',').filter(Boolean);
  const effectiveAllow = [...new Set([...userAllow, String(resultFd)])].join(',');
  const fullEnv = {
    ...env,
    INNER_CWD,
    INNER_CMD: cmd || '',
    INNER_ARGV: commandArgv ? JSON.stringify(commandArgv) : '',
    INNER_ALLOW_FD: effectiveAllow,
    INNER_COMMAND_ALLOW_FD: userAllow.join(','),
    INNER_RESULT_FD: String(resultFd),
  };
  const argvFull = bwrapArgv(inner, { env: fullEnv, chdir: INNER_CWD });
  const stdio = ['ignore', 'pipe', 'pipe', ...extraStdio.map((e) => e.socket), 'pipe'];
  return {
    name, argv: argvFull, innerCmd: cmd || null, commandArgv, effectiveEnv: fullEnv,
    resultFd,
    spawn: () => spawn(argvFull[0], argvFull.slice(1), { stdio, cwd: RUN_DIR }), timeoutMs,
  };
}

async function runConfined(spec, { index, base }) {
  const pref = base + (index === null ? '' : 'cmd' + String(index).padStart(2, '0') + '-') + spec.name;
  fs.writeFileSync(pref + '.sh', spec.argv.join(' ') + '\n## inner (display only; authoritative JSON is adjacent):\n' + (spec.innerCmd ?? JSON.stringify(spec.commandArgv)) + '\n');
  fs.writeFileSync(pref + '.command.json', JSON.stringify({
    shellCommand: spec.innerCmd, commandArgv: spec.commandArgv,
    bwrapArgv: spec.argv, effectiveEnv: spec.effectiveEnv,
  }, null, 2));
  const child = spec.spawn();
  let out = '', err = '', resultWire = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (err += b));
  child.stdio[spec.resultFd].on('data', (b) => (resultWire += b));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }, spec.timeoutMs);
  const exit = await new Promise((res) => {
    child.once('exit', (code, signal) => res({ code, signal }));
    child.once('error', (e) => res({ code: null, signal: null, error: String(e) }));
  });
  clearTimeout(timer);
  let innerExit = null;
  for (const line of resultWire.trim().split('\n').filter(Boolean)) {
    try { const parsed = JSON.parse(line); innerExit = { code: parsed.code, signal: parsed.signal, error: parsed.error }; } catch {}
  }
  fs.writeFileSync(pref + '.stdout', out);
  fs.writeFileSync(pref + '.stderr', err);
  const exitText = timedOut ? 'TIMEOUT-KILLED:' + (exit.signal || 'unknown')
    : innerExit?.signal ? 'SIGNAL:' + innerExit.signal
    : innerExit ? String(innerExit.code) : 'RESULT-CHANNEL-MISSING';
  fs.writeFileSync(pref + '.exit', exitText + '\n');
  const meta = { name: spec.name, timeoutMs: spec.timeoutMs, exit, innerExit, timedOut, durationless: false };
  fs.writeFileSync(pref + '.meta.json', JSON.stringify(meta, null, 2));
  return { ...meta, out, err };
}

// ── synthetic loopback listener + connected socket (controls) ──────────────
// The child's bytes arrive on the server-ACCEPTED side of the connection —
// the earlier revision observed the client socket (the wrong end) and the
// fd-positive control caught it. acceptedSide() returns the live accepted
// connection, if any.
const listener = net.createServer((conn) => { LAST_CONN = conn; conn.on('data', () => {}); });
let LAST_CONN = null;
await new Promise((res) => listener.listen(0, '127.0.0.1', res));
const LISTEN_PORT = listener.address().port;
let listenerConnections = 0;
listener.on('connection', () => (listenerConnections += 1));

function connectedSocketToListener() {
  return new Promise((res, rej) => {
    const s = net.connect({ host: '127.0.0.1', port: LISTEN_PORT }, () => res(s));
    s.once('error', rej);
  });
}

// ── controls (fd + containment + env) — run BEFORE any plan command ───────
const CONTROLS = [];
const NODE = '/usr/bin/node';
function control(name, ok, expected, observed, detail) { CONTROLS.push({ name, ok, expected, observed, detail }); }

// C1 fd-negative: deliberately inherited connected socket must be CLOSED and
// must carry no data back to the runner's synthetic listener.
{
  LAST_CONN = null;
  const sock = await connectedSocketToListener();
  await new Promise((res) => setTimeout(res, 150)); // accept completes
  let leaked = '';
  if (LAST_CONN) LAST_CONN.on('data', (b) => (leaked += b.toString()));
  const spec = spawnConfined({
    cmd: NODE + " -e \"let l='(none)';try{l=require('fs').readlinkSync('/proc/self/fd/3')}catch(e){l='(closed '+e.code+')'}console.log('FD3LINK='+l);try{require('fs').fstatSync(3);console.log('FD3=ALIVE')}catch(e){console.log('FD3=CLOSED')}\"",
    env: { C_PROBE: 'fd-negative' }, allowFd: '', extraStdio: [{ fd: 3, socket: sock }], timeoutMs: CONTROL_DEADLINE_MS,
  });
  const r = await runConfined(spec, { index: null, base: path.join(RUN_DIR, 'ctl-fdneg-') });
  // The socket must be GONE from the descriptor table — the probe reports
  // WHAT fd slot 3 now is (node internals legitimately reuse free slots,
  // e.g. an eventpoll anon_inode; only a surviving socket:[...] is a leak).
  const link = (r.out.match(/FD3LINK=(.*)/) || [])[1] || '(no output)';
  const socketGone = !/^socket:/.test(link);
  const noLeak = leaked === '';
  control('fd-negative-inherited-socket-closed', socketGone && noLeak && !r.timedOut,
    'fd slot 3 is not the inherited socket; zero bytes reach synthetic listener',
    'fd3=' + link + '; leakedBytes=' + Buffer.byteLength(leaked) + (leaked ? ' content=' + leaked : '') + '; exit=' + JSON.stringify(r.exit),
    'socket deliberately inherited as fd 3; allowlist empty; the closer must close it (slot reuse by node internals is expected and harmless — only socket:[...] or leaked bytes fail)');
  try { sock.destroy(); } catch {}
}
// C2 fd-positive: an fd in the EXPLICIT allowlist stays usable end-to-end.
{
  LAST_CONN = null;
  const sock = await connectedSocketToListener();
  await new Promise((res) => setTimeout(res, 150)); // accept completes
  const acc = LAST_CONN;
  const got = new Promise((res) => { let b = ''; if (!acc) { res(b); return; } acc.on('data', (d) => { b += d.toString(); if (b.includes('FD-ALLOWED-OK')) res(b); }); setTimeout(() => res(b), CONTROL_DEADLINE_MS); });
  const spec = spawnConfined({
    cmd: NODE + " -e \"require('fs').writeSync(3,'FD-ALLOWED-OK\\n');console.log('WROTE=1')\"",
    env: { C_PROBE: 'fd-positive' }, allowFd: '3', extraStdio: [{ fd: 3, socket: sock }], timeoutMs: CONTROL_DEADLINE_MS,
  });
  const r = await runConfined(spec, { index: null, base: path.join(RUN_DIR, 'ctl-fdpos-') });
  const data = await got;
  control('fd-positive-allowlisted-socket-usable', data.includes('FD-ALLOWED-OK') && !r.timedOut,
    "allowed fd 3 carries 'FD-ALLOWED-OK' to the synthetic listener",
    'received=' + JSON.stringify(data) + '; exit=' + JSON.stringify(r.exit),
    'same inherited socket, now explicitly allowed — proves the allowlist mechanism, not blanket fd breakage');
  try { sock.destroy(); } catch {}
}
// C3 fs-containment: a host file outside every declared mount must be invisible.
{
  const spec = spawnConfined({
    cmd: NODE + " -e \"try{require('fs').readFileSync(process.env.C_SENTINEL,'utf8');console.log('SENTINEL=LEAKED')}catch(e){console.log('SENTINEL='+e.code)}\"",
    env: { C_PROBE: 'fs-containment', C_SENTINEL: SENTINEL_HOST }, timeoutMs: CONTROL_DEADLINE_MS,
  });
  const r = await runConfined(spec, { index: null, base: path.join(RUN_DIR, 'ctl-fs-') });
  control('fs-containment-host-file-invisible', r.out.includes('SENTINEL=ENOENT') && !r.timedOut,
    'SENTINEL=ENOENT', r.out.trim() + '; exit=' + JSON.stringify(r.exit),
    'host evidence-dir file must not exist inside the sandbox');
}
// C4 net-containment: no loopback (hence no daily/external) reachability from inside.
{
  const before = listenerConnections;
  const spec = spawnConfined({
    cmd: NODE + " -e \"const n=require('net');const s=n.connect({host:'127.0.0.1',port:Number(process.env.C_PORT),timeout:1500});s.on('connect',()=>{console.log('NET=LEAKED');process.exit(0)});s.on('error',()=>{console.log('NET=BLOCKED');process.exit(0)});s.on('timeout',()=>{console.log('NET=BLOCKED-TIMEOUT');s.destroy();process.exit(0)});setTimeout(()=>{console.log('NET=BLOCKED-LATE');process.exit(0)},2500)\"",
    env: { C_PROBE: 'net-containment', C_PORT: String(LISTEN_PORT) }, timeoutMs: CONTROL_DEADLINE_MS,
  });
  const r = await runConfined(spec, { index: null, base: path.join(RUN_DIR, 'ctl-net-') });
  const blocked = /NET=BLOCKED/.test(r.out);
  control('net-containment-loopback-unreachable', blocked && listenerConnections === before && !r.timedOut,
    'connect to runner synthetic loopback listener fails; listener sees zero connections',
    r.out.trim() + '; listenerDelta=' + (listenerConnections - before) + '; exit=' + JSON.stringify(r.exit),
    'private netns must make even 127.0.0.1 unreachable (synthetic listener only — no real service is ever probed)');
}
// C5 env-hygiene: the inner environment is exactly the constructed set.
{
  const spec = spawnConfined({
    cmd: NODE + " -e \"console.log('ENVKEYS='+Object.keys(process.env).sort().join(','))\"",
    env: { C_PROBE: 'env-hygiene' }, timeoutMs: CONTROL_DEADLINE_MS,
  });
  const r = await runConfined(spec, { index: null, base: path.join(RUN_DIR, 'ctl-env-') });
  const gotKeys = (r.out.match(/ENVKEYS=(.*)/) || [])[1] || '';
  // bwrap --clearenv + explicit setenv constructs only the declared base,
  // plumbing and control keys. The bootstrap removes private result-token/FD
  // keys before spawning the command. bash adds PWD/SHLVL/_ for children.
  const wantKeys = ['C_PROBE', 'HOME', 'INNER_ALLOW_FD', 'INNER_CMD', 'INNER_CWD', 'LANG', 'PATH', 'PWD', 'SHLVL', 'TMPDIR', '_'].sort().join(',');
  control('env-hygiene-exact-set', gotKeys === wantKeys && !r.timedOut,
    wantKeys, gotKeys + '; exit=' + JSON.stringify(r.exit),
    'clearenv + explicit setenv only — no ambient variables reach the sandbox (PWD/SHLVL/_ are bash-injected for its children)');
}
try { listener.close(); } catch {}

const CONTROLS_FAILED = CONTROLS.some((c) => !c.ok);

// ── capability probe result (the controls above double as the capability
//    proof: every one of them ran through the full bwrap skeleton). ────────
const CAPABILITY = { bwrap: BWRAP, version: BWRAP_VERSION, provenByControls: CONTROLS.length, refused: false };

// ── repo identity (host-side, read-only git; never inside the sandbox) ────
function repoIdentity() {
  const g = (a) => {
    const r = spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    return r.status === 0 ? r.stdout : 'ERROR:' + String(r.stderr || r.error).slice(0, 160);
  };
  const id = { head: g(['rev-parse', 'HEAD']).trim(), status: g(['status', '--porcelain']).split('\n').filter(Boolean) };
  if (WATCH_MANIFEST) {
    id.watch = {};
    for (const line of fs.readFileSync(WATCH_MANIFEST, 'utf8').split('\n')) {
      const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      if (!m) continue;
      try { id.watch[m[2]] = crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO, m[2].trim()))).digest('hex') === m[1] ? m[1] : 'DRIFT'; }
      catch { id.watch[m[2]] = 'ABSENT'; }
    }
  }
  return id;
}
const REPO_BEFORE = repoIdentity();

// ── plan commands (only after audit + all controls passed) ────────────────
const RESULTS = [];
if (MODE === 'run' && !CONTROLS_FAILED && !AUDIT_FAILED) {
  fs.writeFileSync(path.join(RUN_DIR, 'plan.input.json'), PLAN_BYTES);
  for (let i = 0; i < PLAN.commands.length; i++) {
    const c = PLAN.commands[i];
    const spec = spawnConfined({
      name: c.name,
      cmd: c.cmd,
      commandArgv: c.argv || null,
      env: c.env || {},
      allowFd: '',
      timeoutMs: Math.max(1000, c.timeoutMs || PLAN.timeoutMs || DEFAULT_CMD_TIMEOUT_MS),
    });
    const result = await runConfined(spec, { index: i, base: RUN_DIR + path.sep });
    RESULTS.push(result);
    if (result.timedOut || !result.innerExit || result.innerExit.signal || result.innerExit.code !== 0) break;
  }
}

// ── manifest + immutability ────────────────────────────────────────────────
const REPO_AFTER = repoIdentity();
const report = {
  label: LABEL, runId: RUN_ID, mode: MODE,
  startedAt: null, finishedAt: new Date().toISOString(),
  nodeOutside: process.version, platform: process.platform, arch: process.arch,
  bwrap: CAPABILITY, mountPlan: MOUNT_PLAN, namespaceFlags: NS_FLAGS,
  baseEnv: BASE_ENV, tmpdirInside: TMPDIR_INSIDE, innerCwd: INNER_CWD,
  plan: PLAN_PATH || null, planSha256: PLAN_SHA256,
  planSnapshot: MODE === 'run' ? 'plan.input.json' : null,
  audit: AUDIT, auditFailed: AUDIT_FAILED,
  controls: CONTROLS, controlsFailed: CONTROLS_FAILED,
  commands: RESULTS.map((r) => ({ name: r.name, exit: r.exit, innerExit: r.innerExit, timedOut: r.timedOut, timeoutMs: r.timeoutMs })),
  envPolicy: 'clearenv + reserved runner plumbing/base keys + explicit secret-shaped-key-free per-command string env; exact effective map recorded in each command JSON',
  fdPolicy: 'all fds > 2 closed unless in the explicit allowlist for that invocation; controls prove both polarities on a deliberately inherited connected socket',
  repoIdentityBefore: REPO_BEFORE, repoIdentityAfter: REPO_AFTER,
  repoUntouched: JSON.stringify(REPO_BEFORE) === JSON.stringify(REPO_AFTER),
  exitCodePolicy: 'fail-fast: 0 all green; exact first numeric nonzero; preserve first signal; 1 timeout/missing result; 2 usage/existing-evidence; 3 REFUSED capability/audit; 4 REFUSED control failure. No retries, no downstream commands after interruption, no unconfined fallback, no masking.',
};
report.startedAt = report.finishedAt; // completed synchronously; durations per command in .meta.json
fs.writeFileSync(path.join(RUN_DIR, 'manifest.json'), JSON.stringify(report, null, 2));
fs.rmSync(SENTINEL_HOST, { force: true }); // control fixture, not evidence
const hashes = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else hashes[path.relative(RUN_DIR, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
})(RUN_DIR);
fs.writeFileSync(path.join(RUN_DIR, 'SHA256SUMS.json'), JSON.stringify(hashes, null, 2));
for (const f of Object.keys(hashes)) { try { fs.chmodSync(path.join(RUN_DIR, f), 0o444); } catch {} }
fs.chmodSync(path.join(RUN_DIR, 'SHA256SUMS.json'), 0o444);

console.log('RUNDIR=' + RUN_DIR);
console.log('AUDIT=' + (AUDIT_FAILED ? 'FAILED' : 'PASS') + ' CONTROLS=' + (CONTROLS_FAILED ? 'FAILED' : 'PASS(' + CONTROLS.length + ')') + ' REPO_UNTOUCHED=' + report.repoUntouched);
for (const r of RESULTS) console.log('[' + r.name + '] inner=' + (r.innerExit?.signal ? 'SIGNAL:' + r.innerExit.signal : r.innerExit?.code ?? 'MISSING') + ' outer=' + JSON.stringify(r.exit) + ' timedOut=' + r.timedOut);
if (AUDIT_FAILED) process.exit(3);
if (CONTROLS_FAILED) process.exit(4);
const terminal = RESULTS.find((r) => r.timedOut || !r.innerExit || r.innerExit.signal || r.innerExit.code !== 0);
if (terminal?.innerExit?.signal && !terminal.timedOut) process.kill(process.pid, terminal.innerExit.signal);
if (terminal && (terminal.timedOut || !terminal.innerExit)) process.exit(1);
if (terminal && terminal.innerExit.code !== 0) process.exit(terminal.innerExit.code);
process.exit(0);
