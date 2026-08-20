/**
 * Electron Builder Lite Mode Configuration
 *
 * This script modifies the electron-builder configuration at build time
 * to exclude browser automation packages when building AGNT Lite.
 *
 * It also fixes macOS code signing issues for ALL builds by renaming
 * directories that end in .app (which macOS treats as app bundles).
 *
 * Usage: Set AGNT_BUILD_VARIANT=lite environment variable before building
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isLiteBuild = process.env.AGNT_BUILD_VARIANT === '-Lite';

if (isLiteBuild) {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   🪶 BUILDING AGNT LITE VARIANT      ║');
  console.log('╟────────────────────────────────────────╢');
  console.log('║  Excluding browser automation packages ║');
  console.log('║  Expected size reduction: ~16MB        ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
}

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
 * AfterPack hook - Called after app is packaged but before signing/installer
 *
 * Three responsibilities:
 * 1. (ALL builds) Rename fake .app directories so codesign doesn't choke
 * 2. (ALL builds) Trim Chromium locale packs AGNT never reads
 * 3. (Lite builds) Remove browser automation packages
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

  // ── Fix .app directories (ALL builds, macOS only) ─────────────────────
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

  // ── Trim Chromium locale packs (ALL builds) ───────────────────────────
  // Windows/Linux keep them beside the executable; macOS keeps them inside the
  // bundle's Resources. Both are checked, and a missing directory is a no-op.
  await trimLocales(path.join(appOutDir, 'locales'));
  if (context.packager.platform.name === 'mac') {
    await trimLocales(path.join(appPath, 'locales'));
  }

  // ── Lite build: remove browser packages ───────────────────────────────
  if (!isLiteBuild) {
    return; // Full build - done after the .app fix
  }

  console.log('[Lite Build] Removing browser automation packages...');

  // Packages to remove in lite mode
  const packagesToRemove = [
    'puppeteer',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    'puppeteer-extra-plugin-user-data-dir',
    'puppeteer-extra-plugin-user-preferences',
    'puppeteer-extra-plugin',
    'puppeteer-core',
    '@puppeteer',
    'playwright',
    'playwright-core',
    '@playwright/test'
  ];

  let totalSizeSaved = 0;

  for (const pkg of packagesToRemove) {
    const pkgPath = path.join(actualNodeModulesPath, pkg);

    if (fs.existsSync(pkgPath)) {
      try {
        // Calculate size before removal
        const sizeBefore = await getDirectorySize(pkgPath);

        // Remove the package
        fs.rmSync(pkgPath, { recursive: true, force: true });

        totalSizeSaved += sizeBefore;
        console.log(`[Lite Build] ✓ Removed ${pkg} (${formatBytes(sizeBefore)})`);
      } catch (error) {
        console.warn(`[Lite Build] ⚠ Failed to remove ${pkg}:`, error.message);
      }
    }
  }

  console.log('');
  console.log(`[Lite Build] Total space saved: ${formatBytes(totalSizeSaved)}`);
  console.log('');

  // Create a marker file to indicate this is a lite build
  const markerPath = path.join(appPath, '.agnt-lite-mode');
  fs.writeFileSync(markerPath, 'true', 'utf8');
}

/**
 * Calculate directory size recursively
 */
async function getDirectorySize(dirPath) {
  let totalSize = 0;

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);

      if (item.isDirectory()) {
        totalSize += await getDirectorySize(itemPath);
      } else {
        const stats = fs.statSync(itemPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // Ignore errors (permission denied, etc.)
  }

  return totalSize;
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
