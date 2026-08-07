import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import { decrypt } from '@/views/_utils/encryption.js';

/**
 * Copy remotely-stored provider API keys into this install's local database.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * `AuthManager.getValidAccessToken` resolves a provider credential in three
 * tiers: env var, then the LOCAL `api_keys` table, then api.agnt.gg. Tier 2 is
 * effectively never populated, because every key-writing path in this UI posts
 * to the REMOTE store (`/auth/apikeys/:providerId`) and nothing writes locally.
 * So in practice every provider call falls through to tier 3.
 *
 * That is what makes closing the `/auth/valid-token` hole disruptive: the
 * endpoint that must start requiring authentication is the one the product
 * actually depends on. Backfilling tier 2 removes that dependency, so the
 * server-side flip becomes a non-event for anyone this has run for.
 *
 * It also buys something the remote never could: these keys keep working when
 * api.agnt.gg is unreachable, or the machine is offline.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES IN THE FRONTEND
 * ---------------------------------------------------------------------------
 * It was first written in the backend, and the repository's own
 * no-committed-secrets guard rejected it — correctly. Doing it there meant
 * duplicating the handshake constant from `views/_utils/encryption.js` into
 * backend source, which is a hardcoded credential-shaped literal no matter how
 * public the value is.
 *
 * The guard was pointing at a better design. This code belongs where the key
 * and the decrypt function ALREADY live. Nothing is duplicated, no exemption is
 * needed, and the value never reaches a second copy of itself.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO: OAUTH TOKENS
 * ---------------------------------------------------------------------------
 * API keys only. OAuth access tokens expire, and refreshing one needs the
 * provider's client_secret, which lives in the server's environment and must
 * never ship to a desktop where any user could read it off their own machine.
 * Copying them down would trade a bounded problem (one network call needs a
 * token) for an unbounded one. OAuth stays server-authoritative.
 *
 * ---------------------------------------------------------------------------
 * THE ENCRYPTION LAYERING
 * ---------------------------------------------------------------------------
 * Verified by reading both sides, because getting it wrong stores unusable
 * ciphertext that only surfaces later as a failing workflow:
 *
 *   this UI    encryption.js         AES.encrypt(key, HANDSHAKE_KEY)
 *   remote     AuthModel.storeApiKey stores that string VERBATIM, never decrypts
 *   remote     retrieveApiKey        returns that same string back
 *   local      _saveApiKey           encrypt() with the PER-INSTALL key
 *
 * So the value on the wire carries a transport layer that must be removed
 * before the local layer is applied. `decrypt()` here is that removal.
 */

/** Providers whose credential is an OAuth token rather than a pasted key. */
const isNotFound = (error) => error?.response?.status === 404;

/**
 * Does this value structurally LOOK like CryptoJS passphrase ciphertext?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN JUST TRUSTING `decrypt()`
 * ---------------------------------------------------------------------------
 * CryptoJS is NOT deterministic on malformed input. Its WordArrays are not
 * zero-filled, so a sigBytes/words mismatch reads residue from previously
 * allocated buffers — meaning `decrypt('some-plain-string')` returns '' in a
 * quiet process and occasionally returns short garbage in one that has already
 * done other crypto.
 *
 * Found the hard way: the test for this path passed in isolation and failed in
 * the full suite, because by then other specs had run AES and left residue.
 * That is not a flaky test, it is a real bug — a truthy garbage result would
 * have been written to local storage as a working key.
 *
 * So the check is STRUCTURAL instead of behavioural. CryptoJS's passphrase mode
 * always emits the OpenSSL salted header, whose base64 encoding begins
 * "U2FsdGVkX1" ("Salted__"). A value without it was never produced by
 * `encrypt()`, so it is not ours to unwrap and no amount of residue can make it
 * look like it is.
 */
const looksLikeHandshakeCiphertext = (value) => typeof value === 'string' && value.startsWith('U2FsdGVkX1');

/**
 * @param {object} options
 * @param {string} options.token          the user's session token
 * @param {string[]} options.remoteApps   provider ids the remote says are connected
 * @param {string[]} options.localApps    provider ids already present locally
 * @returns {Promise<{copied: string[], skipped: number, failed: string[]}>}
 */
export async function backfillLocalProviderKeys({ token, remoteApps = [], localApps = [] } = {}) {
  const result = { copied: [], skipped: 0, failed: [] };
  if (!token || remoteApps.length === 0) return result;

  const alreadyLocal = new Set(localApps);
  // BACKFILL ONLY. A key already present locally wins: it may have come from an
  // env var or been entered on this machine, and silently replacing it with a
  // remote copy would make the local value impossible to set.
  const missing = remoteApps.filter((id) => !alreadyLocal.has(id));
  if (missing.length === 0) return result;

  const headers = { Authorization: `Bearer ${token}` };

  for (const providerId of missing) {
    try {
      const response = await axios.get(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${providerId}`, {
        headers,
        timeout: 8000,
      });

      const stored = response.data?.apiKey;
      if (!stored) {
        result.skipped++;
        continue;
      }

      const plain = looksLikeHandshakeCiphertext(stored) ? decrypt(stored) : null;
      if (!plain) {
        // Do NOT fall back to sending `stored` as-is. A value that fails to
        // unwrap is either not handshake-encrypted or is corrupt, and saving it
        // would produce a local key that looks present and never works.
        console.warn(`[keyBackfill] ${providerId}: stored value did not decrypt; leaving it remote-only`);
        result.failed.push(providerId);
        continue;
      }

      await axios.post(
        `${API_CONFIG.BASE_URL}/providers/${providerId}/auth/connect`,
        { apiKey: plain },
        { headers, timeout: 8000 }
      );
      result.copied.push(providerId);
    } catch (error) {
      // 404 just means this provider is OAuth-connected, not key-based.
      if (isNotFound(error)) result.skipped++;
      else {
        result.failed.push(providerId);
        console.warn(`[keyBackfill] ${providerId}: ${error.message}`);
      }
    }
  }

  if (result.copied.length || result.failed.length) {
    console.log(
      `[keyBackfill] copied ${result.copied.length} provider key(s) into local storage` +
        (result.failed.length ? `, ${result.failed.length} failed` : '')
    );
  }
  return result;
}
