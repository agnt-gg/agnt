/**
 * Electron Builder Lite Mode Configuration
 *
 * This script modifies the electron-builder configuration at build time
 * to exclude browser automation packages when building AGNT Lite.
 *
 * Usage: Set AGNT_BUILD_VARIANT=lite environment variable before building
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isLiteBuild = process.env.AGNT_BUILD_VARIANT === 'lite';

if (isLiteBuild) {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   🪶 BUILDING AGNT LITE VARIANT      ║');
  console.log('╟────────────────────────────────────────╢');
  console.log('║  Excluding browser automation packages ║');
  console.log('║  Expected size reduction: ~80-100MB    ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
}

/**
 * AfterPack hook - Called after app is packaged but before installer is created
 * We use this to remove browser automation packages from the Lite build
 */
export async function afterPack(context) {
  if (!isLiteBuild) {
    return; // Full build - include everything
  }

  console.log('[Lite Build] Removing browser automation packages...');

  const appOutDir = context.appOutDir;
  const resourcesPath = path.join(appOutDir, 'resources');
  const appPath = context.packager.platform.name === 'mac'
    ? path.join(appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : resourcesPath;

  const nodeModulesPath = path.join(appPath, 'app.asar.unpacked', 'node_modules');

  // Fallback to regular app structure if ASAR unpacked doesn't exist
  const actualNodeModulesPath = fs.existsSync(nodeModulesPath)
    ? nodeModulesPath
    : path.join(appPath, 'app', 'node_modules');

  // Packages to remove in lite mode
  const packagesToRemove = [
    'puppeteer',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    'puppeteer-core',
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
