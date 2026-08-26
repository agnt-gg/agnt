/**
 * agntCredentialStore — where AGNT keeps the credentials AGNT itself obtained.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this file, AGNT wrote its own OAuth tokens INTO the vendor's private
 * directory — `~/.claude/.credentials.json` for Claude Code. That produced two
 * concrete defects:
 *
 *   1. CLOBBER. writeClaudeCredentials() assigned the whole `claudeAiOauth`
 *      block rather than merging it. AGNT writes 4 keys; a file-era Claude CLI
 *      writes 7. The first AGNT token refresh silently destroyed
 *      refreshTokenExpiresAt, subscriptionType and rateLimitTier from another
 *      tool's config file.
 *
 *   2. AMBIGUOUS OWNERSHIP. With both tools writing one file, nothing could
 *      answer "is this credential mine to refresh, or am I about to rotate the
 *      user's terminal session out from under them?"
 *
 * Both disappear if AGNT owns a store and treats the vendor's as read-only.
 * That is the whole idea: **discover anywhere, write only here.**
 *
 * ON DISK: <rootDir>/provider-credentials/<providerId>.json, mode 0600.
 * rootDir is PathManager's, so this follows AGNT everywhere it already stores
 * config — %APPDATA%/AGNT on Electron, /app/data in Docker, ~/.agnt/data
 * otherwise — and inherits the Docker volume and backup story for free.
 */

import fs from 'fs';
import path from 'path';
import PathManager from '../../utils/PathManager.js';

const STORE_DIRNAME = 'provider-credentials';

/** Reject anything that could escape the store directory. */
function assertSafeProviderId(providerId) {
  if (!providerId || typeof providerId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(providerId)) {
    throw new Error(`Invalid providerId for credential store: ${String(providerId)}`);
  }
}

export function getStoreDir() {
  return PathManager.getPath(STORE_DIRNAME);
}

export function getCredentialPath(providerId) {
  assertSafeProviderId(providerId);
  return path.join(getStoreDir(), `${providerId}.json`);
}

/**
 * @returns {object | null} The stored credential, or null when absent or
 * unreadable. Corruption is treated as "no credential" rather than an error —
 * the caller's next tier is a perfectly good answer, and a hard failure here
 * would lock a user out of a provider over a truncated file.
 */
export function readCredential(providerId) {
  let credPath;
  try {
    credPath = getCredentialPath(providerId);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Write atomically: a crash mid-write must not leave a half-written credential
 * that the resolver would then treat as corrupt and skip. Same-directory temp
 * file keeps the rename atomic on every filesystem we support.
 */
export function writeCredential(providerId, data) {
  const credPath = getCredentialPath(providerId);
  const dir = path.dirname(credPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tmpPath = `${credPath}.${process.pid}.tmp`;
  const payload = JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2);

  fs.writeFileSync(tmpPath, payload, { mode: 0o600 });
  fs.renameSync(tmpPath, credPath);

  // renameSync preserves the temp file's mode, but an existing target on some
  // platforms can retain its own — re-assert rather than assume.
  try {
    fs.chmodSync(credPath, 0o600);
  } catch {
    // chmod is a no-op on Windows; never fail a write over it.
  }

  return credPath;
}

/** @returns {boolean} true if a credential was actually removed. */
export function clearCredential(providerId) {
  let credPath;
  try {
    credPath = getCredentialPath(providerId);
  } catch {
    return false;
  }
  try {
    if (!fs.existsSync(credPath)) return false;
    fs.unlinkSync(credPath);
    return true;
  } catch {
    return false;
  }
}

export function hasCredential(providerId) {
  return readCredential(providerId) !== null;
}
