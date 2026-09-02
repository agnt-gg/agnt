// At REST (no navigation): how much wallpaper reaches the user inside each
// panel region, at a given bgOpacity/bgBlur, with the backdrop on or off.
// Uses a magenta wallpaper so the share is measurable: a pixel's magenta
// content = wallpaper reaching the eye. The number to protect is the OFF
// value; ON must match it.
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const { PNG } = createRequire(import.meta.url)('pngjs');
import { serveDist } from './serve.mjs';
import { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OFF = process.env.AGNT_BACKDROP === 'off';
const OPACITY = process.env.AGNT_BG_OPACITY || '92';
const BLUR = process.env.AGNT_BG_BLUR || '3';

const { server, origin } = await serveDist(path.join(FE, 'dist'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(({ user, token, off, opacity, blur }) => {
  const set = (k, v) => localStorage.setItem(k, v);
  set('token', token); set('user', JSON.stringify(user)); set('userId', user.id);
  set('hasCompletedOnboarding', 'true'); set('onboardingCompleted', 'true'); set('tours_enabled', 'false'); set('tours_auto_start', 'false');
  set('uiScale', '100'); set('showLeftPanel', 'true'); set('showRightPanel', 'true'); set('leftPanelWidth', '300'); set('actualLeftPanelWidth', '300'); set('rightPanelWidth', '340');
  set('useCustomBackground', 'true'); set('bgOpacity', opacity); set('bgBlur', blur);
  // OFF reproduces MAIN exactly: no backdrop, and the frame's own panels paint
  // the custom-bg rule again (the injected rule has the same specificity as the
  // has-panel-backdrop override and comes later, so it wins). Hiding the
  // backdrop alone would leave the panels transparent and measure 100%
  // wallpaper — a number that describes neither build.
  const restorePaint = `body.custom-bg.has-panel-backdrop .three-panel-container .main-panel,
body.custom-bg.has-panel-backdrop .three-panel-container .left-panel,
body.custom-bg.has-panel-backdrop .three-panel-container .controls-panel{background:rgba(var(--color-background-rgb,16,16,31),var(--bg-opacity,0.9))!important;backdrop-filter:blur(var(--bg-blur,0px));-webkit-backdrop-filter:blur(var(--bg-blur,0px))}`;
  const css = `*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important}${off ? '.cv-backdrop{display:none!important}' + restorePaint : ''}`;
  const inject = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); };
  if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject, { once: true });
}, { user: FIXTURE_USER, token: FIXTURE_TOKEN, off: OFF, opacity: OPACITY, blur: BLUR });
await ctx.route('**/*', async (r) => {
  const url = r.request().url();
  if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort();
  if (/\/api\//.test(url)) { const f = resolveFixture(new URL(url).pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f === null ? [] : f) }); }
  if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort();
  return r.continue();
});
const page = await ctx.newPage();
await page.goto(origin + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cv-dashboard', { timeout: 20000 });
await page.evaluate(({ opacity, blur }) => {
  document.body.classList.add('custom-bg');
  let bg = document.getElementById('bg-layer');
  if (!bg) { bg = document.createElement('div'); bg.id = 'bg-layer'; document.querySelector('.terminal-container')?.prepend(bg); }
  bg.innerHTML = ''; bg.style.cssText = 'position:fixed;inset:0;z-index:-1;background:#ff00ff';
  document.documentElement.style.setProperty('--bg-opacity', String(Number(opacity) / 100));
  document.documentElement.style.setProperty('--bg-blur', blur + 'px');
}, { opacity: OPACITY, blur: BLUR });
await page.waitForTimeout(800);

const dash = await page.$eval('.cv-dashboard', (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; });
const patches = [{ name: 'left', x: dash.x + 40 }, { name: 'main', x: dash.x + Math.round(dash.width / 2) }, { name: 'right', x: dash.x + dash.width - 60 }].map((p) => ({ ...p, y: dash.y + Math.round(dash.height * 0.6), w: 24, h: 24 }));

const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 } }));
const stats = patches.map((p) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const i = (y * png.width + x) * 4; r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++; }
  r /= n; g /= n; b /= n;
  // Magenta share: how far the pixel sits from the theme surface toward #ff00ff.
  // Theme dark surface is ~(16,16,31); magenta is (255,0,255). Use the red channel.
  const share = Math.max(0, (r - 16) / (255 - 16));
  return { name: p.name, hex: '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), wallpaper: (share * 100).toFixed(1) + '%' };
});
const layers = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const bg = (el) => (el ? getComputedStyle(el).backgroundColor : 'n/a');
  const bf = (el) => (el ? getComputedStyle(el).backdropFilter : 'n/a');
  return {
    backdropLeft: bg(q('.cv-backdrop-left')), realLeft: bg(q('.left-panel-component .left-panel, .left-panel')),
    realLeftFilter: bf(q('.left-panel-component .left-panel, .left-panel')), backdropLeftFilter: bf(q('.cv-backdrop-left')),
    bodyClasses: document.body.className,
  };
});
console.log(`backdrop=${OFF ? 'OFF' : 'on'} opacity=${OPACITY} blur=${BLUR}`);
for (const s of stats) console.log(`  ${s.name.padEnd(5)} ${s.hex} wallpaper=${s.wallpaper}`);
console.log('  layers:', JSON.stringify(layers));
await browser.close(); server.close();
