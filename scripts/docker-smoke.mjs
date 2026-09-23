#!/usr/bin/env node
/**
 * Boot the container image AS AN OPERATOR WOULD and prove its auth boundary.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT THAT STARTS A CONTAINER, RATHER THAN ANOTHER UNIT TEST
 * ---------------------------------------------------------------------------
 * GitHub issue #144. The compose file shipped a published JWT_SECRET for eight
 * months; a change on 2026-08-19 made that string the thing tokens verified
 * against; and nothing between that commit and the report ever started the
 * image and sent it a request. The unit tests were green throughout, because
 * a unit test reads the middleware and a compose file — it does not run the
 * Dockerfile's ENV, the entrypoint's user switch, the volume's permissions or
 * the resolver's keyfile write. This does. It is the step that was skipped.
 *
 * Runs in CI on every image build (see .github/workflows/docker-build.yml)
 * and on a developer machine against a local build:
 *
 *   docker build -t agnt:smoke .
 *   node scripts/docker-smoke.mjs agnt:smoke
 *
 * With `--token <jwt>` (a genuine session token for the owner email you pass
 * as `--owner`) it also proves a real login is admitted, and with
 * `--stranger-token <jwt>` that a different genuine account is refused. CI has
 * no accounts, so those two are optional; everything else is asserted always.
 *
 * Exit status is non-zero on the first failed assertion, with the container
 * log attached. Never leaves a container or temp directory behind unless
 * `--keep` is given.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const image = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

if (!image) {
  console.error('usage: node scripts/docker-smoke.mjs <image> [--port N] [--owner email] [--token jwt] [--stranger-token jwt] [--keep]');
  process.exit(2);
}

const PORT = Number(opt('port', '33333'));
const OWNER = opt('owner', 'smoke-owner@example.test');
const OWNER_TOKEN = opt('token');
const STRANGER_TOKEN = opt('stranger-token');
const KEEP = flag('keep');
const NAME = `agnt-smoke-${process.pid}-${Date.now().toString(36)}`;
const PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION';
const EX_CONFIG = 78;

/** Data dir bind-mounted as /app/data, so the keyfile the container writes is inspectable. */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-docker-smoke-'));

let step = 0;
const failures = [];
const ok = (what) => console.log(`  ok   ${what}`);
const fail = (what, detail = '') => {
  failures.push(what);
  console.log(`  FAIL ${what}${detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''}`);
};
const section = (title) => console.log(`\n[${++step}] ${title}`);
const assert = (cond, what, detail) => (cond ? ok(what) : fail(what, detail));

function docker(cmdArgs, { timeoutMs = 120_000, input } = {}) {
  const r = spawnSync('docker', cmdArgs, { encoding: 'utf8', timeout: timeoutMs, input });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}

/** `docker run --rm` and wait for exit, bounded. Returns { code, out }. */
function runToExit(envPairs, timeoutMs = 90_000) {
  const cmd = ['run', '--rm', '--name', `${NAME}-exit`];
  for (const [k, v] of envPairs) cmd.push('-e', `${k}=${v}`);
  cmd.push(image);
  return new Promise((resolve) => {
    const child = spawn('docker', cmd);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      docker(['rm', '-f', `${NAME}-exit`]);
      resolve({ code: null, out: out + '\n<timed out; container killed>' });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

function get(pathname, token) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: pathname, headers: token ? { Authorization: `Bearer ${token}` } : {}, timeout: 10_000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json, body });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, json: null, body: String(e) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, json: null, body: 'timeout' });
    });
  });
}

