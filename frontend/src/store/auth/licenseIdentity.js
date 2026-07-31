/**
 * License identity binding.
 *
 * A signed license is a credential issued *to a specific subject* — the server
 * stamps `license.userId` with whoever's token accompanied the request, or the
 * literal string 'anonymous' when the request arrived unauthenticated.
 *
 * The bug this exists to prevent:
 *
 *   1. App boots with no token yet -> main.js fires validateLicense with no
 *      Authorization header -> server correctly issues an ANONYMOUS license
 *      (planType 'free', planName 'Community Core', 7-day expiry).
 *   2. That license is cached and marked `licenseStatus: 'valid'` — because it
 *      IS valid, it is just valid for nobody.
 *   3. The user logs in. The post-login `validateLicense` is swallowed by the
 *      1-hour freshness cache, so the anonymous license is never replaced.
 *   4. Every later boot sees a cached license that has not expired and skips
 *      revalidation entirely. A paid account renders as free for 7 days, and
 *      the app is entirely confident about it.
 *
 * The missing invariant is not "is this license expired" — it is
 * "was this license issued to the person currently holding the session".
 * These helpers are pure so that invariant can be asserted in one place and
 * tested without a store, a network, or a browser.
 */

import { userFromJwt } from './jwt.js';

/** Subject used when there is no authenticated session. Matches the server. */
export const ANONYMOUS_SUBJECT = 'anonymous';

/**
 * The subject the current session belongs to.
 *
 * No signature verification happens here and none is needed: this value is
 * only ever used as a CACHE KEY, never as an authorization decision. The
 * server re-derives identity from the token on every /license/validate call.
 *
 * @param {string|null|undefined} token - raw JWT from localStorage/state
 * @returns {string} user id, or ANONYMOUS_SUBJECT when unauthenticated
 */
export function authSubject(token) {
  const user = userFromJwt(token);
  return user?.id ? String(user.id) : ANONYMOUS_SUBJECT;
}

/**
 * The subject a signed license was issued to.
 *
 * @param {{ license?: { userId?: string } }|null|undefined} signedLicense
 * @returns {string} the license's userId, or ANONYMOUS_SUBJECT
 */
export function licenseSubject(signedLicense) {
  const userId = signedLicense?.license?.userId;
  return userId ? String(userId) : ANONYMOUS_SUBJECT;
}

/**
 * Whether a cached license may be applied to the current session.
 *
 * A mismatch is not an error and not tampering — it is an ordinary stale
 * cache (logged out, logged in as someone else, or fetched before login
 * finished). Callers should treat it as a cache miss and refetch.
 *
 * @param {object|null|undefined} signedLicense
 * @param {string|null|undefined} token
 * @returns {boolean}
 */
export function licenseMatchesSubject(signedLicense, token) {
  if (!signedLicense?.license) return false;
  return licenseSubject(signedLicense) === authSubject(token);
}

export default { ANONYMOUS_SUBJECT, authSubject, licenseSubject, licenseMatchesSubject };
