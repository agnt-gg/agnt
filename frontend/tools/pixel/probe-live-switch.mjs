// Against the LIVE backend (real data, real chunk sizes): for each screen
// switch, record compositor frames and report, per frame, whether each panel
// region is painted with a panel surface. No fixtures, no fake wallpaper —
// uses whatever background the user actually has. A frame where a panel
// region shows the wallpaper/transparent is a flash frame.
//
// Needs the app running on :3333 and AGNT_AUTH_TOKEN in env.
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const { PNG } = createRequire(import.meta.url)('pngjs');
import { serveDist } from './serve.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const BACKEND = process.env.AGNT_ORIGIN || 'http://localhost:3333';
// Serve THIS worktree's dist; proxy /api to the live backend so real data
// flows through the build under test, not whatever :3333 last built.
const { server, origin: ORIGIN } = await serveDist(path.join(FE, 'dist'));
const TOKEN = process.env.AGNT_AUTH_TOKEN;
const OFF = process.env.AGNT_BACKDROP === 'off';
const ROUTES = ['/chat', '/agents', '/workflows', '/traces', '/settings', '/goals', '/chat'];
if (!TOKEN) { console.error('AGNT_AUTH_TOKEN missing'); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ token, off }) => {
  localStorage.setItem('token', token);
  localStorage.setItem('hasCompletedOnboarding', 'true'); localStorage.setItem('tours_enabled', 'false'); localStorage.setItem('tours_auto_start', 'false');
  localStorage.setItem('useCustomBackground', 'true');
  window.requestIdleCallback = undefined;
  const css = `*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important}${off ? '.cv-backdrop{display:none!important}' : ''}`;
  const inject = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); };
  if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject, { once: true });
}, { token: TOKEN, off: OFF });
await ctx.route('**/*', async (r) => {
  const url = r.request().url();
  if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort();
  if (url.startsWith(ORIGIN + '/api/')) {
    const target = BACKEND + url.slice(ORIGIN.length);
    const req = r.request();
    try {
      const res = await fetch(target, { method: req.method(), headers: { ...req.headers(), host: undefined, authorization: 'Bearer ' + TOKEN }, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData() });
      const body = Buffer.from(await res.arrayBuffer());
      return r.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' }, body });
    } catch (e) { return r.fulfill({ status: 502, body: '{}' }); }
  }
  if (!url.startsWith(ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort();
  return r.continue();
});
const page = await ctx.newPage();
await page.goto(ORIGIN + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cv-dashboard', { timeout: 30000 });
// Force the wallpaper to a known colour so "wallpaper visible" is detectable
// regardless of the user's image, but keep the user's custom-bg mode.
await page.evaluate(() => {
  document.body.classList.add('custom-bg');
  let bg = document.getElementById('bg-layer');
  if (!bg) { bg = document.createElement('div'); bg.id = 'bg-layer'; document.querySelector('.terminal-container')?.prepend(bg); }
  bg.innerHTML = ''; bg.style.cssText = 'position:fixed;inset:0;z-index:-1;background:#ff00ff';
});
await page.waitForTimeout(1500);

const dash = await page.$eval('.cv-dashboard', (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; });
const patches = [{ name: 'left', x: dash.x + 40 }, { name: 'main', x: dash.x + Math.round(dash.width / 2) }, { name: 'right', x: dash.x + dash.width - 60 }].map((p) => ({ ...p, y: dash.y + Math.round(dash.height * 0.6), w: 24, h: 24 }));
const share = (png, p) => { if (png.width < p.x + p.w || png.height < p.y + p.h) return -1; let m = 0, n = 0; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const i = (y * png.width + x) * 4; n++; if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] > 200) m++; } return m / n; };

const cdp = await ctx.newCDPSession(page);
let frames = [];
cdp.on('Page.screencastFrame', async (ev) => { frames.push({ t: ev.metadata.timestamp, buf: Buffer.from(ev.data, 'base64') }); await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {}); });
await cdp.send('Page.startScreencast', { format: 'png', quality: 100, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
await page.waitForTimeout(300);

const lines = [];
const say = (l) => { console.log(l); lines.push(l); };
say(`LIVE data from ${BACKEND}, build from ${FE}/dist  backdrop=${OFF ? 'OFF' : 'on'}`);
let total = 0;
for (let i = 1; i < ROUTES.length; i++) {
  const from = ROUTES[i - 1], to = ROUTES[i];
  frames = [];
  const t0 = Date.now();
  await page.evaluate((to) => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
  await page.waitForTimeout(1500);
  const got = frames.slice();
  let flash = 0; const per = patches.map(() => ({ max: 0, at: -1, ms: 0 }));
  const first = got[0]?.t || 0;
  got.forEach((f, k) => { const png = PNG.sync.read(f.buf); if (png.width !== 1440 || png.height !== 900) return; patches.forEach((p, j) => { const v = share(png, p); if (v > per[j].max) { per[j].max = v; per[j].at = k; per[j].ms = Math.round((f.t - first) * 1000); } }); const shares = patches.map((p) => share(png, p)); if (shares.some((v) => v > 0.5)) { flash++; if (!per.flagged) per.flagged = []; per.flagged.push(`f${k}@${Math.round((f.t - first) * 1000)}ms ${png.width}x${png.height} ` + patches.map((p, j) => { let r = 0, g = 0, b = 0, n = 0; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const i = (y * png.width + x) * 4; r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++; } return `${p.name}=#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}(${(shares[j] * 100).toFixed(0)}%)`; }).join(' ')); } });
  total += flash;
  say(`${from.padEnd(10)} -> ${to.padEnd(10)} frames=${got.length} flashFrames=${flash} ` + patches.map((p, j) => `${p.name}:${(per[j].max * 100).toFixed(0)}%${per[j].at >= 0 ? '@' + per[j].ms + 'ms' : ''}`).join(' ') + (per.flagged ? '\n      ' + per.flagged.slice(0, 3).join('\n      ') : ''));
}
say('TOTAL flashFrames ' + total);
// Written before teardown: proxied fetches can hold the loop open and a hung
// exit must never hide the numbers.
(await import('node:fs')).writeFileSync(path.join(FE, 'tools', 'pixel', `probe-live-${OFF ? 'off' : 'on'}.txt`), lines.join('\n') + '\n');
await cdp.send('Page.stopScreencast').catch(() => {});
await browser.close().catch(() => {});
try { server.close(); } catch {}
process.exit(0);
