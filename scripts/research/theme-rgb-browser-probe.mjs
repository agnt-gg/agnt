#!/usr/bin/env node
/** Research fixture, not an app/E2E acceptance gate. No app server or network. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--browser' || !args[1])) {
  throw new Error('Usage: node scripts/research/theme-rgb-browser-probe.mjs [--browser /path/to/chromium]');
}
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mainFile = 'frontend/src/styles/main.css';
// Preserve main.css palette import order, without loading fonts, app code, or assets.
const files = ['frontend/src/styles/base/_variables.css', ...Array.from(
  read(mainFile).matchAll(/@import\s+['"]\.\/(themes\/[^'"]+\.css)['"]/g),
  ([, file]) => `frontend/src/styles/${file}`,
)];
if (!files.some((file) => file.endsWith('/_light.css'))) throw new Error('Expected palette imports not found');
const rendererFile = 'frontend/public/js/libs/html2canvas.js';
const sources = [mainFile, ...files, rendererFile, 'scripts/research/theme-rgb-browser-probe.mjs'].map((file) => ({
  file,
  sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
}));
const themes = ['', 'dark', 'dark cyberpunk', 'dark midnight', 'dark ember', 'dark nord', 'rose', 'dark hacker'];
if (files.some((file) => file.endsWith('/_everforest.css'))) themes.push('everforest', 'dark everforest');
const browser = await chromium.launch({ headless: true, ...(args[1] ? { executablePath: args[1] } : {}) });
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  await page.addStyleTag({ content: files.map(read).join('\n') + '\n*{transition:none!important;animation:none!important}' });
  const palette = await page.evaluate((classes) => {
    // Historical aliases are explicit. Removing the suffix alone maps purple incorrectly.
    const mapping = {
      '--green-rgb': '--color-green', '--primary-rgb': '--color-primary',
      '--red-rgb': '--color-red', '--blue-rgb': '--color-blue', '--yellow-rgb': '--color-yellow',
      '--orange-rgb': '--color-orange', '--color-background-rgb': '--color-background',
      '--color-primary-rgb': '--color-primary', '--color-green-rgb': '--color-green',
      '--color-yellow-rgb': '--color-yellow', '--color-accent-rgb': '--color-primary',
      '--pink-rgb': '--color-pink', '--indigo-rgb': '--color-indigo',
      '--color-blue-rgb': '--color-blue', '--color-purple-rgb': '--color-indigo',
      '--violet-rgb': '--color-violet',
    };
    const ctx = document.createElement('canvas').getContext('2d');
    function sample(value) {
      const element = document.createElement('div');
      element.style.backgroundColor = value;
      document.body.append(element);
      const computed = getComputedStyle(element).backgroundColor;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#010203';
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const pixel = [...ctx.getImageData(0, 0, 1, 1).data];
      element.remove();
      return { computed, pixel };
    }
    const comparisons = [];
    for (const theme of classes) {
      document.body.className = theme;
      for (const [triplet, color] of Object.entries(mapping)) {
        const legacy = sample(`rgba(var(${triplet}), .9)`);
        const relative = sample(`rgb(from var(${color}) r g b / .9)`);
        comparisons.push({
          theme: theme || 'light', triplet, color, legacy, relative,
          equalPixels: JSON.stringify(legacy.pixel) === JSON.stringify(relative.pixel),
        });
      }
    }
    document.body.className = 'dark midnight';
    // Reproduce the assignment in applyCurrentThemeBackground, without importing the store.
    document.body.style.setProperty('--color-background', 'transparent');
    const customBackground = {
      legacy: sample('rgba(var(--color-background-rgb), .9)'),
      relative: sample('rgb(from var(--color-background) r g b / .9)'),
    };
    document.body.style.removeProperty('--color-background');
    ctx.fillStyle = '#010203';
    ctx.fillStyle = 'rgba(var(--green-rgb), .2)';
    return {
      userAgent: navigator.userAgent,
      relativeSyntaxSupported: CSS.supports('color', 'rgb(from #19ef83 r g b / .1)'),
      alpha: 0.9,
      comparisons,
      customBackground,
      unresolvedCanvas: { sentinel: '#010203', afterAssignment: ctx.fillStyle },
    };
  }, themes);

  // Fresh document: prevent unrelated theme declarations from contaminating capture.
  await page.setContent('<!doctype html><html><body style="background:white;color:black"><div id="fixture" style="width:40px;height:40px;--color-green:#19ef83;--green-rgb:25,239,131"></div></body></html>');
  await page.addScriptTag({ content: read(rendererFile) });
  const capture = await page.evaluate(async () => {
    const element = document.getElementById('fixture');
    const results = [];
    for (const [value, resolvedExpression] of [
      ['rgba(var(--green-rgb), .1)', 'rgba(25, 239, 131, .1)'],
      ['rgb(from var(--color-green) r g b / .1)', 'rgb(from #19ef83 r g b / .1)'],
      ['color-mix(in srgb, var(--color-green) 10%, transparent)', 'color-mix(in srgb, #19ef83 10%, transparent)'],
    ]) {
      // A rejected assignment must not leave the preceding legacy value in place.
      // Check a concrete expression too: var() can defer validation until computation.
      element.style.backgroundColor = '';
      element.style.backgroundColor = value;
      const acceptedStyle = element.style.backgroundColor;
      const syntaxSupported = CSS.supports('background-color', resolvedExpression);
      const computed = getComputedStyle(element).backgroundColor;
      const observation = { value, acceptedStyle, syntaxSupported, computed };
      if (!acceptedStyle || !syntaxSupported) {
        results.push({ ...observation, ok: null, skipped: 'Expression unsupported; capture not attempted' });
        continue;
      }
      try {
        const canvas = await window.html2canvas(element, { logging: false });
        results.push({ ...observation, ok: true, width: canvas.width, height: canvas.height });
      } catch (error) {
        results.push({ ...observation, ok: false, error: error.message });
      }
    }
    return results;
  });
  // Exit 0 means observations were collected, NOT that migration is safe.
  console.log(JSON.stringify({
    schema: 'agnt.theme-rgb-browser-research.v1',
    capturedAt: new Date().toISOString(),
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    browserVersion: browser.version(),
    sources,
    scope: 'Palette-only DOM fixture at alpha .9; isolated vendored html2canvas capture; no app E2E or minimum-engine proof.',
    summary: {
      comparisons: palette.comparisons.length,
      equalPixels: palette.comparisons.filter((comparison) => comparison.equalPixels).length,
      differentPixels: palette.comparisons.filter((comparison) => !comparison.equalPixels).length,
    },
    palette,
    capture,
  }, null, 2));
} finally {
  await browser.close();
}
