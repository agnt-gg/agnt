// Pixel harness — deterministic screenshots of every AGNT screen.
//
// Usage:  node shoot.mjs <label> [--routes a,b,c] [--discover]
//   label      subdirectory under shots/  (e.g. "before", "after")
//   --discover also print every /api path the app asked for, and whether a
//              fixture answered it (used to grow fixtures.mjs)
//
// Traps this harness deliberately avoids (each one cost a cycle before):
//   · playwright resolves out of the SIBLING agnt-pro checkout -> createRequire
//   · the bundled chromium is NOT installed on this box -> channel: 'msedge'
//   · deviceScaleFactor MUST be 1, or every measurement in a review is 2x
//   · a FIXED sleep reads pre-transition state -> poll until the DOM is stable
//   · never background the server from a shell -> it lives in this process
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist } from './serve.mjs';
import { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../../dist');
const SHOTS = path.join(HERE, 'shots');

const VIEWPORT = { width: 1440, height: 900 };

// Every screen worth a pixel. Terminal screens plus the standalone views.
export const ROUTES = [
  ['chat', '/chat'],
  ['dashboard', '/dashboard'],
  ['agents', '/agents'],
  ['tools', '/tools'],
  ['workflows', '/workflows'],
  ['skills', '/skills'],
  ['memory', '/memory'],
  ['goals', '/goals'],
  ['traces', '/traces'],
  ['experiments', '/experiments'],
  ['marketplace', '/marketplace'],
  ['widget-manager', '/widget-manager'],
  ['artifacts', '/artifacts'],
  ['connectors', '/connectors'],
  ['settings', '/settings'],
  ['autonomy', '/autonomy'],
  ['agent-forge', '/agent-forge'],
  ['tool-forge', '/tool-forge'],
  ['widget-forge', '/widget-forge'],
  ['workflow-forge', '/workflow-forge'],
  ['workspace', '/workspace'],
];

const label = process.argv[2];
if (!label) {
  console.error('usage: node shoot.mjs <label> [--routes a,b] [--discover]');
  process.exit(1);
}
const discover = process.argv.includes('--discover');
const routesArg = (process.argv.find((a) => a.startsWith('--routes=')) || '').split('=')[1];
const routes = routesArg ? ROUTES.filter(([n]) => routesArg.split(',').includes(n)) : ROUTES;

const outDir = path.join(SHOTS, label);
// Wipe first. Leftovers from an earlier run with a different --routes set make
// compare.mjs report routes this run never took, which reads as a phantom diff.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

/** Seeded before any app code runs: auth + a pinned, deterministic theme. */
const seedState = ({ user, token }) => {
  // Determinism, part 1: a seeded PRNG. Sparklines, gradients and shuffled
  // demo data call Math.random at mount; unseeded, every run paints different
  // pixels and the differ can never reach zero.
  let seed = 0x2f6e2b1;
  Math.random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 1e6) / 1e6;
  };

  const set = (k, v) => window.localStorage.setItem(k, v);
  set('token', token);
  set('user', JSON.stringify(user));
  set('userId', user.id);
  set('onboardingCompleted', 'true');
  set('hasSeenOnboarding', 'true');
  // userAuth reads exactly this key; without it the 7-step onboarding modal
  // covers every screen and the whole run photographs the same dialog.
  set('hasCompletedOnboarding', 'true');
  // PopupTutorial coach-marks ('Show Me Around') auto-start on some screens and
  // land a step or two late, so they appear in one run and not the next.
  set('tours_enabled', 'false');
  set('tours_auto_start', 'false');
  // Pin every layout/theme knob so a diff can only come from code.
  set('currentTheme', 'dark');
  set('greyscaleMode', 'false');
  set('useCustomBackground', 'false');
  set('uiScale', '1');
  set('fontFamily', 'default');
  set('showLeftPanel', 'true');
  set('showRightPanel', 'true');
  set('leftPanelCollapsed', 'false');
  set('rightPanelCollapsed', 'false');
  set('leftPanelWidth', '260');
  set('actualLeftPanelWidth', '260');
  set('rightPanelWidth', '320');
  set('panelPosition', 'default');
  set('isPromoBannerClosed', 'true');
  set('isRateLimitBannerClosed', 'true');
  // Kill animation nondeterminism at the source. This init script runs before
  // the document exists, so the node has to be parked until there is a head.
  // DO NOT set animation-duration to 0 with no fill-mode. A reveal animation
  // that runs 0 -> 1 opacity then has nothing holding the end state snaps back
  // to its INITIAL keyframe, so every animated label photographs as blank and
  // the screen looks broken. Fast-forward instead of cancel: 1ms + forwards.
  const css = `*,*::before,*::after{
      animation-duration:1ms!important;
      animation-delay:0ms!important;
      animation-iteration-count:1!important;
      animation-fill-mode:forwards!important;
      transition-duration:1ms!important;
      transition-delay:0ms!important;
      caret-color:transparent!important;
    }
    .scanline-overlay,.scanlines,[class*="scanline"]{display:none!important}`;
  const inject = () => {
    if (!document.head && !document.documentElement) return false;
    const style = document.createElement('style');
    style.setAttribute('data-harness', 'freeze');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return true;
  };
  if (!inject()) document.addEventListener('DOMContentLoaded', inject, { once: true });
};

