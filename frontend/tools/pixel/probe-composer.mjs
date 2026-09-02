// Measures the composer buttons on /chat in the built app (fixture-backed).
import { chromium } from 'playwright';
import { serveDist } from './serve.mjs';
import { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { server, origin } = await serveDist(path.join(FE, 'dist'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(({ user, token }) => { const set = (k, v) => localStorage.setItem(k, v); set('token', token); set('user', JSON.stringify(user)); set('userId', user.id); set('hasCompletedOnboarding', 'true'); set('onboardingCompleted', 'true'); set('tours_enabled', 'false'); set('tours_auto_start', 'false'); set('uiScale', '100'); set('showLeftPanel', 'true'); set('showRightPanel', 'true'); }, { user: FIXTURE_USER, token: FIXTURE_TOKEN });
await ctx.route('**/*', async (r) => { const url = r.request().url(); if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort(); if (/\/api\//.test(url)) { const f = resolveFixture(new URL(url).pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f === null ? [] : f) }); } if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort(); return r.continue(); });
const page = await ctx.newPage();
await page.goto(origin + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.input-line', { timeout: 20000 });
await page.waitForTimeout(1200);
const out = await page.evaluate(() => [...document.querySelectorAll('.input-line > *, .input-line .tooltip-container, .input-line button')].map((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { cls: (el.className || el.tagName).toString().slice(0, 40), x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), disp: cs.display, pos: cs.position, flex: cs.flex }; }));
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
