/**
 * What the installer must and must not contain.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Packaging is decided by globs in package.json, and a glob has no idea what
 * the code imports. Every rule below was written after something looked
 * obviously removable and was not — or looked load-bearing and was not. The
 * failures are silent and land at RUNTIME, in a packaged app, on a user's
 * machine, which is the worst possible place to find them.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const files = pkg.build?.files ?? [];
const allDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
};

/** Does any glob in build.files exclude this path? */
const isExcluded = (needle) =>
  files.some((rule) => typeof rule === 'string' && rule.startsWith('!') && rule.includes(needle));

describe('runtime imports must be declared, not inherited', () => {
  it('declares puppeteer-core, which three runtime files import directly', () => {
    // web-scrape.js, webScrape.js and WidgetDefinitionService.js all import
    // 'puppeteer-core'. It used to resolve only because `puppeteer` dragged it
    // in transitively — so the package with ZERO imports was the load-bearing
    // one, and deleting the obviously-dead thing broke web scraping at runtime.
    expect(
      allDeps['puppeteer-core'],
      'puppeteer-core is imported at runtime and must be declared explicitly'
    ).toBeTruthy();
  });

  it('ANTI-VACUITY: those imports still exist', () => {
    // If every consumer were deleted, the rule above would be guarding nothing.
    const importers = [
      'backend/src/tools/web-scrape.js',
      'backend/src/services/webScrape.js',
      'backend/src/services/WidgetDefinitionService.js',
    ].filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));

    expect(importers.length, 'no puppeteer-core importers found — is the rule still needed?').toBeGreaterThan(0);

    const anyImports = importers.some((rel) =>
      fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').includes('puppeteer-core')
    );
    expect(anyImports).toBe(true);
  });
});

describe('the ONNX wasm binaries are load-bearing despite appearing browser-only', () => {
  // scripts/patch-onnxruntime.js REWRITES onnxruntime-node's entry point to
  // `require("onnxruntime-web")`, because the native .node bindings do not
  // survive ASAR packaging. So this app runs the WASM backend even though it is
  // a desktop app in a Node process, and `onnxruntime-web/dist/*.wasm` is a
  // hard runtime dependency of speech-to-text.
  //
  // Nothing in any import statement reveals that. Excluding those files looks
  // like free savings and silently breaks transcription.
  it('the patch that makes this true is still in place', () => {
    const patch = path.join(REPO_ROOT, 'scripts', 'patch-onnxruntime.js');
    expect(fs.existsSync(patch), 'patch-onnxruntime.js is gone — re-evaluate the rule below').toBe(true);
    expect(fs.readFileSync(patch, 'utf8')).toMatch(/require\(["']onnxruntime-web["']\)/);
  });

  it('does NOT exclude onnxruntime-web wasm from the package', () => {
    expect(
      isExcluded('onnxruntime-web') && files.some((r) => r.includes('onnxruntime-web') && r.includes('.wasm')),
      'onnxruntime-web/dist/*.wasm is excluded — speech-to-text will fail in the packaged app, ' +
        'because patch-onnxruntime.js routes onnxruntime-node through the WASM backend'
    ).toBe(false);
  });
});

describe('things that are genuinely dead stay out', () => {
  it('does not re-add @ffmpeg-installer', () => {
    // 61.5 MB. Zero imports anywhere: every consumer reads process.env.FFMPEG_PATH,
    // which main.js sets from ffmpeg-static. Two complete ffmpeg builds shipped
    // for years because a declared dependency looked required.
    expect(
      allDeps['@ffmpeg-installer/ffmpeg'],
      '@ffmpeg-installer is unused — ffmpeg-static provides FFMPEG_PATH'
    ).toBeUndefined();
  });

  it('keeps ffmpeg-static, which DOES back FFMPEG_PATH', () => {
    expect(allDeps['ffmpeg-static']).toBeTruthy();
    const main = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');
    expect(main).toMatch(/ffmpeg-static/);
    expect(main).toMatch(/FFMPEG_PATH/);
  });

  it('does not ship playwright as a runtime dependency', () => {
    // @playwright/test is a devDependency and pins playwright transitively for
    // the e2e suite. Declaring it here too put ~10 MB in the installer for a
    // package the app never imports.
    expect(allDeps.playwright, 'playwright belongs to the e2e suite, not the installer').toBeUndefined();
    expect(pkg.devDependencies?.['@playwright/test'], 'the e2e suite still needs this').toBeTruthy();
  });

  it('excludes source maps', () => {
    // 54 MB across node_modules, read by nothing in a packaged app.
    expect(files).toContain('!**/*.js.map');
  });
});

describe('locale trimming', () => {
  const afterPack = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'electron-builder-lite.js'), 'utf8');

  it('keeps en-US, which Chromium cannot start without', () => {
    expect(afterPack).toMatch(/KEEP_LOCALES\s*=\s*new Set\(\[\s*'en-US'/);
  });

  it('only ever deletes .pak files, so a wrong path cannot destroy anything else', () => {
    expect(afterPack).toMatch(/endsWith\('\.pak'\)/);
  });
});