async function waitForHealth(timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { status } = await get('/api/health');
    if (status === 200) return true;
    const state = docker(['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', NAME]).stdout.trim();
    if (state.startsWith('exited')) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** Sign a token INSIDE the container with its own jsonwebtoken — no local dependency. */
function forgeInContainer(payload, secret) {
  const script = `const jwt=require('/app/node_modules/jsonwebtoken');process.stdout.write(jwt.sign(${JSON.stringify(payload)},${JSON.stringify(secret)}))`;
  const r = docker(['exec', NAME, 'node', '-e', script]);
  return r.stdout.trim();
}

function cleanup() {
  docker(['rm', '-f', NAME]);
  docker(['rm', '-f', `${NAME}-exit`]);
  if (!KEEP) fs.rmSync(dataDir, { recursive: true, force: true });
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

try {
  console.log(`docker smoke: ${image}\n  data dir ${dataDir}\n  owner    ${OWNER}`);

  section('a container that names nobody refuses to start');
  {
    const { code, out } = await runToExit([]);
    assert(code === EX_CONFIG, `exit status ${EX_CONFIG} (EX_CONFIG), got ${code}`, out.slice(-600));
    assert(/refusing to start/.test(out) && /AGNT_TENANT_OWNER/.test(out), 'log names AGNT_TENANT_OWNER as the fix', out.slice(-600));
  }

  section('a container given the published placeholder secret refuses to start');
  {
    const { code, out } = await runToExit([
      ['AGNT_TENANT_OWNER', OWNER],
      ['JWT_SECRET', PLACEHOLDER],
    ]);
    assert(code === EX_CONFIG, `exit status ${EX_CONFIG}, got ${code}`, out.slice(-600));
    assert(/published placeholder/.test(out), 'log says the value is a published placeholder', out.slice(-600));
    assert(!out.includes(PLACEHOLDER) || /JWT_SECRET is set to a published placeholder/.test(out), 'the refusal does not need to print the value', '');
  }

  section('a correctly configured container starts and serves /api/health');
  {
    const r = docker([
      'run', '-d', '--name', NAME,
      '-p', `127.0.0.1:${PORT}:3333`,
      '-e', `AGNT_TENANT_OWNER=${OWNER}`,
      '-v', `${dataDir}:/app/data`,
      image,
    ]);
    assert(r.code === 0, 'docker run -d succeeded', r.out);
    const healthy = await waitForHealth();
    assert(healthy, '/api/health answered 200', docker(['logs', '--tail', '80', NAME]).out);
    if (!healthy) throw new Error('container never became healthy');

    const logs = docker(['logs', NAME]).out;
    assert(/\[secrets\] auth mode AGNT_AUTH_MODE=verify-remote/.test(logs), 'boot log reports verify-remote', logs.slice(-400));
    assert(!/refusing to start/.test(logs), 'no refusal in the log');
  }

  section('the generated secret is private to this install');
  {
    const stat = docker(['exec', NAME, 'stat', '-c', '%a %U %s', '/app/data/secrets/JWT_SECRET']).stdout.trim();
    const [mode, owner, size] = stat.split(' ');
    assert(mode === '600', `JWT_SECRET keyfile mode 600, got ${mode || '(missing)'}`, stat);
    assert(owner === 'node', `keyfile owned by node, got ${owner}`, stat);
    assert(Number(size) >= 32, `keyfile holds >= 32 bytes, got ${size}`, stat);
    const value = docker(['exec', NAME, 'cat', '/app/data/secrets/JWT_SECRET']).stdout.trim();
    assert(value !== PLACEHOLDER && value !== '6g8UlgibzfngealexqkNPv1/H2ZG00cb4gp2/5JSNgs=', 'keyfile is neither the placeholder nor the published desktop key');
    // Encryption initializes lazily: a fresh database has no credentials yet.
    // Exercise the real first-use path as the app user before checking persistence.
    const encryption = docker(['exec', '--user', 'node', NAME, 'node', '--input-type=module', '-e',
      "import { encrypt, decrypt } from '/app/backend/src/utils/encryption.js'; const value='smoke-roundtrip'; if(decrypt(encrypt(value))!==value) process.exit(1);"]);
    assert(encryption.code === 0, 'first-use encryption round trip succeeds as node', encryption.out);
    const ownership = docker(['exec', '--user', 'node', NAME, 'sh', '-c',
      'test ! -w /app && test ! -w /app/backend/server.js && test ! -w /app/node_modules && test -w /app/data && test -w /app/logs && test -w /app/unfirehose']);
    assert(ownership.code === 0, 'application stays read-only and runtime directories stay writable for node', ownership.out);
    for (const name of ['ENCRYPTION_KEY', 'SESSION_SECRET']) {
      const s = docker(['exec', NAME, 'stat', '-c', '%a', `/app/data/secrets/${name}`]).stdout.trim();
      assert(s === '600', `${name} keyfile generated with mode 600, got ${s || '(missing)'}`);
    }
  }

  section('the auth boundary, over the wire');
  {
    const none = await get('/api/users/auth/status');
    assert(none.status === 401 && none.json?.reason === 'missing', `no token -> 401 missing, got ${none.status} ${none.body.slice(0, 120)}`);

    const forgedPlaceholder = forgeInContainer({ userId: 'victim-user' }, PLACEHOLDER);
    const a = await get('/api/users/auth/status', forgedPlaceholder);
    assert(a.status === 401 && a.json?.reason === 'invalid', `token signed with the old placeholder -> 401 invalid (issue #144), got ${a.status} ${a.body.slice(0, 120)}`);

    const forgedPublished = forgeInContainer({ id: 'victim-user', email: OWNER }, '6g8UlgibzfngealexqkNPv1/H2ZG00cb4gp2/5JSNgs=');
    const b = await get('/api/users/auth/status', forgedPublished);
    assert(b.status === 401, `token signed with the published desktop key -> 401, got ${b.status} ${b.body.slice(0, 120)}`);

    // A token the container's OWN generated secret would verify does not exist
    // outside the container; prove even that one is not enough to be someone
    // else: local verify passes, membership refuses.
    const own = docker(['exec', NAME, 'cat', '/app/data/secrets/JWT_SECRET']).stdout.trim();
    const localStranger = forgeInContainer({ id: 'stranger-local', email: 'stranger@example.test' }, own);
    const c = await get('/api/users/auth/status', localStranger);
    assert(c.status === 403 && c.json?.reason === 'not_tenant_member', `locally-valid token for a non-member -> 403 not_tenant_member, got ${c.status} ${c.body.slice(0, 120)}`);

    if (OWNER_TOKEN) {
      const d = await get('/api/users/auth/status', OWNER_TOKEN);
      assert(d.status === 200 && d.json?.isAuthenticated === true, `genuine owner token -> 200 authenticated, got ${d.status} ${d.body.slice(0, 160)}`);
      const logs = docker(['logs', NAME]).out;
      assert(!/Failed to decode remote auth token/.test(logs), 'owner login did not take the unverified path');
    } else {
      console.log('  skip genuine owner login (no --token given)');
    }
    if (STRANGER_TOKEN) {
      const e = await get('/api/users/auth/status', STRANGER_TOKEN);
      assert(e.status === 403 && e.json?.reason === 'not_tenant_member', `genuine stranger token -> 403 not_tenant_member, got ${e.status} ${e.body.slice(0, 160)}`);
    } else {
      console.log('  skip genuine stranger refusal (no --stranger-token given)');
    }
  }

  section('the container is still healthy after all of that');
  {
    const { status } = await get('/api/health');
    assert(status === 200, `/api/health still 200, got ${status}`);
    const state = docker(['inspect', '-f', '{{.State.Status}}', NAME]).stdout.trim();
    assert(state === 'running', `container running, got ${state}`);
  }
} catch (error) {
  fail(`aborted: ${error.message}`);
  const logs = docker(['logs', '--tail', '120', NAME]).out;
  if (logs) console.log(logs);
} finally {
  if (KEEP) console.log(`\n--keep: container ${NAME} and ${dataDir} left in place`);
  else cleanup();
}

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}: ${image}`);
process.exit(failures.length === 0 ? 0 : 1);
