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

describe('the Lite variant stays deleted', () => {
  // AGNT Lite was removed in 2026-08: after the packaging slim-down its removal
  // list saved ~0 MB, it had shipped one real bug (deleting puppeteer-core,
  // which web scraping imports), and its second update feed — two variants
  // both emitting latest.yml into one release — was the blocker on auto-update.
  // One product, one artifact per platform, one feed. These pin the deletion so
  // it cannot creep back through a convenience script or a copied config.
  it('no lite build scripts', () => {
    for (const name of Object.keys(pkg.scripts ?? {})) {
      expect(name, `script "${name}" reintroduces a build variant`).not.toMatch(/lite|both/);
    }
  });

  it('artifact names carry no variant slot', () => {
    for (const platform of ['win', 'mac', 'linux']) {
      expect(pkg.build?.[platform]?.artifactName ?? '').not.toContain('AGNT_BUILD_VARIANT');
    }
  });

  it('no AGNT_LITE_MODE anywhere in the build config', () => {
    expect(JSON.stringify(pkg.build)).not.toContain('AGNT_LITE_MODE');
  });

  it('the variant files are gone', () => {
    for (const f of ['Dockerfile.lite', 'docker-compose.lite.yml', 'docker-compose.both.yml',
                     'scripts/electron-builder-lite.js', 'backend/src/utils/liteModeHelper.js']) {
      expect(fs.existsSync(path.join(REPO_ROOT, f)), `${f} is back`).toBe(false);
    }
  });

  it('ANTI-VACUITY: mobile-lite — the unrelated Capacitor iOS shell — survives', () => {
    // "lite" names three unrelated things in this repo. Deleting the BUILD
    // VARIANT must not clip the mobile shell; if this ever fails, a cleanup
    // matched the substring instead of the token.
    expect(fs.existsSync(path.join(REPO_ROOT, 'mobile', 'mobile-lite', 'package.json'))).toBe(true);
    expect(fs.readFileSync(path.join(REPO_ROOT, 'Makefile'), 'utf8')).toMatch(/mobile-lite-info:/);
  });
});

describe('the build config obeys electron-builder’s schema', () => {
  // electron-builder validates `build` against a strict schema and rejects the
  // WHOLE config on an unknown key, before doing any work. Two separate
  // attempts to document decisions in place have been thrown out by it: a
  // "_comment_" field, and verifyUpdateCodeSignature declared on `nsis` instead
  // of `win`. It fails fast and loudly, which is the good case — but it fails
  // at BUILD time, which is a slow way to learn.
  const walk = (obj, trail = 'build') => {
    const bad = [];
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (k.startsWith('_')) bad.push(`${trail}.${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) bad.push(...walk(v, `${trail}.${k}`));
    }
    return bad;
  };

  it('carries no comment keys — JSON has no comments and the schema has no mercy', () => {
    expect(
      walk(pkg.build),
      'put the reasoning in the script or the test that enforces it, not in the config',
    ).toEqual([]);
  });
});

describe('native modules must load inside ELECTRON, not just inside Node', () => {
  // AGNT 0.6.6 shipped an installer that could not start: the backend died
  // three seconds in with 0xC0000005 because sqlite3 was compiled for Node's
  // runtime instead of Electron's. On Windows that is an access violation, not
  // an exception, so nothing caught it and nothing logged it.
  //
  // It went unnoticed because the dev server forks REAL Node for the backend,
  // where the same binary is perfectly fine. Only the packaged app uses
  // utilityProcess, which is Electron.
  const postinstall = pkg.scripts?.postinstall ?? '';

  it('the repair script exists', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'rebuild-native-for-electron.js'))).toBe(true);
  });

  it('postinstall runs it', () => {
    expect(postinstall).toMatch(/rebuild-native-for-electron\.js/);
  });

  it('it runs AFTER install-app-deps, which is what leaves them broken', () => {
    // electron-builder's rebuild re-runs each package's own install script, and
    // sqlite3's hardcodes `-r napi`, which overrides the Electron target. The
    // repair has to come after that, or it just gets undone.
    const deps = postinstall.indexOf('install-app-deps');
    const repair = postinstall.indexOf('rebuild-native-for-electron');
    expect(deps).toBeGreaterThanOrEqual(0);
    expect(repair).toBeGreaterThan(deps);
  });

  it('electron-builder is NOT asked to rebuild at package time', () => {
    // npmRebuild: true would re-run that same broken install script after the
    // repair, undoing it. Measured, not assumed — that path produced a binary
    // that aborts inside Electron.
    expect(pkg.build?.npmRebuild).toBe(false);
  });

  it('the build REFUSES to finish if a native module cannot load', () => {
    // The postinstall repair is best-effort by design (a machine with no C++
    // toolchain must still be able to `npm install`). This is the part that is
    // not optional: the afterPack hook loads every native module inside the
    // packaged binary and throws if one aborts.
    const hooks = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'electron-builder-hooks.js'), 'utf8');
    expect(hooks).toMatch(/verifyNativeModules/);
    expect(hooks).toMatch(/ELECTRON_RUN_AS_NODE/);
    expect(hooks).toMatch(/throw new Error/);
  });

  it('ANTI-VACUITY: the hook is actually wired into the build', () => {
    // Every assertion above would pass on a hook nothing ever calls.
    expect(pkg.build?.afterPack).toMatch(/electron-builder-hooks/);
  });
});

describe('locale trimming', () => {
  const afterPack = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'electron-builder-hooks.js'), 'utf8');

  it('keeps en-US, which Chromium cannot start without', () => {
    expect(afterPack).toMatch(/KEEP_LOCALES\s*=\s*new Set\(\[\s*'en-US'/);
  });

  it('only ever deletes .pak files, so a wrong path cannot destroy anything else', () => {
    expect(afterPack).toMatch(/endsWith\('\.pak'\)/);
  });
});
