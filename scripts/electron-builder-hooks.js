/**
 * Electron Builder afterPack hook.
 *
 * Two responsibilities, both applying to every build:
 *
 * 1. macOS code-signing fix — rename directories that merely END in `.app`
 *    (which codesign treats as app bundles and then chokes on).
 * 2. Trim Chromium locale packs AGNT never reads (~40 MB).
 *
 * HISTORY: this file replaces scripts/electron-builder-lite.js. The Lite build
 * variant was removed in 2026-08 — after the packaging slim-down its removal
 * list saved ~0 MB (everything on it was either already gone from the full
 * build or load-bearing), it had shipped one real bug (deleting puppeteer-core,
 * which web scraping imports), and its second update feed was the blocker on
 * auto-update. One product, one artifact per platform, one feed.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Recursively find directories ending in .app that aren't real app bundles
 * (i.e., they don't have a Contents/Info.plist structure)
 */
function findFakeDotAppDirs(dirPath, results = []) {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        if (item.name.endsWith('.app')) {
          // Check if it's a real macOS app bundle
          const infoPlist = path.join(fullPath, 'Contents', 'Info.plist');
          if (!fs.existsSync(infoPlist)) {
            results.push(fullPath);
          }
        } else {
          // Recurse into non-.app directories
          findFakeDotAppDirs(fullPath, results);
        }
      }
    }
  } catch (error) {
    // Ignore permission errors
  }
  return results;
}

/**
 * Locales AGNT actually ships in.
 *
 * Electron bundles a Chromium `.pak` per language — roughly fifty of them, about
 * 38 MB. They drive Chromium's own surfaces: context menus, the print dialog,
 * spellcheck labels. AGNT's interface has no i18n layer and is written in
 * English throughout, so every other pack is weight that is never read.
 *
 * `electronLanguages` in the builder config covers macOS and Linux but NOT
 * Windows, where the packs are loose files under `locales/`. Doing it here
 * covers all three from one place, and keeps the rule and its reason together.
 *
 * en-US.pak is mandatory — Chromium fails to start without its default locale.
 */
const KEEP_LOCALES = new Set(['en-US']);

/**
 * Remove every Chromium locale pack except the ones named above.
 *
 * Deliberately conservative: it only ever touches files ending in `.pak` inside
 * a directory literally named `locales`, so a mis-resolved path cannot delete
 * anything else. A failure here is logged and ignored — a larger installer is
 * not worth failing a release over.
 */
async function trimLocales(localesDir, log = console.log) {
  if (!fs.existsSync(localesDir)) return 0;

  let removed = 0;
  let saved = 0;

  for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.pak')) continue;
    if (KEEP_LOCALES.has(path.basename(entry.name, '.pak'))) continue;

    const full = path.join(localesDir, entry.name);
    try {
      saved += fs.statSync(full).size;
      fs.unlinkSync(full);
      removed += 1;
    } catch (error) {
      log(`[locales] ⚠ could not remove ${entry.name}: ${error.message}`);
    }
  }

  if (removed > 0) {
    log(`[locales] removed ${removed} unused locale pack(s), saved ${formatBytes(saved)}`);
  }
  return saved;
}

/**
 * Every top-level package under app.asar.unpacked that ships a .node binary.
 *
 * Derived from what is actually in the package rather than a hand-kept list, so
 * a native dependency added later is covered without anyone remembering to add
 * it here.
 */
