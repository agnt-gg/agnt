// Photograph EVERY screen of the real dist/ and dump its interactive inventory
// (headings, buttons, tabs, inputs, links) so the mockup coverage table is
// grounded in the DOM, not in memory. Read-only against the repo.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const FE = process.env.AGNT_FE || 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/frontend';
const require = createRequire(FE + '/package.json');
const { chromium } = require('playwright');
const { serveDist } = await import('file:///' + FE + '/tools/pixel/serve.mjs');
const { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } = await import('file:///' + FE + '/tools/pixel/fixtures.mjs');
const OUT = process.env.AGNT_OUT || 'C:/Users/Studio/AppData/Roaming/AGNT/projects/agnt-one/real/';
fs.mkdirSync(OUT, { recursive: true });

// [name, route, optional prepare(page)]
const clickText = (sel, text) => async (page) => { await page.locator(sel, { hasText: text }).first().click({ timeout: 4000 }); };
const ONLY = (process.env.AGNT_ROUTES||'').split(',').filter(Boolean);
const ROUTES_ALL = [
  ['chat', '/chat'], ['workspace', '/workspace'], ['marketplace', '/marketplace'],
  ['dashboard', '/dashboard'], ['goals', '/goals'], ['artifacts', '/artifacts'], ['traces', '/traces'],
  ['agents', '/agents'], ['agent-forge', '/agent-forge'], ['workflows', '/workflows'], ['workflow-forge', '/workflow-forge'],
  ['tools', '/tools'], ['tool-forge', '/tool-forge'], ['skills', '/skills'], ['plugins', '/plugins'],
  ['providers', '/providers'],
  ['widget-manager', '/widget-manager'], ['widget-forge', '/widget-forge'],
  ['connectors', '/connectors'],
  ['connectors-email', '/connectors', clickText('.left-panel-component *', 'Emails')],
  ['connectors-mcp', '/connectors', clickText('.left-panel-component *', 'MCP')],
  ['connectors-vault', '/connectors', clickText('.left-panel-component *', 'Vault')],
  ['connectors-webhooks', '/connectors', clickText('.left-panel-component *', 'Webhooks')],
  ['settings', '/settings'],
  ['settings-billing', '/settings', clickText('.left-panel-component *', 'Billing')],
  ['settings-profile', '/settings', clickText('.left-panel-component *', 'Profile')],
  ['settings-referrals', '/settings', clickText('.left-panel-component *', 'Referrals')],
  ['settings-remote-access', '/settings', clickText('.left-panel-component *', 'Remote Access')],
  ['settings-remote-backend', '/settings', clickText('.left-panel-component *', 'Remote Backend')],
  ['settings-security', '/settings', clickText('.left-panel-component *', 'Security')],
  ['settings-theme', '/settings', clickText('.left-panel-component *', 'Theme')],
  ['settings-tours', '/settings', clickText('.left-panel-component *', 'Tours')],
  ['memory', '/memory'], ['evolution', '/experiments'], ['autonomy', '/autonomy'],
  ['docs', '/docs'], ['pair', '/pair'], ['ball-jumper', '/ball-jumper'],
];

const ROUTES = ONLY.length ? ROUTES_ALL.filter(([n]) => ONLY.includes(n)) : ROUTES_ALL;
const seed = ({ user, token }) => {
  let s = 0x2f6e2b1; Math.random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
  const set = (k, v) => localStorage.setItem(k, v);
  set('token', token); set('user', JSON.stringify(user)); set('userId', user.id);
  set('onboardingCompleted', 'true'); set('hasSeenOnboarding', 'true'); set('hasCompletedOnboarding', 'true');
  set('tours_enabled', 'false'); set('tours_auto_start', 'false');
  set('currentTheme', 'dark'); set('greyscaleMode', 'false'); set('useCustomBackground', 'false'); set('uiScale', '100'); set('fontFamily', 'default');
  set('showLeftPanel', 'true'); set('showRightPanel', 'true'); set('leftPanelCollapsed', 'false'); set('rightPanelCollapsed', 'false');
  set('leftPanelWidth', '260'); set('actualLeftPanelWidth', '260'); set('rightPanelWidth', '320'); set('panelPosition', 'default');
  set('isPromoBannerClosed', 'true'); set('isRateLimitBannerClosed', 'true'); set('agnt:canvasSidebar:expanded', 'true');
  const css = `*,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;animation-iteration-count:1!important;animation-fill-mode:forwards!important;transition-duration:1ms!important;transition-delay:0ms!important;caret-color:transparent!important}.scanline-overlay,.scanlines,[class*="scanline"]{display:none!important}`;
  const inject = () => { if (!document.head && !document.documentElement) return false; const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); return true; };
  if (!inject()) document.addEventListener('DOMContentLoaded', inject, { once: true });
};
const settle = async (page, tr, { reads = 4, gap = 150, quietMs = 900, timeout = 20000 } = {}) => {
  const t0 = Date.now(); let stable = 0, last = '';
  while (Date.now() - t0 < timeout) {
    const quiet = tr.inFlight === 0 && Date.now() - tr.last >= quietMs;
    const sig = quiet ? await page.evaluate(() => `${document.querySelectorAll('*').length}:${(document.body?.innerText || '').length}`).catch(() => 'err') : 'busy';
    if (quiet && sig === last) { if (++stable >= reads) return true; } else { stable = 0; last = sig; }
    await page.waitForTimeout(gap);
  }
  return false;
};

