// Measures the screen-switch flash from COMPOSITOR FRAMES.
//
// page.screenshot() waits for a stable frame, so it never sees the gap.
// Page.startScreencast hands us every frame the compositor produces; with a
// magenta wallpaper on, any frame where magenta shows inside a panel region is
// a flash frame. AGNT_BACKDROP=off hides PanelBackdrop for the baseline.
//
// Screens are visited COLD (chunk not yet loaded) by blocking the idle preload
// until after measurement, which is the case the user hits: first visit to a
// screen this session.
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const { PNG } = createRequire(import.meta.url)('pngjs');
import { serveDist } from './serve.mjs';
import { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OFF = process.env.AGNT_BACKDROP === 'off';
const ROUTES = ['/chat', '/agents', '/workflows', '/traces', '/settings', '/goals', '/chat'];

const { server, origin } = await serveDist(path.join(FE, 'dist'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ user, token, off }) => {
  const set = (k, v) => localStorage.setItem(k, v);
  set('token', token); set('user', JSON.stringify(user)); set('userId', user.id);
  set('hasCompletedOnboarding', 'true'); set('onboardingCompleted', 'true'); set('tours_enabled', 'false'); set('tours_auto_start', 'false');
  set('uiScale', '100'); set('showLeftPanel', 'true'); set('showRightPanel', 'true'); set('leftPanelWidth', '300'); set('actualLeftPanelWidth', '300'); set('rightPanelWidth', '340');
  set('useCustomBackground', 'true'); set('bgOpacity', '100');
  // Defeat the idle preload so each screen is a cold chunk load.
  window.requestIdleCallback = undefined;
  const css = `*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important}${off ? '.cv-backdrop{display:none!important}' : ''}`;
  const inject = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); };
  if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject, { once: true });
}, { user: FIXTURE_USER, token: FIXTURE_TOKEN, off: OFF });
// Slow the chunk fetches slightly so the cold-load window is real, not a race.
await ctx.route('**/*', async (r) => {
  const url = r.request().url();
  if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort();
  if (/\/api\//.test(url)) { const f = resolveFixture(new URL(url).pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f === null ? [] : f) }); }
  if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort();
  if (/\/assets\/.*\.js$/.test(url) && !/index-/.test(url)) await new Promise((res) => setTimeout(res, 120));
  return r.continue();
});
const page = await ctx.newPage();
await page.goto(origin + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cv-dashboard', { timeout: 20000 });
await page.evaluate(() => {
  document.body.classList.add('custom-bg');
  let bg = document.getElementById('bg-layer');
  if (!bg) { bg = document.createElement('div'); bg.id = 'bg-layer'; document.querySelector('.terminal-container')?.prepend(bg); }
  bg.innerHTML = '';
  bg.style.cssText = 'position:fixed;inset:0;z-index:-1;background:#ff00ff';
  document.documentElement.style.setProperty('--bg-opacity', '1');
});
await page.waitForTimeout(600);

const dash = await page.$eval('.cv-dashboard', (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; });
const patches = [{ name: 'left', x: dash.x + 40 }, { name: 'main', x: dash.x + Math.round(dash.width / 2) }, { name: 'right', x: dash.x + dash.width - 60 }].map((p) => ({ ...p, y: dash.y + Math.round(dash.height * 0.6), w: 24, h: 24 }));
const magentaShare = (png, p) => {
  let mag = 0, n = 0;
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    const i = (y * png.width + x) * 4; n++;
    if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] > 200) mag++;
  }
  return mag / n;
};

const cdp = await ctx.newCDPSession(page);
let frames = [];
cdp.on('Page.screencastFrame', async (ev) => {
  frames.push(Buffer.from(ev.data, 'base64'));
  await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'png', quality: 100, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
await page.waitForTimeout(300);
frames = [];

const wholeDash = { name: 'dash', x: dash.x, y: dash.y, w: dash.width, h: dash.height };
const results = [];
for (let i = 1; i < ROUTES.length; i++) {
  const from = ROUTES[i - 1], to = ROUTES[i];
  frames = [];
  await page.evaluate((to) => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
  await page.waitForTimeout(900);
  const got = frames.slice();
  let flash = 0, worst = 0, firstBad = ''; const perPatch = patches.map(() => ({ max: 0, at: -1 })); let wholeMax = 0, wholeAt = -1;
  got.forEach((buf, k) => {
    const png = PNG.sync.read(buf);
    const shares = patches.map((p) => magentaShare(png, p));
    const whole = magentaShare(png, wholeDash);
    const bad = shares.some((v) => v > 0.5) || whole > 0.05;
    if (bad) { flash++; if (!firstBad) firstBad = `first@frame${k} whole=${(whole * 100).toFixed(1)}% ` + patches.map((p, j) => `${p.name}=${(shares[j] * 100).toFixed(0)}%`).join(' '); }
    worst = Math.max(worst, ...shares, whole); shares.forEach((v, j) => { if (v > perPatch[j].max) { perPatch[j].max = v; perPatch[j].at = k; } }); if (whole > wholeMax) { wholeMax = whole; wholeAt = k; }
  });
  results.push({ from, to, frames: got.length, flash, worst, firstBad, detail: patches.map((p, j) => `${p.name}:max${(perPatch[j].max * 100).toFixed(0)}%@f${perPatch[j].at}`).join(' ') + ` whole:max${(wholeMax * 100).toFixed(1)}%@f${wholeAt}` });
}
await cdp.send('Page.stopScreencast').catch(() => {});
console.log(`backdrop=${OFF ? 'OFF' : 'on'}  (cold chunks, +120ms per chunk)`);
for (const r of results) console.log(`${r.from.padEnd(11)} -> ${r.to.padEnd(11)} flashFrames=${r.flash}/${r.frames} ${r.detail}`);
console.log('TOTAL flashFrames', results.reduce((a, r) => a + r.flash, 0));
await browser.close(); server.close();
