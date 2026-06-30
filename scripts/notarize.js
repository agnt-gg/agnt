/**
 * macOS Notarization afterSign hook for electron-builder.
 *
 * In CI (process.env.CI is set), this will automatically notarize the .app
 * bundle using Apple's notarytool via @electron/notarize.
 *
 * Locally, notarization is skipped unless you set FORCE_NOTARIZE=true.
 *
 * Required environment variables (set as GitHub Secrets for CI):
 *   APPLE_ID                      – Apple Developer email (nathan@bizop.io)
 *   APPLE_APP_SPECIFIC_PASSWORD   – App-specific password from appleid.apple.com
 *   APPLE_TEAM_ID                 – Team ID (56BD35UF2U)
 */

import { notarize } from '@electron/notarize';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip locally unless explicitly requested
  if (!process.env.CI && !process.env.FORCE_NOTARIZE) {
    console.log('[Notarize] Skipping (not CI). Set FORCE_NOTARIZE=true to test locally.');
    return;
  }

  // Ensure required env vars are present
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID || '56BD35UF2U';

  if (!appleId || !appleIdPassword) {
    console.warn('[Notarize] ⚠️  Missing APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD — skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[Notarize] Submitting ${appPath} to Apple notary service...`);
  console.log(`[Notarize] Apple ID: ${appleId}`);
  console.log(`[Notarize] Team ID: ${teamId}`);
  const startTime = Date.now();

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId: packageJson.build.appId,
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`[Notarize] ✅ Done in ${elapsed}s — Apple has notarized the app!`);
  } catch (error) {
    console.error('[Notarize] ❌ Notarization failed:', error.message);
    // In CI, fail the build if notarization fails
    if (process.env.CI) {
      throw error;
    }
    console.warn('[Notarize] Continuing without notarization (non-CI build).');
  }
}
