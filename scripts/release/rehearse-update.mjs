#!/usr/bin/env node
/**
 * rehearse-update: install an OLD build, let it update itself to a NEW build
 * from a local feed, and prove the new build is what runs afterwards.
 *
 *   node scripts/release/rehearse-update.mjs --kind mac|appimage|deb \
 *        --old dist-old --new dist-new --out rehearsal-out
 *
 * Both builds must have been made with
 *   -c.extraMetadata.agntUpdate.feedBase=http://127.0.0.1:8787/updates/
 *   -c.extraMetadata.agntUpdate.assetBase=http://127.0.0.1:8787/releases/download/
 * and prerelease versions (so they follow the "rehearsal" channel).
 *
 * What it proves, per kind:
 *   mac       the app downloads the update, Squirrel installs it when the app
 *             quits, and the relaunched bundle IS the new version
 *   appimage  the same through electron-updater's AppImage path, with the file
 *             named the way users download it (version in the name)
 *   deb       the app does NOT update itself: it disables the updater and never
 *             asks the feed (apt owns the files; a self-update would need root)
 *
 * The app is quit with SIGTERM, which Electron turns into an orderly app.quit()
 * on macOS and Linux: the same path as a user quitting.
 *
 * Emits GitHub annotations (::notice / ::error) so the outcome is readable from
 * the run page without downloading logs, and writes everything to --out.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { parseLatestYml, renderLatestYml, sha512File } from './releaseLib.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const kind = arg('kind');
const oldDir = path.resolve(arg('old', 'dist-old'));
const newDir = path.resolve(arg('new', 'dist-new'));
const out = path.resolve(arg('out', 'rehearsal-out'));
const PORT = 8787;
const HOST = `http://127.0.0.1:${PORT}`;
if (!['mac', 'appimage', 'deb'].includes(kind)) {
  console.error('usage: rehearse-update --kind mac|appimage|deb --old <dir> --new <dir> [--out <dir>]');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const timeline = [];
const note = (m) => {
  const line = `${new Date().toISOString()} ${m}`;
  timeline.push(line);
  console.log(line);
  fs.appendFileSync(path.join(out, 'timeline.log'), line + '\n');
};
const results = {};
const check = (name, ok, detail = '') => {
  results[name] = { ok: !!ok, detail };
  note(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 3500) => (s.length > n ? '…' + s.slice(-n) : s);
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

// ------------------------------------------------------------------ versions
function feedFile(dir) {
  const f = kind === 'mac' ? 'latest-mac.yml' : 'latest-linux.yml';
  const p = path.join(dir, f);
  if (fs.existsSync(p)) return parseLatestYml(fs.readFileSync(p, 'utf8'));
  if (kind !== 'deb') throw new Error(`${p} missing`);
  // A deb-only build may carry no feed; the version is in the package name.
  const deb = fs.readdirSync(dir).find((n) => /\.deb$/.test(n));
  const m = deb && /^AGNT-(.+?)-linux-/.exec(deb);
  if (!m) throw new Error(`no feed and no AGNT-<version>-linux-*.deb in ${dir}`);
  return { version: m[1], files: [] };
}
const oldFeed = feedFile(oldDir);
const newFeed = feedFile(newDir);
const OLD = String(oldFeed.version);
const NEW = String(newFeed.version);
note(`rehearsal kind=${kind} ${OLD} -> ${NEW} on ${process.platform}/${process.arch}`);

// ------------------------------------------------------------------ feed + files
// The feed agnt.gg would serve: absolute file URLs under the release of exactly
// NEW (the client refuses anything else), installable files only.
const serveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-rehearsal-serve-'));
const relDir = path.join(serveRoot, 'releases', 'download', `v${NEW}`);
fs.mkdirSync(relDir, { recursive: true });
fs.mkdirSync(path.join(serveRoot, 'updates', 'rehearsal'), { recursive: true });
const wanted = kind === 'mac' ? /\.zip$/ : /\.AppImage$/;
const served = newFeed.files.filter((f) => wanted.test(f.url));
if (kind !== 'deb' && served.length === 0) throw new Error(`new feed lists no ${wanted} file`);
for (const f of served) {
  for (const name of [f.url, `${f.url}.blockmap`]) {
    const src = path.join(newDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(relDir, name));
  }
}
const feed = {
  ...newFeed,
  files: served.map((f) => ({ ...f, url: `${HOST}/releases/download/v${NEW}/${f.url}` })),
};
if (feed.files.length) {
  feed.path = feed.files[0].url;
  feed.sha512 = feed.files[0].sha512;
}
const feedName = kind === 'mac' ? 'latest-mac.yml' : 'latest-linux.yml';
fs.writeFileSync(path.join(serveRoot, 'updates', 'rehearsal', feedName), feed.files.length ? renderLatestYml(feed) : `version: ${NEW}\nfiles: []\n`);
fs.copyFileSync(path.join(serveRoot, 'updates', 'rehearsal', feedName), path.join(out, `served-${feedName}`));

const requests = [];
const server = http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    requests.push(`${req.method} ${url} ${req.headers.range || ''}`.trim());
    const file = path.join(serveRoot, url);
    if (!file.startsWith(serveRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (req.headers.range && !m) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    if (m) {
      const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
      const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1');

// ------------------------------------------------------------------ install OLD
const home = os.homedir();
let exe;
let appimagePath;
let macApp;
function findFile(dir, re) {
  const f = fs.readdirSync(dir).find((n) => re.test(n));
  if (!f) throw new Error(`no ${re} in ${dir}`);
  return path.join(dir, f);
}
if (kind === 'mac') {
  const zip = findFile(oldDir, /\.zip$/);
  const apps = path.join(home, 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  fs.rmSync(path.join(apps, 'AGNT.app'), { recursive: true, force: true });
  execFileSync('ditto', ['-x', '-k', zip, apps]);
  macApp = path.join(apps, 'AGNT.app');
  exe = path.join(macApp, 'Contents', 'MacOS', 'AGNT');
  note(`installed ${path.basename(zip)} to ${macApp}`);
} else if (kind === 'appimage') {
  const src = findFile(oldDir, /\.AppImage$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-appimage-'));
  // Named exactly as users download it: the version is in the file name, which
  // changes where electron-updater puts the new file (see AppImageUpdater).
  appimagePath = path.join(dir, path.basename(src));
  fs.copyFileSync(src, appimagePath);
  fs.chmodSync(appimagePath, 0o755);
  exe = appimagePath;
  note(`installed ${path.basename(src)} to ${dir}`);
} else {
  const deb = findFile(oldDir, /\.deb$/);
  execFileSync('sudo', ['apt-get', 'install', '-y', deb], { stdio: 'inherit' });
  exe = '/opt/AGNT/agnt';
  if (!fs.existsSync(exe)) exe = execFileSync('sh', ['-c', "dpkg -L agnt | grep -E '/agnt$' | head -1"], { encoding: 'utf8' }).trim();
  note(`installed ${path.basename(deb)}; executable ${exe}`);
}

// ------------------------------------------------------------------ run helpers
function ps() {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, ppid, args]) => ({ pid: Number(pid), ppid: Number(ppid), args }));
}
function descendants(root) {
  const all = ps();
  const set = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) if (set.has(p.ppid) && !set.has(p.pid)) { set.add(p.pid); grew = true; }
  }
  return all.filter((p) => set.has(p.pid));
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function launch(label, file) {
  const logPath = path.join(out, `app-${label}.log`);
  const fd = fs.openSync(logPath, 'a');
  const args = kind === 'mac' ? [] : ['--no-sandbox'];
  const child = spawn(file, args, {
    // The app prints only warnings by default and records the rest in its
    // diagnostics log. Every check here reads its info lines from stdout:
    // the version, "[update] ... downloaded", "auto-update disabled".
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', AGNT_CONSOLE_PASSTHROUGH: 'all' },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  note(`launched ${label}: pid ${child.pid} (${file})`);
  return { child, logPath, read: () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '') };
}

async function waitForLog(run, re, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(run.read())) return true;
    if (run.child.exitCode !== null) return re.test(run.read());
    await sleep(2000);
  }
  return false;
}

/** Every running process that belongs to this AGNT install, wherever it was reparented. */
const APP_MARKERS = [/\/\.mount_AGNT/, /\/opt\/AGNT\//, /AGNT\.app\/Contents\//, /agnt-appimage-/];
const appProcesses = () => ps().filter((p) => p.pid !== process.pid && APP_MARKERS.some((re) => re.test(p.args)));

/**
 * SIGTERM to the Electron main process: Electron quits in an orderly way.
 *
 * For an AppImage the process we spawned is the AppImage runtime, and one of
 * its children is the FUSE mount holding the app's files; signalling that one
 * would pull the filesystem out from under the running app. The main process
 * is the one executing FROM the mount, without a --type= (renderer, utility).
 */
async function quit(run) {
  const tree = descendants(run.child.pid);
  const fromMount = tree.find((p) => /^\S*\/\.mount_[^/]+\//.test(p.args) && !/--type=/.test(p.args));
  const main = (kind === 'appimage' && fromMount) || tree.find((p) => p.pid === run.child.pid);
  if (!main) {
    note('quit: the app is already gone');
    return appProcesses().length === 0;
  }
  note(`quitting: SIGTERM to pid ${main.pid} (${main.args.slice(0, 120)})`);
  try { process.kill(main.pid, 'SIGTERM'); } catch (e) { note(`kill failed: ${e.message}`); }
  const end = Date.now() + 90000;
  while (Date.now() < end && (descendants(run.child.pid).length || appProcesses().length)) await sleep(1000);
  // Orphans are reparented away from our tree, so look machine-wide too.
  const left = [...new Map([...descendants(run.child.pid), ...appProcesses()].map((p) => [p.pid, p])).values()];
  note(`after quit: ${left.length} AGNT process(es) still running${left.length ? ': ' + left.map((p) => `${p.pid} ${p.args.slice(0, 80)}`).join(' | ') : ''}`);
  for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  return left.length === 0;
}

function annotateFailure(title, text) {
  console.log(`::error title=${esc(title)}::${esc(clip(text))}`);
}

// ------------------------------------------------------------------ the rehearsal
let failed = false;
try {
  const first = launch('old', exe);
  const started = await waitForLog(first, new RegExp(`App version from package.json: ${OLD.replace(/\./g, '\\.')}`), 120000);
  check('old build starts', started, OLD);

  if (kind === 'deb') {
    const disabled = await waitForLog(first, /\[update\] auto-update disabled: linux-package-manager/, 60000);
    check('deb disables the self-updater', disabled);
    await sleep(45000); // past the updater's first scheduled check (30 s)
    const asked = requests.filter((r) => r.includes('/updates/') || r.includes('/releases/'));
    check('deb never asks the feed', asked.length === 0, asked.join(' | '));
    check('app quits cleanly', await quit(first));
  } else {
    const downloaded = await waitForLog(first, new RegExp(`\\[update\\] ${NEW.replace(/\./g, '\\.')} downloaded`), 300000);
    check('finds and downloads the update', downloaded, requests.filter((r) => !r.includes('.blockmap')).slice(-3).join(' | '));
    if (!downloaded) throw new Error('update never downloaded');
    // Quit only once the app says it is ready, as a user would when the banner
    // offers a restart. On macOS that is after Squirrel has staged the update;
    // before this change the app said "ready" too early and a quit installed nothing.
    const ready = await waitForLog(first, new RegExp(`\\[update\\] ${NEW.replace(/\./g, '\\.')} ready`), 300000);
    check('app reports the update ready', ready);
    if (!ready) throw new Error('update never became ready');
    check('app quits cleanly', await quit(first));

    // Installed?
    let installedNew = false;
    let relaunchPath = exe;
    if (kind === 'mac') {
      const plist = path.join(macApp, 'Contents', 'Info.plist');
      const end = Date.now() + 180000;
      let v = '';
      while (Date.now() < end) {
        try { v = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8' }).trim(); } catch { v = ''; }
        if (v === NEW) break;
        await sleep(3000);
      }
      installedNew = v === NEW;
      const shipit = path.join(home, 'Library', 'Caches', 'com.agnt.app.ShipIt');
      for (const f of ['ShipIt_stderr.log', 'ShipIt_stdout.log']) {
        if (fs.existsSync(path.join(shipit, f))) fs.copyFileSync(path.join(shipit, f), path.join(out, f));
      }
      check('Squirrel installed the new bundle on quit', installedNew, `CFBundleShortVersionString=${v}`);
      const sig = (() => { try { execFileSync('codesign', ['--verify', '--deep', '--strict', macApp], { encoding: 'utf8', stdio: 'pipe' }); return 'valid'; } catch (e) { return String(e.stderr || e.message).trim(); } })();
      check('installed bundle signature is valid', sig === 'valid', sig);
    } else {
      // The new version must be AT THE PATH THE USER LAUNCHED, because that is
      // what every desktop shortcut and dock pin points at (keepAppImagePath in
      // electron/autoUpdate.js). electron-updater alone moved it to a new
      // versioned name and deleted this one.
      const dir = path.dirname(appimagePath);
      const want = await sha512File(findFile(newDir, /\.AppImage$/));
      const end = Date.now() + 60000;
      let got = null;
      while (Date.now() < end) {
        try { got = fs.statSync(appimagePath).isFile() ? await sha512File(appimagePath) : null; } catch { got = null; }
        if (got === want) break;
        await sleep(1000);
      }
      installedNew = got === want;
      const listing = fs.readdirSync(dir).map((n) => {
        const p = path.join(dir, n);
        return fs.lstatSync(p).isSymbolicLink() ? `${n} -> ${fs.readlinkSync(p)}` : n;
      });
      check('new AppImage is at the path the user launched (shortcuts keep working)', installedNew, listing.join(', '));
      const stray = listing.filter((n) => !n.includes(' -> ') && n !== path.basename(appimagePath));
      check('no second copy left beside it', stray.length === 0, stray.join(', '));
      relaunchPath = appimagePath; // the shortcut
    }
    if (!installedNew) throw new Error('new version not installed');

    // Relaunch: the new version must be what runs, and it must not offer itself again.
    const second = launch('new', relaunchPath);
    const newRuns = await waitForLog(second, new RegExp(`App version from package.json: ${NEW.replace(/\./g, '\\.')}`), 120000);
    check('relaunched app IS the new version', newRuns, NEW);
    await sleep(40000);
    const reoffered = new RegExp(`\\[update\\] ${NEW.replace(/\./g, '\\.')} available`).test(second.read());
    check('new version does not re-download itself', !reoffered);
    check('new app quits cleanly', await quit(second));
  }
} catch (err) {
  failed = true;
  note(`ABORT: ${err?.message || err}`);
} finally {
  server.close();
  fs.writeFileSync(path.join(out, 'requests.log'), requests.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ kind, OLD, NEW, platform: process.platform, arch: process.arch, results }, null, 2));
}

const bad = Object.entries(results).filter(([, r]) => !r.ok);
if (failed || bad.length || Object.keys(results).length === 0) {
  const appLogs = ['old', 'new']
    .map((l) => path.join(out, `app-${l}.log`))
    .filter((p) => fs.existsSync(p))
    .map((p) => `--- ${path.basename(p)}\n` + fs.readFileSync(p, 'utf8').split('\n').filter((l) => /\[update\]|\[Update\]|error|Error|ShipIt|Squirrel/.test(l)).slice(-40).join('\n'))
    .join('\n');
  annotateFailure(`Update rehearsal FAILED (${kind} ${process.arch})`, `${timeline.join('\n')}\n${appLogs}`);
  process.exit(1);
}
console.log(`::notice title=${esc(`Update rehearsal passed (${kind} ${process.arch})`)}::${esc(timeline.filter((l) => / PASS /.test(l)).map((l) => l.replace(/^\S+ /, '')).join('\n'))}`);
