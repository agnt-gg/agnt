// Diagnostic: does text actually PAINT in the harness, or only exist in the DOM?
// A gate that photographs invisible text is blind to every text regression.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveDist } from './serve.mjs';
import { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../../dist');

const { server, origin } = await serveDist(DIST);
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

await context.addInitScript(({ user, token }) => {
  const set = (k, v) => window.localStorage.setItem(k, v);
  set('token', token);
  set('user', JSON.stringify(user));
  set('hasCompletedOnboarding', 'true');
  set('tours_enabled', 'false');
  set('currentTheme', 'dark');
}, { user: FIXTURE_USER, token: FIXTURE_TOKEN });

await context.route('**/*', async (r) => {
  const url = r.request().url();
  if (/\/api\//.test(url)) {
    const fx = resolveFixture(new URL(url).pathname);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx === null ? [] : fx) });
  }
  if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort();
  return r.continue();
});

const page = await context.newPage();
await page.goto(origin + '/experiments', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const el = document.querySelector('.card-name');
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  // Walk ancestors looking for anything that would hide it.
  const chain = [];
  let n = el;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    chain.push({
      tag: n.tagName + (n.className ? '.' + String(n.className).split(' ')[0] : ''),
      opacity: s.opacity,
      visibility: s.visibility,
      color: s.color,
      animation: s.animationName,
    });
    n = n.parentElement;
  }
  return {
    found: true,
    text: el.textContent.trim().slice(0, 60),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    color: cs.color,
    opacity: cs.opacity,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontsReady: document.fonts.status,
    loadedFonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).slice(0, 8),
    chain: chain.slice(0, 6),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});
console.log(JSON.stringify(report, null, 2));

if (report.found) {
  const shot = path.join(HERE, 'shots', 'probe-cardname.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  const { x, y, w, h } = report.rect;
  await page.screenshot({ path: shot, clip: { x, y: y - 2, width: Math.max(w, 10), height: h + 4 } });
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let min = 255, max = 0, distinct = new Set();
  for (let i = 0; i < data.length; i += info.channels) {
    const l = Math.round(data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11);
    min = Math.min(min, l); max = Math.max(max, l); distinct.add(l >> 3);
  }
  console.log(`\nCARD TITLE CROP ${info.width}x${info.height}: luminance ${min}..${max}, ${distinct.size} distinct bands`);
  console.log(max - min > 40 ? 'TEXT IS PAINTING (strong contrast within the title box)' : 'NO INK — the title box is flat, text is not painting');
}

await browser.close();
server.close();