/**
 * Wait until the page is genuinely done: no API calls in flight AND the DOM has
 * stopped changing.
 *
 * DOM-stability alone is NOT enough and produced a flaky harness: the shell
 * paints, the list request is still in flight, the DOM sits still for half a
 * second, the poll declares victory and photographs "0 agents". The same route
 * then shot 6 agents on the next run. Requests in flight are the missing term.
 */
const waitForSettle = async (page, tracker, { reads = 4, gap = 150, quietMs = 900, timeout = 25000 } = {}) => {
  const started = Date.now();
  let stable = 0;
  let last = '';
  while (Date.now() - started < timeout) {
    const quiet = tracker.inFlight === 0 && Date.now() - tracker.lastActivity >= quietMs;
    const sig = quiet
      ? await page
          .evaluate(() => {
            const n = document.querySelectorAll('*').length;
            const t = (document.body?.innerText || '').length;
            const busy = document.querySelectorAll('.fa-spinner, .spinner, [class*="skeleton"]').length;
            return `${n}:${t}:${busy}`;
          })
          .catch(() => 'err')
      : `busy:${tracker.inFlight}`;
    if (quiet && sig === last) {
      if (++stable >= reads) return true;
    } else {
      stable = 0;
      last = sig;
    }
    await page.waitForTimeout(gap);
  }
  return false;
};

