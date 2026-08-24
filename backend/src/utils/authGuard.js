/**
 * Real authentication guards.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * `Middleware.js#authenticateToken` is a DECORATOR, not a guard. On a missing
 * or invalid token it sets `req.user = { isAuthenticated: false }` and calls
 * `next()`. Every route that "uses" it is therefore fully reachable by an
 * unauthenticated caller unless the handler independently re-checks
 * `req.user.isAuthenticated` — and a survey of backend/src/routes found that
 * only 2 of 37 route files do.
 *
 * That is a systemic defect, not a per-route oversight: the name promises a
 * guarantee the implementation never made. This module supplies the guarantee.
 *
 * `authenticateToken` is deliberately left alone — several routes depend on
 * its degrade-to-anonymous behaviour (e.g. env-sourced provider badges). New
 * and sensitive routes should use `requireAuth()` from here instead, and
 * `routeSecurity.test.js` fails the build if a route lands without one.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL CARRIERS
 * ---------------------------------------------------------------------------
 * Bearer header is the default and the only carrier for JSON APIs.
 *
 * Media routes (`/api/local-file/*`) additionally accept a cookie, because the
 * requests are issued by the browser itself for <img>/<video>/<iframe> subresources
 * and cannot carry a custom header. A query parameter is NOT sufficient there:
 * served HTML resolves relative sub-resources against a `<base href>`, and a
 * relative URL does not inherit the parent's query string. A cookie is the only
 * carrier that survives that resolution, which is why it is the primary one.
 */

import jwt from 'jsonwebtoken';

import { isPermittedUser, NOT_A_MEMBER } from '../services/auth/tenantOwnership.js';
import {
  isRemoteVerifyMode,
  tenantVerdictSync,
  verifiedUserSync,
  verifyViaIssuer,
} from '../services/auth/remoteTokenVerifier.js';

/**
 * "I have no answer for this token", as distinct from "this token is bad".
 *
 * The difference is the whole point. The client logs out on `invalid` and only
 * on `invalid`, so a guard that says `invalid` when it means `unverified`
 * destroys a working session. See the block above `requireAuth`.
 */
export const UNVERIFIED = 'unverified';

/** Cookie name used for browser-issued media subresource requests. */
export const MEDIA_COOKIE_NAME = 'agnt_media_token';

/**
 * Parse a Cookie request header into a plain object.
 * Hand-rolled rather than pulling in cookie-parser: this is the only place
 * AGNT reads cookies, and the grammar we need is a strict subset.
 *
 * @param {string|undefined} header - Raw `Cookie:` header value.
 * @returns {Record<string,string>}
 */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    let value = part.slice(eq + 1).trim();
    // Strip one layer of double quotes if present (RFC 6265 quoted-string).
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

const isUsableToken = (t) => typeof t === 'string' && t.length > 0 && t !== 'null' && t !== 'undefined';

/**
 * Pull a token off a request from the allowed carriers, in priority order.
 *
 * @param {import('express').Request} req
 * @param {object} [opts]
 * @param {boolean} [opts.allowCookie=false]
 * @param {boolean} [opts.allowQuery=false]
 * @param {string}  [opts.cookieName=MEDIA_COOKIE_NAME]
 * @returns {string|null}
 */
export function extractToken(req, { allowCookie = false, allowQuery = false, cookieName = MEDIA_COOKIE_NAME } = {}) {
  const authHeader = req?.headers?.['authorization'] || req?.headers?.Authorization;
  if (typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)) {
    const t = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (isUsableToken(t)) return t;
  }
  if (allowQuery) {
    const q = req?.query?.token;
    if (isUsableToken(q)) return q;
  }
  if (allowCookie) {
    const cookies = parseCookies(req?.headers?.cookie);
    const c = cookies[cookieName];
    if (isUsableToken(c)) return c;
  }
  return null;
}

/**
 * Verify a token using the same rules as Middleware.authenticateToken:
 * TRUST_REMOTE_AUTH mode decodes without verifying (tokens are issued by the
 * remote auth server and validated upstream by the proxy); otherwise the
 * signature is verified against JWT_SECRET.
 *
 * @param {string|null} token
 * @returns {{ ok: boolean, user?: object, reason?: string }}
 */
