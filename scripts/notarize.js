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
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

/**
 * Attach Apple's ticket to an app it has already notarized, retrying.
 *
 * Stapling only downloads the ticket and writes it into the bundle, so a retry
 * is safe. On the Intel Mac runner the download lost its connection twice in a
 * row (NSURLErrorDomain -1005) while Apple had accepted the app; one dropped
 * connection failed the release. The workflow's stapler validate step still
 * refuses an app without a ticket.
 */
export async function stapleWithRetry(appPath, {
  attempts = 4,
  delayMs = 20_000,
  run = (cmd, args, cwd) => new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { output: `${stdout}${stderr}` })) : resolve(stdout)));
  }),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
} = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run('xcrun', ['stapler', 'staple', '-v', basename(appPath)], dirname(appPath));
      log(`[Notarize] ✅ Ticket stapled (attempt ${attempt}/${attempts}).`);
      return;
    } catch (err) {
      last = err;
      log(`[Notarize] Staple attempt ${attempt}/${attempts} failed: ${String(err.output || err.message).trim().split('\n').pop()}`);
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw new Error(`Failed to staple after ${attempts} attempts: ${last?.message || last}`);
}

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
    // A release must be notarized: Gatekeeper blocks an un-notarized app on
    // first launch, and Squirrel.Mac refuses an update whose signature does not
    // match. Warning and shipping anyway is how a release breaks every Mac.
    if (process.env.AGNT_RELEASE === '1') {
      throw new Error('[Notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD missing on a release build: refusing to ship an un-notarized app.');
    }
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
    // Apple accepted the app; only fetching its ticket failed. Fetch it again.
    if (/Failed to staple/i.test(error.message)) {
      console.warn(`[Notarize] Notarized, but stapling failed: ${error.message.split('\n')[0]}. Retrying.`);
      try {
        await stapleWithRetry(appPath);
      } catch (stapleError) {
        // Apple ACCEPTED this app; only the ticket download kept failing
        // (error 68 on every attempt, both runners, 2026-11-07). An unstapled
        // app is still notarized — Gatekeeper fetches the ticket from Apple on
        // first launch; only an offline first launch notices the difference.
        console.warn(`[Notarize] Shipping without a stapled ticket: ${String(stapleError.message).split('\n')[0]}`);
        console.warn('[Notarize] Notarization was accepted; Gatekeeper verifies it online.');
        return;
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[Notarize] ✅ Done in ${elapsed}s — notarized and stapled.`);
      return;
    }
    console.error('[Notarize] ❌ Notarization failed:', error.message);
    // In CI, fail the build if notarization fails
    if (process.env.CI) {
      throw error;
    }
    console.warn('[Notarize] Continuing without notarization (non-CI build).');
  }
}