const run = async () => {
  const { server, origin } = await serveDist(DIST);
  console.log(`serving ${DIST} at ${origin}`);

  const browser = await chromium.launch({ channel: 'msedge' });
  const unmatched = new Set();
  const results = [];

  try {
    for (const [name, route] of routes) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        timezoneId: 'UTC',
        locale: 'en-US',
      });
      await context.addInitScript(seedState, { user: FIXTURE_USER, token: FIXTURE_TOKEN });

      // Answer every API call from fixtures; nothing leaves this machine.
      await context.route('**/*', async (routeObj) => {
        const url = routeObj.request().url();
        const isApi = /\/api\//.test(url);
        const isSocket = /socket\.io|\/ws(\?|$)/.test(url);
        const isExternal = !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:');

        if (isSocket) return routeObj.abort();
        if (isApi) {
          const pathname = new URL(url).pathname;
          const fixture = resolveFixture(pathname);
          if (fixture === null) unmatched.add(pathname);
          return routeObj.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fixture === null ? [] : fixture),
          });
        }
        if (isExternal) return routeObj.abort(); // no fonts/CDN/telemetry off-box
        return routeObj.continue();
      });

      // Track ALL traffic, not just /api/.
      //
      // Screens are lazy chunks. Counting only API calls meant a slow chunk
      // could land AFTER the quiet window, fire its data fetch, and repaint a
      // screen we had already photographed as empty — which is exactly how
      // /agents shot "0 agents" on one run and "6 agents" on the next. The
      // chunk request is the event that predicts the fetch, so it has to count.
      const tracker = { inFlight: 0, lastActivity: Date.now() };
      const bump = () => { tracker.lastActivity = Date.now(); };
      context.on('request', () => { tracker.inFlight++; bump(); });
      const settleReq = () => { tracker.inFlight = Math.max(0, tracker.inFlight - 1); bump(); };
      context.on('requestfinished', settleReq);
      context.on('requestfailed', settleReq);

      // Determinism, part 2: freeze the wall clock. The header renders a live
      // HH:MM:SS readout, so without this every single route diffs by the ~50px
      // box under the clock and a real regression hides in the noise.
      // setFixedTime, not install(): install() starts a clock that then TICKS,
      // so the header readout still advanced a few seconds between runs.
      await context.clock.install({ time: new Date('2026-01-15T12:00:00Z') });
      await context.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'));

      const page = await context.newPage();
      page.on('pageerror', (e) => {
        const msg = String(e).split('\n')[0];
        if (!/ResizeObserver|Non-Error promise/.test(msg)) results.push({ name, error: msg });
      });

      await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await waitForSettle(page, tracker);
      // one more frame so any layout write has painted
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const file = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });

      // Semantic channel. A pixel diff says "something moved"; this says WHAT
      // the screen actually contains, so a refactor that silently drops a
      // label or a whole list is caught even if the layout is byte-identical.
      const text = await page.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const main = document.querySelector('.main-panel') || document.body;
        const words = (main.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
        return {
          mainText: words,
          counts: {
            buttons: [...document.querySelectorAll('button')].filter(vis).length,
            inputs: [...document.querySelectorAll('input,textarea')].filter(vis).length,
            // Exclude the layout containers themselves (.card-grid/.card-row),
            // otherwise adopting a shared grid class reads as "6 new cards".
            cards: [...document.querySelectorAll('[class*="card"]:not(.card-grid):not(.card-row)')].filter(vis).length,
            rows: [...document.querySelectorAll('tr,[class*="-row"]:not(.card-row),[class*="-item"]')].filter(vis).length,
            leftPanel: !!document.querySelector('.left-panel-component'),
            rightPanel: !!document.querySelector('.right-panel-component'),
            inputLine: !!document.querySelector('.input-container'),
          },
        };
      });
      fs.writeFileSync(
        path.join(outDir, `${name}.txt`),
        JSON.stringify(text.counts) + '\n' + text.mainText.join('\n'),
      );

      const bytes = fs.statSync(file).size;
      const c = text.counts;
      console.log(
        `  ${name.padEnd(16)} ${String(bytes).padStart(7)}b  L:${c.leftPanel ? 'y' : '-'} R:${c.rightPanel ? 'y' : '-'} in:${c.inputLine ? 'y' : '-'}  cards:${String(c.cards).padStart(3)} rows:${String(c.rows).padStart(3)} btns:${String(c.buttons).padStart(3)}  ${text.mainText.slice(0, 3).join(' / ').slice(0, 46)}`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const errs = results.filter((r) => r.error);
  if (errs.length) {
    console.log('\n=== PAGE ERRORS ===');
    for (const e of errs.slice(0, 20)) console.log(`  ${e.name}: ${e.error}`);
  }
  if (discover && unmatched.size) {
    console.log('\n=== API PATHS WITH NO FIXTURE ===');
    [...unmatched].sort().forEach((p) => console.log('  ' + p));
  }
  console.log(`\nwrote ${routes.length} shots to ${outDir}`);
};

run().catch((e) => {
  console.error('HARNESS FAILED:', e);
  process.exit(1);
});