export function verifyAuthToken(token) {
  if (!isUsableToken(token)) return { ok: false, reason: 'missing' };

  const toUser = (decoded, authType) => {
    const id = decoded?.id || decoded?.userId || decoded?.user_id || decoded?.sub || null;
    if (!id) return null;
    return {
      isAuthenticated: true,
      id,
      userId: id,
      email: decoded.email,
      auth_type: decoded.auth_type || authType,
    };
  };

  // Genuine, and separately, allowed to be here. This path serves media, file,
  // image, pairing and SSE routes plus the soft identity lookups in
  // ModelRoutes/AuthRoutes — all of which would otherwise stay open to any
  // account while the REST middleware was closed. One boundary, or none.
  // See services/auth/tenantOwnership.js.
  // The verdict comes from the entry the async path already wrote for this
  // exact token, so the two can never disagree about the same caller. Null
  // when nothing has verified it yet, which falls back to the env list.
  const admit = (user) =>
    isPermittedUser(user.id, tenantVerdictSync(token)) ? { ok: true, user } : { ok: false, reason: NOT_A_MEMBER };

  if (process.env.TRUST_REMOTE_AUTH === 'true') {
    try {
      const user = toUser(jwt.decode(token), 'remote');
      if (user) return admit(user);
    } catch {
      /* fall through to strict verification */
    }
  }

  try {
    const user = toUser(jwt.verify(token, process.env.JWT_SECRET), 'local');
    if (!user) return { ok: false, reason: 'no-subject' };
    return admit(user);
  } catch (err) {
    // An expired token is expired, full stop — never look further, or `exp`
    // becomes bypassable.
    if (err?.name === 'TokenExpiredError') return { ok: false, reason: 'expired' };

    // A HOSTED INSTALL HOLDS NO COPY OF THE ISSUER'S SIGNING KEY, by design:
    // that key is public and this process is on the open internet. So a
    // perfectly genuine cloud token always fails the verify above, and this is
    // the only way it can succeed.
    //
    // Not a weakening — the entry it reads exists only because api.agnt.gg
    // already confirmed this exact token string, and the identity returned is
    // the issuer's, not a local decode. See services/auth/remoteTokenVerifier.js.
    const remote = verifiedUserSync(token);
    if (remote) {
      const user = toUser(remote, 'issuer-verified');
      if (user) return admit(user);
    }

    // NOTHING ABOVE PROVED THIS TOKEN IS BAD — ON A HOSTED TENANT.
    //
    // On a desktop install the verify above IS authoritative: this process
    // holds the issuer's signing key, so a signature it cannot check is a
    // signature that is wrong, and `invalid` is the honest word.
    //
    // A tenant in verify-remote mode holds no such key by design, so the
    // failure above carries no information whatsoever about the token. The
    // only local evidence is the verifier cache, and that expires every
    // POSITIVE_TTL_MS (5 minutes) while nothing on this path can refill it —
    // `cache.set` lives inside the async `verifyViaIssuer` alone. Calling that
    // silence `invalid` told the client its session was dead every time a
    // cache entry aged out, and the client believed it and logged the user
    // out. Measured on the live fleet: 401-with-a-token on the provider status
    // polls, immediately followed by the same endpoints going out bare.
    //
    // So the sync path now reports what it actually knows. Callers that CAN
    // await resolve it for real (see requireAuth); callers that cannot get a
    // refusal that does not end the session.
    return { ok: false, reason: isRemoteVerifyMode() ? UNVERIFIED : 'invalid' };
  }
}

