/**
 * Short-lived, single-purpose bearer tokens for the local LLM gateway.
 *
 * The gateway (routes/LlmGatewayRoutes.js) lets a child process — today the
 * Browser Agent's Python runner — make LLM calls as the user who started the
 * workflow. It needs a credential to do that.
 *
 * WHAT THIS IS NOT: the user's session JWT. Handing that to a subprocess would
 * give a Python program spawned by a workflow node the ability to call every
 * authenticated route in the app, and would survive in that process's
 * environment for as long as the JWT is valid. The blast radius of a leak
 * would be the whole account.
 *
 * WHAT THIS IS: a random 256-bit token that
 *   - only opens ONE route (the gateway; nothing else consults this module),
 *   - is bound at mint time to one userId, one provider and one model, so it
 *     cannot be replayed against a different provider to spend other credits,
 *   - expires on a timer, and
 *   - is revoked the moment the run that needed it ends, success or failure.
 *
 * In-memory on purpose. A token that does not survive a restart is a feature:
 * the process it was minted for did not survive either.
 */

import { randomBytes, timingSafeEqual } from 'crypto';

/** @type {Map<string, {userId:string, provider:string, model:string, expiresAt:number, label:string}>} */
const tokens = new Map();

/** Belt and braces: a run that never revokes still cannot leave a token forever. */
const MAX_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function sweepExpired(now = Date.now()) {
  for (const [token, grant] of tokens) {
    if (grant.expiresAt <= now) tokens.delete(token);
  }
}

/**
 * Mint a token bound to one user, provider and model.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.provider   Provider key, e.g. 'claude-code'.
 * @param {string} params.model      Exact model id the holder may request.
 * @param {number} [params.ttlMs]    Lifetime; clamped to MAX_TTL_MS.
 * @param {string} [params.label]    Human tag for logs, e.g. 'browser-agent'.
 * @returns {{token:string, expiresAt:number}}
 */
export function mintGatewayToken({ userId, provider, model, ttlMs = DEFAULT_TTL_MS, label = 'unknown' }) {
  if (!userId) throw new Error('mintGatewayToken requires a userId');
  if (!provider) throw new Error('mintGatewayToken requires a provider');
  if (!model) throw new Error('mintGatewayToken requires a model');

  sweepExpired();

  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + Math.min(ttlMs, MAX_TTL_MS);
  tokens.set(token, { userId: String(userId), provider, model, expiresAt, label });
  return { token, expiresAt };
}

/**
 * Look up a presented token.
 *
 * Compares in constant time against every live token. The set is tiny (one per
 * in-flight run), and an attacker who can time a Map lookup on loopback has
 * already won — but a credential check that leaks its comparison is the kind
 * of thing that gets copied into somewhere it matters.
 *
 * @returns {{userId:string, provider:string, model:string, expiresAt:number, label:string}|null}
 */
export function verifyGatewayToken(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return null;
  sweepExpired();

  const presentedBuf = Buffer.from(presented);
  let match = null;
  for (const [token, grant] of tokens) {
    const known = Buffer.from(token);
    if (known.length !== presentedBuf.length) continue;
    if (timingSafeEqual(known, presentedBuf)) match = grant;
  }
  return match;
}

/** Revoke one token. Safe to call twice; the second call is a no-op. */
export function revokeGatewayToken(token) {
  if (typeof token !== 'string') return false;
  return tokens.delete(token);
}

/** Test seam. Never called in production code. */
export function _resetGatewayTokens() {
  tokens.clear();
}

/** Test/diagnostic seam: how many grants are live right now. */
export function _liveGatewayTokenCount() {
  sweepExpired();
  return tokens.size;
}
