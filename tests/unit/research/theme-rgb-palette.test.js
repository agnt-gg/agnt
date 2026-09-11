import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { collectPalette } from '../../../scripts/research/theme-rgb-palette.mjs';

const requireRoot = createRequire(new URL('../../../package.json', import.meta.url));
let chromium;
try { ({ chromium } = requireRoot('@playwright/test')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('palette comparison classifies invalid and unsupported expressions as inconclusive', {
  skip: !chromium && 'Install root dependencies to run the browser research tests',
}, async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.RGB_RESEARCH_BROWSER ? { executablePath: process.env.RGB_RESEARCH_BROWSER } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<!doctype html><body style="--green-rgb:25,239,131;--color-green:#19ef83;--bad-rgb:invalid;--color-bad:invalid;--different-rgb:1,2,3;--color-different:#040506"></body>');
    const mapping = { '--green-rgb': '--color-green', '--missing-rgb': '--color-missing',
      '--bad-rgb': '--color-bad', '--different-rgb': '--color-different' };
    const result = await page.evaluate(collectPalette, { themes: [''], mapping });
    assert.equal(result.relativeSyntaxSupported, true, 'this fixture requires a relative-color-capable browser');
    assert.equal(result.comparisons[0].equalPixels, true);
    assert.equal(result.comparisons[0].status, 'equal');
    for (const comparison of result.comparisons.slice(1, 3)) {
      assert.equal(comparison.equalPixels, null);
      assert.equal(comparison.status, 'inconclusive');
      assert.ok(comparison.reasons.length);
    }
    assert.equal(result.comparisons[3].equalPixels, false);
    assert.equal(result.comparisons[3].status, 'different');
    // Simulate an older engine at the syntax-support boundary, not a different
    // implementation of the comparator. Neither invalid side may become a match.
    await page.evaluate(() => {
      const original = CSS.supports.bind(CSS);
      CSS.supports = (property, value) => value?.startsWith('rgb(from ') ? false : original(property, value);
    });
    const unsupported = await page.evaluate(collectPalette, { themes: [''], mapping: { '--green-rgb': '--color-green' } });
    assert.equal(unsupported.relativeSyntaxSupported, false);
    assert.equal(unsupported.comparisons[0].equalPixels, null);
    assert.equal(unsupported.comparisons[0].status, 'inconclusive');
  } finally { await browser.close(); }
});
