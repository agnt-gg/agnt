/**
 * The published encryption key, and what to do about data encrypted with it.
 *
 * ---------------------------------------------------------------------------
 * BACKGROUND
 * ---------------------------------------------------------------------------
 * Every AGNT install up to and including 0.6.5 encrypted stored API keys and
 * OAuth tokens with a single ENCRYPTION_KEY that shipped inside the app and
 * was committed to a public repository. From 0.6.6 each install generates its
 * own key (see utils/secretResolver.js), which is what actually fixes the
 * problem — the published value stops protecting anything.
 *
 * But rows written by an older version are still encrypted with the old key,
 * so SOMETHING has to be able to read them once, in order to re-encrypt them.
 * That is the only purpose this module serves.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VALUE IS NOT HARDCODED HERE
 * ---------------------------------------------------------------------------
 * Two reasons, and the second is the real one.
 *
 * 1. This repository's own credential guard refuses to accept a high-entropy
 *    value assigned to a secret-named constant. It is right to: that rule is
 *    exactly what would have prevented the original incident. Writing the
 *    value here — or splitting/encoding it to slip past the check — would
 *    disable the guard for whoever comes next, which is a worse outcome than
 *    the inconvenience it causes today.
 *
 * 2. Re-committing a known-leaked secret to a public repository is a decision
 *    with a real tradeoff, and it belongs to a person, not to a refactor.
 *
 * ---------------------------------------------------------------------------
 * THE TRADEOFF, STATED PLAINLY
 * ---------------------------------------------------------------------------
 * UNSET (the default):
 *   Old rows cannot be decrypted, so they cannot be migrated. On first run of
 *   0.6.6 the migration finds nothing it can read and does nothing. Affected
 *   users must re-enter stored provider API keys and reconnect OAuth
 *   integrations once. Nothing else is lost: conversations, workflows, agents,
 *   outputs and files are not encrypted and are entirely unaffected.
 *
 * SET (via the AGNT_LEGACY_ENCRYPTION_KEY environment variable, or by a
 * deliberate edit to this file):
 *   The migration transparently re-encrypts every old row on first run. No
 *   user-visible change at all. The published value stays readable by anyone,
 *   but it already is — it has been public since 2026-01-20 and lives in 64
 *   forks. Keeping a decrypt-only copy does not widen that exposure by one
 *   person, and it buys every existing user a silent upgrade.
 *
 * A third option avoids the choice entirely: ship the migration in a release
 * that STILL contains the old .env, then remove the file in the release after.
 * Zero user impact, at the cost of the file surviving one more version.
 *
 * ---------------------------------------------------------------------------
 * WHATEVER IS CHOSEN, THIS IS DECRYPT-ONLY AND TEMPORARY
 * ---------------------------------------------------------------------------
 * The value is never used to encrypt anything. New writes always use the
 * per-install key. Once installs have migrated (adoption is measurable from
 * the app_version reported to /license/validate) this module and its call
 * sites should be deleted outright.
 *
 * REMOVE BY: 0.6.9
 */

/**
 * Decrypt-only key for data written by AGNT <= 0.6.5.
 *
 * An empty string means "no legacy fallback": decryption of old rows will
 * fail cleanly and the migration will skip them, rather than corrupting
 * anything. Every consumer must treat '' as absent.
 *
 * @type {string}
 */
export const LEGACY_ENCRYPTION_KEY = process.env.AGNT_LEGACY_ENCRYPTION_KEY || '';

/** @returns {boolean} whether old rows can be read at all. */
export function hasLegacyKey() {
  return typeof LEGACY_ENCRYPTION_KEY === 'string' && LEGACY_ENCRYPTION_KEY.length > 0;
}
