import { newerSessionTokenFor } from './sessionTokenCache.js';

/**
 * Response header carrying a renewed session token back to the window.
 *
 * The frontend reads it in utils/axiosInterceptor.js (lower-cased by axios) and
 * stores it with the userAuth/ADOPT_RENEWED_TOKEN mutation. Both sides spell it
 * literally; renewedTokenHeader.test.js and axiosInterceptor.spec.js pin it.
 */
export const RENEWED_TOKEN_HEADER = 'X-AGNT-Session-Token';

/**
 * Offer the window the renewed token when it presented an older one.
 *
 * Called right after the auth middleware has verified `presented` for `userId`
 * and remembered it. Sends nothing unless this process holds a token for the
 * SAME account that outlives the presented one, so an up-to-date window never
 * sees the header at all.
 *
 * @param {import('express').Response} res
 * @param {string} presented  the verified bearer token on this request
 * @param {string} userId     the account it was verified for
 */
export function offerRenewedToken(res, presented, userId) {
  if (typeof res?.setHeader !== 'function') return;
  const renewed = newerSessionTokenFor(userId, presented);
  if (!renewed) return;
  res.setHeader(RENEWED_TOKEN_HEADER, renewed);
  // Needed only when the window is served from another origin (vite in dev).
  if (typeof res.append === 'function') res.append('Access-Control-Expose-Headers', RENEWED_TOKEN_HEADER);
}
