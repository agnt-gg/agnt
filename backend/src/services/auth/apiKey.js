/**
 * AGNT API keys, as this backend sees them.
 *
 * A key is minted by api.agnt.gg (POST /users/generate-api-key), lasts until
 * its owner replaces or revokes it, and is the credential for integrations: a
 * bot or script calling this backend. A sign-in token expires after 30 days and
 * nothing refreshes it, which is right for the app and wrong for a bot.
 *
 * This backend cannot verify a key locally; only api.agnt.gg holds the hashes.
 * So a key always takes the issuer path (remoteTokenVerifier.verifyViaIssuer),
 * which caches the answer and applies the same tenant membership check a
 * sign-in token gets. The prefix is what routes it there.
 */
const API_KEY_PATTERN = /^agnt_sk_[0-9a-f]{64}$/;

export function isApiKey(value) {
  return typeof value === 'string' && API_KEY_PATTERN.test(value);
}