function nativePackages(unpackedNodeModules) {
  if (!fs.existsSync(unpackedNodeModules)) return [];

  const hasNode = (dir) => {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) stack.push(path.join(cur, e.name));
        else if (e.name.endsWith('.node')) return true;
      }
    }
    return false;
  };

  const found = [];
  for (const entry of fs.readdirSync(unpackedNodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      const scope = path.join(unpackedNodeModules, entry.name);
      for (const sub of fs.readdirSync(scope, { withFileTypes: true })) {
        if (sub.isDirectory() && hasNode(path.join(scope, sub.name))) {
          found.push(`${entry.name}/${sub.name}`);
        }
      }
    } else if (hasNode(path.join(unpackedNodeModules, entry.name))) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

/**
 * Prove every native module actually LOADS inside the packaged app.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GATE EXISTS
 * ---------------------------------------------------------------------------
 * AGNT 0.6.6 shipped an installer that could not start. The backend died three
 * seconds in with 0xC0000005 and the window closed, on every machine that
 * installed it. The cause was one native module compiled for Node's ABI instead
 * of Electron's: on Windows such a module binds its imports against node.exe,
 * and inside electron.exe that binding fails as an access violation — a hard
 * abort, no exception, nothing a try/catch can see.
 *
 * Nothing in the build noticed, because every earlier check asked the wrong
 * question. The file was present. Its size was right. It even exported
 * napi_register_module_v1, so an "is it N-API?" test passed. And the developer
 * machine ran fine, because a dev build forks REAL Node for the backend while a
 * packaged build uses utilityProcess, which is Electron.
 *
 * The only question that distinguishes the two is "does it load in the thing we
 * are about to ship", so that is the question this asks: it runs the packaged
 * executable itself, as Node, and requires each module through app.asar exactly
 * as the app will. Assert the end state, never the input that was meant to
 * produce it.
 *
 * Each module gets its own process, because an ABI abort takes the process with
 * it and would hide every module after it.
 */
async function verifyNativeModules(context, appOutDir, appPath) {
  const platformName = context.packager.platform.name; // windows | mac | linux
  const hostMatches =
    (platformName === 'windows' && process.platform === 'win32') ||
    (platformName === 'mac' && process.platform === 'darwin') ||
    (platformName === 'linux' && process.platform === 'linux');

  const unpacked = path.join(appPath, 'app.asar.unpacked', 'node_modules');
  const modules = nativePackages(unpacked);

  if (modules.length === 0) {
    console.log('[native] no unpacked native modules to verify');
    return;
  }

  if (!hostMatches) {
    // Cross-building: the packaged binary cannot run here. Say so plainly
    // rather than passing silently, because an unverified build is exactly what
    // shipped 0.6.6.
    console.log(
      `[native] ⚠ cross-platform build (${platformName} on ${process.platform}) — ` +
        `CANNOT verify ${modules.length} native module(s): ${modules.join(', ')}`,
    );
    return;
  }

  const productName = context.packager.appInfo.productFilename;
  const exe =
    platformName === 'windows'
      ? path.join(appOutDir, `${productName}.exe`)
      : platformName === 'mac'
        ? path.join(appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName)
        : path.join(appOutDir, context.packager.executableName || productName.toLowerCase());

  if (!fs.existsSync(exe)) {
    console.log(`[native] ⚠ packaged executable not found at ${exe} — skipping verification`);
    return;
  }

  // Can the probe run at all? If Electron cannot start here — a headless CI box
  // missing shared libraries, say — every module would look broken and this gate
  // would fail a perfectly good build. "Cannot verify" and "verified broken" are
  // different answers and must not share an outcome.
  const canProbe = spawnSync(exe, ['-e', 'process.exit(0)'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  if (canProbe.status !== 0) {
    console.log(
      `[native] ⚠ the packaged Electron will not start here ` +
        `(${(canProbe.stderr || '').trim().split('\n')[0] || `exit ${canProbe.status}`}) — ` +
        `CANNOT verify ${modules.length} native module(s)`,
    );
    return;
  }

  console.log(`[native] verifying ${modules.length} native module(s) inside the packaged app…`);

  // Resolve through app.asar, not the unpacked directory: Electron redirects
  // unpacked files transparently, so this is the exact path the app uses.
  const asarModules = path.join(appPath, 'app.asar', 'node_modules').replace(/\\/g, '/');
  const broken = [];

  for (const mod of modules) {
    const result = spawnSync(exe, ['-e', `require(${JSON.stringify(`${asarModules}/${mod}`)})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    });

    if (result.status === 0) {
      console.log(`[native]   ok    ${mod}`);
      continue;
    }

    // An ABI abort exits with a signal or an access-violation status and prints
    // nothing. A genuine JS error prints a stack. Both are failures; the
    // distinction only shapes the message.
    const detail =
      (result.stderr || '').trim().split('\n')[0] ||
      `exited ${result.status ?? result.signal} with no output (native abort)`;
    console.log(`[native]   FAIL  ${mod} — ${detail}`);
    broken.push(`${mod}: ${detail}`);
  }

  if (broken.length > 0) {
    throw new Error(
      `[native] ${broken.length} native module(s) cannot load in the packaged app:\n` +
        broken.map((b) => `  - ${b}`).join('\n') +
        `\n\nThis build would install and then fail to start. On Windows the usual\n` +
        `cause is a module compiled for Node's ABI rather than Electron's: check\n` +
        `that build.npmRebuild is true and that the rebuild actually ran.`,
    );
  }

  console.log(`[native] all ${modules.length} native module(s) load in the packaged app`);
}

/**
 * AfterPack hook - Called after app is packaged but before signing/installer
 */
export async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const resourcesPath = path.join(appOutDir, 'resources');
  const appPath = context.packager.platform.name === 'mac'
    ? path.join(appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : resourcesPath;

  const nodeModulesPath = path.join(appPath, 'app.asar.unpacked', 'node_modules');
  const actualNodeModulesPath = fs.existsSync(nodeModulesPath)
    ? nodeModulesPath
    : path.join(appPath, 'app', 'node_modules');

  // ── Fix .app directories (macOS only) ─────────────────────────────────
  if (context.packager.platform.name === 'mac' && fs.existsSync(actualNodeModulesPath)) {
    console.log('[Code Signing Fix] Scanning for fake .app directories in node_modules...');
    const fakeDotApps = findFakeDotAppDirs(actualNodeModulesPath);

    for (const fakePath of fakeDotApps) {
      const renamedPath = fakePath.replace(/\.app$/, '.app_module');
      try {
        fs.renameSync(fakePath, renamedPath);
        console.log(`[Code Signing Fix] ✓ Renamed: ${path.relative(actualNodeModulesPath, fakePath)} → ${path.basename(renamedPath)}`);
      } catch (error) {
        console.warn(`[Code Signing Fix] ⚠ Failed to rename ${fakePath}:`, error.message);
      }
    }

    if (fakeDotApps.length === 0) {
      console.log('[Code Signing Fix] No fake .app directories found — all clear.');
    }
  }

  // ── Trim Chromium locale packs ────────────────────────────────────────
  // Windows/Linux keep them beside the executable; macOS keeps them inside the
  // bundle's Resources. Both are checked, and a missing directory is a no-op.
  await trimLocales(path.join(appOutDir, 'locales'));
  if (context.packager.platform.name === 'mac') {
    await trimLocales(path.join(appPath, 'locales'));
  }

  // ── Prove the app can actually start ──────────────────────────────────
  // Deliberately last, and deliberately able to fail the build: shipping an
  // installer whose backend aborts on launch is worse than shipping nothing.
  await verifyNativeModules(context, appOutDir, appPath);
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default {
  afterPack
};
