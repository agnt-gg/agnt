import jwt from 'jsonwebtoken';

import { isRemoteVerifyMode } from './remoteTokenVerifier.js';

/**
 * Mint a session token this install can verify by itself.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * A hosted tenant cannot hold the issuer's signing key: that key is public, the
 * tenant is on the open internet, and AGNT executes arbitrary code by design,
 * so a forged session there is remote code execution. remoteTokenVerifier.js
 * removes the need for the key by asking api.agnt.gg whether a token is real.
 *
 * But that answer is ASYNCHRONOUS, and this backend verifies tokens in three
 * places, two of which are synchronous and cannot become async cheaply:
 *
 *   routes/Middleware.js        async  — every REST route
 *   utils/authGuard.js          SYNC   — media, files, images, pairing, SSE
 *   utils/socketIdentity.js     SYNC   — the websocket handshake
 *
 * Patching only the first produces the worst possible outcome: the user signs
 * in successfully and then has no realtime chat, no streamed tool events, and
 * broken image and file URLs. An install that looks logged in and is visibly
 * broken is worse than one that honestly refuses.
 *
 * ---------------------------------------------------------------------------
 * THE EXCHANGE
 * ---------------------------------------------------------------------------
 * So the cloud token is verified ONCE, at one place, and immediately traded for
 * a token minted HERE with this install's own private secret:
 *
 *   browser --cloud token--> tenant   (one issuer call, in getAuthStatus)
 *                              |
 *                              +--> mints a LOCAL token, returns it
 *   browser --local token--> tenant   jwt.verify(token, OWN_SECRET) -- sync
 *
 * All three verify sites then work with no modification at all, because the
 * only tokens they ever see are ones this process signed. This is the
 * `/users/sync-token` exchange that utils/legacySecrets.js names as the real
 * fix, and it is what finally lets a tenant hold a random private JWT_SECRET
 * instead of the published one.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE FIRST jwt.sign IN THIS BACKEND OUTSIDE TESTS
 * ---------------------------------------------------------------------------
 * Deliberately, and narrowly. legacySecrets.js observes that agnt-pro "contains
 * ZERO jwt.sign calls outside tests — it cannot mint a token", which is exactly
 * why it needed the cloud's key to verify anything. Minting locally is what
 * breaks that dependency. It is gated on AGNT_AUTH_MODE=verify-remote, so a
 * desktop install still cannot mint and is bit-for-bit unchanged.
 */

/** Ceiling on a minted token's life, regardless of what the cloud token says. */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Can this install mint its own session tokens?
 *
 * Tied to the same flag as issuer delegation rather than a second switch: the
 * two are halves of one mechanism, and an install that could mint but not
 * verify remotely (or the reverse) is a state with no meaning.
 */
export function isExchangeEnabled() {
  return isRemoteVerifyMode() && !!process.env.JWT_SECRET;
}

/**
 * Trade a verified cloud identity for a locally-signed token.
 *
 * @param {object} params
 * @param {string} params.userId      the id the ISSUER confirmed, never a claim
 *                                    read out of the presented token
 * @param {string} [params.email]
 * @param {string} [params.cloudToken] the original, used only to bound expiry
 * @returns {{ token: string, expiresAt: number }|null} null when disabled
 */
export function mintLocalToken({ userId, email = null, cloudToken = null }) {
  if (!isExchangeEnabled()) return null;
  if (!userId) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  let expiresAt = issuedAt + MAX_TTL_SECONDS;

  // NEVER OUTLIVE THE CREDENTIAL IT WAS DERIVED FROM.
  //
  // A local token that expires later than the cloud token would keep a session
  // alive on this tenant after the user's actual account session ended — the
  // exchange would have quietly UPGRADED a credential's lifetime, which is not
  // a thing an exchange is allowed to do.
  //
  // `jwt.decode` is correct here despite being unverified: the identity came
  // from the issuer, and this reads only `exp`, which is used solely to move
  // the expiry EARLIER. A forged `exp` can shorten the token, never extend it.
  if (cloudToken) {
    try {
      const claims = jwt.decode(cloudToken);
      if (typeof claims?.exp === 'number' && claims.exp < expiresAt) {
        expiresAt = claims.exp;
      }
    } catch {
      // An undecodable token still got past the issuer, so keep the default
      // ceiling rather than refusing to mint.
    }
  }

  // Already expired: minting would hand back a token every route rejects.
  if (expiresAt <= issuedAt) return null;

  const token = jwt.sign(
    {
      // Both spellings, because extractUserId in Middleware.js and
      // socketIdentity.js accept id/userId/user_id/sub and the two files
      // disagree about which they prefer.
      id: userId,
      userId,
      email,
      // Distinguishable in logs from a cloud-issued token without changing how
      // any consumer behaves — every reader treats it as a local session.
      auth_type: 'exchanged',
      iat: issuedAt,
      exp: expiresAt,
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );

  return { token, expiresAt: expiresAt * 1000 };
}
