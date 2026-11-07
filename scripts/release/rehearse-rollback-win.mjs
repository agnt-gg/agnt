#!/usr/bin/env node
/**
 * rehearse-rollback-win: Windows installs on a click, so this drives the click.
 *
 *   node scripts/release/rehearse-rollback-win.mjs --old dist-old --new dist-new --out rehearsal-out
 *
 * Both dirs hold NSIS builds of THIS commit, differing only in version; the NEW
 * build carries agntUpdate.rollbackTo=<OLD version>. Everything runs against a
 * local feed served exactly as agnt.gg would serve it. What it proves:
 *
 *   1 forward   install OLD, the feed offers NEW: found, downloaded, the
 *               "Restart to update" click installs it, NEW serves on the same
 *               data (CI never exercised the Windows click before)
 *   2 refusal   the feed offers OLD again WITHOUT the rollback mark: refused,
 *               nothing downloaded
 *   3 rollback  the same feed WITH `rollback: true`: downloaded, the click
 *               installs it, OLD serves again, the user's data survived
 *
 * The click goes over CDP (--remote-debugging-port) with playwright-core, the
 * same way a person clicks the banner button.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseLatestYml, renderLatestYml } from './releaseLib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const oldDir = path.resolve(arg('old', 'dist-old'));
const newDir = path.resolve(arg('new', 'dist-new'));
const out = path.resolve(arg('out', 'rehearsal-out'));
const FEED_PORT = 8787, APP_PORT = 3333, CDP = 9333;
const INSTALL = path.join(process.env.LOCALAPPDATA, 'Programs', 'AGNT');
const EXE = path.join(INSTALL, 'AGNT.exe');
const USERDATA = path.join(process.env.APPDATA, 'AGNT');
fs.mkdirSync(out, { recursive: true });

const timeline = [];
const note = (m) => { const l = `${new Date().toISOString()} ${m}`; timeline.push(l); console.log(l); fs.appendFileSync(path.join(out, 'timeline.log'), l + '\n'); };
const results = {};
const check = (name, ok, detail = '') => { results[name] = { ok: !!ok, detail }; note(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const version = (dir) => String(parseLatestYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8')).version);
const OLD = version(oldDir), NEW = version(newDir);
note(`win rehearsal ${OLD} <-> ${NEW}`);

// ── the feed: swap what agnt.gg announces between phases ──────────────────────
const serveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-win-rehearsal-'));
for (const [v, dir] of [[OLD, oldDir], [NEW, newDir]]) {
  const rel = path.join(serveRoot, 'releases', 'download', `v${v}`);
  fs.mkdirSync(rel, { recursive: true });
  for (const n of fs.readdirSync(dir)) if (/\.(exe|blockmap)$/.test(n)) fs.copyFileSync(path.join(dir, n), path.join(rel, n));
}
fs.mkdirSync(path.join(serveRoot, 'updates', 'rehearsal'), { recursive: true });
function announce(v, dir, { rollback = false } = {}) {
  const feed = parseLatestYml(fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8'));
  feed.files = feed.files.map((f) => ({ ...f, url: `http://127.0.0.1:${FEED_PORT}/releases/download/v${v}/${f.url}` }));
  feed.path = feed.files[0].url;
  feed.sha512 = feed.files[0].sha512;
  const yml = renderLatestYml(feed).trimEnd() + (rollback ? '\nrollback: true' : '') + '\n';
  fs.writeFileSync(path.join(serveRoot, 'updates', 'rehearsal', 'latest.yml'), yml);
  note(`feed now announces ${v}${rollback ? ' (rollback)' : ''}`);
}
const requests = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requests.push(`${req.method} ${url} ${req.headers.range || ''}`.trim());
  const file = path.join(serveRoot, url);
  if (!file.startsWith(serveRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  const size = fs.statSync(file).size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
}).listen(FEED_PORT, '127.0.0.1');

// ── app control ───────────────────────────────────────────────────────────────
async function health() { try { const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } }
function launch(label) {
  const fd = fs.openSync(path.join(out, `app-${label}.log`), 'a');
  const child = spawn(EXE, [`--remote-debugging-port=${CDP}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', AGNT_CONSOLE_PASSTHROUGH: 'all' },
    stdio: ['ignore', fd, fd], detached: true,
  });
  child.unref();
  note(`launched ${label} (pid ${child.pid})`);
}
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
      const page = browser.contexts()[0]?.pages().find((p) => p.url().includes(`:${APP_PORT}`));
      if (page) return { browser, page };
      await browser.close();
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  throw new Error('could not reach the app over CDP');
}
const stateOf = (page) => page.evaluate(() => window.electron?.autoUpdate?.state?.()).catch(() => null);
async function waitPhase(page, phases, ms) {
  const end = Date.now() + ms;
  let st = null;
  while (Date.now() < end) {
    st = await stateOf(page);
    if (st && phases.includes(st.phase)) return st;
    await sleep(2000);
  }
  return st;
}
async function clickRestart(page) {
  const btn = page.getByRole('button', { name: /Restart to update/ });
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  await sleep(4000);
  const st = await stateOf(page);
  if (st?.blocked) {
    note(`blocked: ${JSON.stringify(st.blocked)}; clicking Restart anyway`);
    await page.getByRole('button', { name: /Restart anyway/ }).click();
  }
}
async function stopApp() {
  spawnSync('taskkill', ['/IM', 'AGNT.exe', '/T', '/F'], { stdio: 'ignore' });
  for (let i = 0; i < 30 && (await health()); i++) await sleep(2000);
  await sleep(3000);
}
async function waitVersion(v, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const h = await health(); if (h?.version === v) return h; await sleep(3000); }
  return null;
}

// ── the rehearsal ─────────────────────────────────────────────────────────────
let failed = false;
try {
  const installer = fs.readdirSync(oldDir).find((n) => n.endsWith('.exe') && !n.endsWith('.blockmap'));
  const inst = spawnSync(path.join(oldDir, installer), ['/S', '/currentuser'], { timeout: 300000 });
  check('old build installs silently', inst.status === 0 && fs.existsSync(EXE), `exit ${inst.status}`);
  fs.mkdirSync(USERDATA, { recursive: true });
  fs.writeFileSync(path.join(USERDATA, 'rehearsal-marker.txt'), 'written before the forward update\n');

  // 1 · forward: OLD must find NEW, and the click must install it.
  announce(NEW, newDir);
  launch('old');
  let s = await connect();
  let st = await waitPhase(s.page, ['ready', 'error'], 420000);
  check('forward: update found, verified, downloaded', st?.phase === 'ready' && st?.available?.version === NEW, JSON.stringify({ phase: st?.phase, available: st?.available, error: st?.error?.message }));
  await s.page.screenshot({ path: path.join(out, '1-forward-ready.png') }).catch(() => {});
  await clickRestart(s.page);
  await s.browser.close().catch(() => {});
  const forward = await waitVersion(NEW, 360000);
  check('forward: the click installed it and the new build serves', !!forward, JSON.stringify(forward));
  check('forward: user data survived', fs.existsSync(path.join(USERDATA, 'rehearsal-marker.txt')));
  await stopApp();

  // 2 · an older version WITHOUT the mark must be refused.
  const before = requests.length;
  announce(OLD, oldDir);
  launch('refusal');
  s = await connect();
  st = await waitPhase(s.page, ['error', 'ready', 'downloading'], 240000);
  check('refusal: unmarked older version is refused', st?.phase === 'error' && /without a rollback/.test(st?.error?.message || ''), JSON.stringify({ phase: st?.phase, error: st?.error?.message }));
  check('refusal: nothing was downloaded', !requests.slice(before).some((r) => r.includes('.exe')), requests.slice(before).filter((r) => r.includes('.exe')).join(' | '));
  await s.browser.close().catch(() => {});
  await stopApp();

  // 3 · the same version marked rollback: true must install, back to OLD.
  announce(OLD, oldDir, { rollback: true });
  launch('rollback');
  s = await connect();
  st = await waitPhase(s.page, ['ready', 'error'], 420000);
  check('rollback: marked rollback downloads and is ready', st?.phase === 'ready' && st?.available?.version === OLD, JSON.stringify({ phase: st?.phase, available: st?.available, error: st?.error?.message }));
  await s.page.screenshot({ path: path.join(out, '3-rollback-ready.png') }).catch(() => {});
  await clickRestart(s.page);
  await s.browser.close().catch(() => {});
  const back = await waitVersion(OLD, 360000);
  check('rollback: the click installed it and the OLD build serves again', !!back, JSON.stringify(back));
  check('rollback: user data survived the round trip', fs.existsSync(path.join(USERDATA, 'rehearsal-marker.txt')));
  await stopApp();
} catch (err) {
  failed = true;
  note(`ABORT: ${err?.message || err}`);
} finally {
  await stopApp().catch(() => {});
  const un = path.join(INSTALL, 'Uninstall AGNT.exe');
  if (fs.existsSync(un)) spawnSync(un, ['/S', '/currentuser'], { timeout: 180000 });
  server.close();
  fs.writeFileSync(path.join(out, 'requests.log'), requests.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ OLD, NEW, results }, null, 2));
}

const bad = Object.entries(results).filter(([, r]) => !r.ok);
if (failed || bad.length || Object.keys(results).length === 0) {
  const logs = fs.readdirSync(out).filter((n) => n.startsWith('app-')).map((n) => `--- ${n}\n` + fs.readFileSync(path.join(out, n), 'utf8').split('\n').filter((l) => /\[update\]|error|Error/.test(l)).slice(-30).join('\n')).join('\n');
  console.log(`::error title=${esc('Windows update/rollback rehearsal FAILED')}::${esc((timeline.join('\n') + '\n' + logs).slice(-3500))}`);
  process.exit(1);
}
console.log(`::notice title=${esc('Windows update and rollback rehearsal passed')}::${esc(timeline.filter((l) => / PASS /.test(l)).map((l) => l.replace(/^\S+ /, '')).join('\n'))}`);