/**
 * Express middleware factory that ACTUALLY REJECTS unauthenticated requests.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ASKS THE ISSUER INSTEAD OF READING A CACHE AND GUESSING
 * ---------------------------------------------------------------------------
 * `verifyAuthToken` is synchronous because three call sites cannot await:
 * media subresources, the websocket handshake, and SSE. These 40-odd JSON
 * routes are NOT among them — they are ordinary request/response handlers,
 * and Express has awaited middleware since forever.
 *
 * Being synchronous had a cost that was invisible until it was measured. On a
 * hosted tenant the only local evidence about a cloud token is the verifier
 * cache, whose positive entries live 5 minutes and which only the ASYNC path
 * can write. So every guarded route was one expired entry away from refusing a
 * perfectly good session, and the refusal it produced — `invalid` — is exactly
 * the word the client treats as proof the session is dead. The user was logged
 * out mid-session, on a timer they could feel but not explain.
 *
 * `Middleware.authenticateToken` never had this problem: it awaits
 * `verifyViaIssuer` and gets a real answer. This guard now does the same,
 * which also means the two agree about the same token instead of contradicting
 * each other within the same millisecond.
 *
 * THE FAST PATH STAYS SYNCHRONOUS, deliberately. A locally-verifiable token,
 * a warm cache entry, an expired token, a non-member and a missing header all
 * resolve without a single await, so desktop behaviour is bit-for-bit
 * unchanged and no ordering shifts under any existing caller. Only
 * `unverified` — which `verifyAuthToken` can produce only in verify-remote
 * mode — costs a round trip, and only when the cache has nothing to say.
 *
 * @param {object} [opts] - Carrier options, forwarded to extractToken.
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(opts = {}) {
  /** Admit a caller: identity on the request, session side-effect, next(). */
  const admit = (req, token, user, next) => {
    req.user = user;
    // Mirror authenticateToken's session side-effect so downstream helpers
    // (getUserTokenFromSession) behave identically on guarded routes.
    if (req.session) {
      req.session.userToken = token;
      req.session.userData = user;
      req.session.lastActivity = Date.now();
    }
    return next();
  };

  const refuse = (res, reason) => {
    // A non-member holds a perfectly good credential; it is simply not good
    // HERE. Answering 401 would tell the client to go and get another one,
    // which it would then present with the identical result, forever.
    const notMember = reason === NOT_A_MEMBER;
    return res.status(notMember ? 403 : 401).json({
      success: false,
      error: notMember ? 'This AGNT instance belongs to another account.' : 'Authentication required',
      reason,
    });
  };

  return function requireAuthMiddleware(req, res, next) {
    const token = extractToken(req, opts);
    const result = verifyAuthToken(token);

    if (result.ok) return admit(req, token, result.user, next);
    if (result.reason !== UNVERIFIED) return refuse(res, result.reason);

    // Unresolved locally. Ask the only party that can actually answer.
    return verifyViaIssuer(token)
      .then((remote) => {
        if (remote.ok && remote.user) {
          const id = remote.user.id || remote.user.userId;
          if (!id) return refuse(res, 'no-subject');
          // Genuine is not the same as welcome. Same membership boundary the
          // synchronous path applies, on the verdict from this same response.
          if (!isPermittedUser(id, remote.tenant)) return refuse(res, NOT_A_MEMBER);
          return admit(
            req,
            token,
            {
              isAuthenticated: true,
              id,
              userId: id,
              email: remote.user.email,
              auth_type: 'issuer-verified',
            },
            next,
          );
        }

        // A DENIAL AND AN OUTAGE ARE NOT THE SAME ANSWER.
        //
        // `denied:` is the issuer explicitly disowning the credential — the
        // one case where ending the session is correct. Anything else means
        // the issuer could not be reached or could not be understood, and
        // reporting that as `invalid` would turn a bad afternoon at the API
        // into a fleet-wide logout. The verifier already refuses to invent a
        // positive during an outage; this refuses to invent a negative.
        return refuse(res, String(remote.source || '').startsWith('denied:') ? 'invalid' : UNVERIFIED);
      })
      .catch(() => refuse(res, UNVERIFIED));
  };
}

/** Pre-built guard for ordinary JSON APIs (Bearer header only). */
export const requireAuthHeader = requireAuth();

/** Pre-built guard for browser-issued media subresources (header|cookie|query). */
export const requireAuthMedia = requireAuth({ allowCookie: true, allowQuery: true });

export default { requireAuth, requireAuthHeader, requireAuthMedia, extractToken, verifyAuthToken, parseCookies, MEDIA_COOKIE_NAME };