const { server, origin } = await serveDist(FE + '/dist');
const browser = await chromium.launch();
const inventory = {};
for (const [name, route, prepare] of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-US' });
  await ctx.addInitScript(seed, { user: FIXTURE_USER, token: FIXTURE_TOKEN });
  await ctx.route('**/*', async (r) => {
    const url = r.request().url();
    if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort();
    if (/\/api\//.test(url)) { const f = resolveFixture(new URL(url).pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f === null ? [] : f) }); }
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort();
    return r.continue();
  });
  const tr = { inFlight: 0, last: Date.now() };
  ctx.on('request', () => { tr.inFlight++; tr.last = Date.now(); });
  const done = () => { tr.inFlight = Math.max(0, tr.inFlight - 1); tr.last = Date.now(); };
  ctx.on('requestfinished', done); ctx.on('requestfailed', done);
  await ctx.clock.install({ time: new Date('2026-09-02T09:41:00Z') }); await ctx.clock.setFixedTime(new Date('2026-09-02T09:41:00Z'));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  try {
    await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await settle(page, tr);
    if (prepare) { try { await prepare(page); await settle(page, tr); } catch (e) { console.log('  prepare failed', name, e.message.split('\n')[0]); } }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: OUT + name + '.png', animations: 'disabled' });
    const inv = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const txt = (el) => (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const region = (el) => el.closest('.cv-sidebar') ? 'rail' : el.closest('.cv-toolbar') ? 'toolbar' : el.closest('.left-panel-component') ? 'left' : el.closest('.right-panel-component') ? 'right' : 'center';
      const out = { headings: [], buttons: [], tabs: [], inputs: [], links: [] };
      document.querySelectorAll('h1,h2,h3,h4,.section-title,.panel-title,.header-title').forEach((el) => { if (vis(el)) { const t = txt(el); if (t) out.headings.push(region(el) + ':' + t); } });
      document.querySelectorAll('button,[role=button],.btn,.action-btn,.icon-btn').forEach((el) => { if (vis(el)) { const t = txt(el) || '(icon:' + (el.querySelector('i,svg')?.className?.baseVal || el.querySelector('i')?.className || '?') + ')'; out.buttons.push(region(el) + ':' + t); } });
      document.querySelectorAll('[role=tab],.tab,.filter-chip,.chip,.segment,.cv-pbtn').forEach((el) => { if (vis(el)) { const t = txt(el); if (t) out.tabs.push(region(el) + ':' + t); } });
      document.querySelectorAll('input,textarea,select').forEach((el) => { if (vis(el)) out.inputs.push(region(el) + ':' + (el.type || el.tagName.toLowerCase()) + ' ' + (el.placeholder || el.name || el.id || '')); });
      document.querySelectorAll('a[href]').forEach((el) => { if (vis(el) && !el.closest('.cv-sidebar')) { const t = txt(el); if (t) out.links.push(region(el) + ':' + t); } });
      const uniq = (a) => [...new Set(a)];
      for (const k in out) out[k] = uniq(out[k]);
      out.text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 6000);
      return out;
    });
    inv.errors = errs;
    inventory[name] = inv;
    if (errs.length) console.log('  ERRORS', name, JSON.stringify(errs.slice(0, 5)));
    fs.writeFileSync(OUT + name + '.txt', JSON.stringify(inv, null, 1));
    console.log(name.padEnd(24), 'h', inv.headings.length, 'btn', inv.buttons.length, 'tabs', inv.tabs.length, 'in', inv.inputs.length);
  } catch (e) { console.log(name.padEnd(24), 'FAILED', e.message.split('\n')[0]); }
  await ctx.close();
}
fs.writeFileSync(OUT + 'inventory.json', JSON.stringify(inventory, null, 1));
await browser.close(); server.close();
