import CryptoJS from 'crypto-js';
import { resolveSecret } from './secretResolver.js';
import { LEGACY_ENCRYPTION_KEY, hasLegacyKey } from './legacySecrets.js';

/**
 * Symmetric encryption for credentials stored in the local database.
 *
 * Covers exactly four columns, and nothing else in the database is encrypted:
 *   api_keys.api_key
 *   oauth_tokens.access_token
 *   oauth_tokens.refresh_token
 *   custom_openai_providers.api_key
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY
 * ---------------------------------------------------------------------------
 * This module used to read `backend/.env` off disk itself, at module scope,
 * and throw if the file was missing:
 *
 *     const envConfig = fs.readFileSync(path.resolve(__dirname, '../../.env'))
 *     if (!SECRET_KEY) throw new Error('ENCRYPTION_KEY is not set …')
 *
 * Three separate problems in five lines:
 *
 *   1. It bypassed process.env, so no operator could override the key, and
 *      ENCRYPTION_KEY showed zero `process.env` reads across the codebase
 *      while being the thing protecting every stored credential.
 *   2. Module-scope I/O plus a module-scope throw made a committed .env a hard
 *      BOOT DEPENDENCY. The file could not be deleted without the backend
 *      failing to start — which is precisely why a published secret survived
 *      197 days.
 *   3. The key it read was identical on every install and public on GitHub, so
 *      "encrypted at rest" was decorative: anyone holding a user's agnt.db
 *      could read that user's credentials.
 *
 * Now: lazy, process.env-first, per-install key. See utils/secretResolver.js.
 *
 * ---------------------------------------------------------------------------
 * DUAL-KEY DECRYPT IS THE SAFETY MECHANISM
 * ---------------------------------------------------------------------------
 * encrypt() always uses the per-install key. decrypt() tries the per-install
 * key first and falls back to the legacy published key.
 *
 * That asymmetry is what makes the migration safe WITHOUT copying the
 * database. A migration that half-finishes, crashes midway, is interrupted by
 * a force-quit, or never runs at all still leaves every row readable, because
 * reading does not depend on which key a row happens to be under. There is no
 * window in which data is unreachable, so there is nothing to roll back to —
 * which matters here because the database is 30 GB and copying it to protect
 * six rows would be absurd.
 *
 * ---------------------------------------------------------------------------
 * WHY GENERATION IS TAGGED, NOT GUESSED
 * ---------------------------------------------------------------------------
 * The obvious implementation of dual-key decrypt is "try key A; if it returns
 * something non-empty, that was the right key; otherwise try key B". That is
 * WRONG, and measurably so.
 *
 * crypto-js passphrase mode derives key+IV with EVP_BytesToKey and strips
 * PKCS7 padding without validating it. A wrong key therefore yields random
 * bytes, and the last byte decides how many are stripped — so occasionally the
 * remainder is short, valid UTF-8 and NON-EMPTY. Measured over 3,000 wrong-key
 * decryptions of a freshly encrypted value: 2,834 empty, 154 threw, and 12
 * (0.4%) returned non-empty garbage such as "q", "DB", "[\u0014>\u0550".
 *
 * Never the correct plaintext — but 0.4% is far too often to treat "non-empty"
 * as "correct". A legacy row that produced garbage under the install key would
 * have short-circuited before the legacy key was ever tried, and decrypt()
 * would return a corrupted credential. Across a fleet with a few hundred
 * stored credentials that is several silently broken every migration.
 *
 * So the generation is recorded STRUCTURALLY instead. Values written from here
 * on carry a short prefix, and the prefix — not a guess about entropy — selects
 * the key:
 *
 *   PREFIXED   → written by this version, use the per-install key.
 *   UNPREFIXED → written by <= 0.6.5, which had exactly one key: the published
 *                one. Use the legacy key.
 *
 * Deterministic in both directions, with no probability anywhere in the path.
 */

/** Bytes of entropy for a generated key. 32 → 64 hex chars. */
const KEY_BYTES = 32;

/**
 * Marks ciphertext written with a per-install key.
 *
 * Chosen to be impossible to confuse with the legacy format, which is always
 * base64 and therefore always starts with 'U2FsdGVkX1' ('Salted__').
 */
export const CIPHERTEXT_PREFIX = 'agnt.v2:';

/**
 * The per-install key. Resolved lazily so that importing this module never
 * touches the disk and never throws — that is what let a missing .env stop the
 * backend from booting.
 */
function installKey() {
  return resolveSecret('ENCRYPTION_KEY', { bytes: KEY_BYTES, onPersistFailure: 'throw' });
}

/** Was this value written by a version that uses per-install keys? */
function isCurrentGeneration(value) {
  return typeof value === 'string' && value.startsWith(CIPHERTEXT_PREFIX);
}

/**
 * Attempt a decryption, returning null for "this key does not open it".
 *
 * Only used to probe UNPREFIXED values, where a non-empty result is strong
 * (though not certain) evidence the key was right. Never used to choose
 * between keys — the prefix does that.
 *
 * @returns {string|null} plaintext, or null if empty/throwing
 */
function attempt(encryptedText, key) {
  if (!key) return null;
  try {
    const plain = CryptoJS.AES.decrypt(encryptedText, key).toString(CryptoJS.enc.Utf8);
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

/**
 * Encrypt with the per-install key.
 * @param {string} text
 * @returns {string} CryptoJS AES ciphertext (OpenSSL-compatible, salted)
 */
export function encrypt(text) {
  return CIPHERTEXT_PREFIX + CryptoJS.AES.encrypt(text, installKey()).toString();
}

/**
 * Decrypt a value written under either the per-install key or the legacy one.
 *
 * @param {string} encryptedText
 * @returns {string} plaintext
 * @throws propagates CryptoJS's 'Malformed UTF-8 data' for undecryptable input
 */
export function decrypt(encryptedText) {
  // Written by this version: the prefix says so, so there is nothing to guess.
  if (isCurrentGeneration(encryptedText)) {
    return CryptoJS.AES.decrypt(encryptedText.slice(CIPHERTEXT_PREFIX.length), installKey()).toString(
      CryptoJS.enc.Utf8
    );
  }

  // Unprefixed: written by <= 0.6.5, which only ever used the published key.
  if (hasLegacyKey()) {
    return CryptoJS.AES.decrypt(encryptedText, LEGACY_ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
  }

  // Unprefixed with no legacy key available. Nothing can open this, so
  // reproduce the ORIGINAL contract rather than inventing a new one — callers
  // wrap decrypt() in try/catch and treat a throw as "failed to decrypt", and
  // returning '' where the old code threw would turn a caught error into a
  // silently empty credential.
  return CryptoJS.AES.decrypt(encryptedText, installKey()).toString(CryptoJS.enc.Utf8);
}

/**
 * Which key opens this value: 'current', 'legacy', or null.
 * Used by the migration to find rows needing re-encryption without
 * re-implementing the fallback, and by tests to prove a row actually moved.
 *
 * @param {string} encryptedText
 * @returns {'current'|'legacy'|null}
 */
export function keyGenerationOf(encryptedText) {
  if (isCurrentGeneration(encryptedText)) return 'current';
  if (hasLegacyKey() && attempt(encryptedText, LEGACY_ENCRYPTION_KEY) !== null) return 'legacy';
  return null;
}
