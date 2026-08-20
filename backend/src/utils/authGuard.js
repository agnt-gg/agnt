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

import { verifiedUserSync } from '../services/auth/remoteTokenVerifier.js';

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

  if (process.env.TRUST_REMOTE_AUTH === 'true') {
    try {
      const user = toUser(jwt.decode(token), 'remote');
      if (user) return { ok: true, user };
    } catch {
      /* fall through to strict verification */
    }
  }

  try {
    const user = toUser(jwt.verify(token, process.env.JWT_SECRET), 'local');
    if (!user) return { ok: false, reason: 'no-subject' };
    return { ok: true, user };
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
      if (user) return { ok: true, user };
    }

    return { ok: false, reason: 'invalid' };
  }
}

/**
 * Express middleware factory that ACTUALLY REJECTS unauthenticated requests.
 *
 * @param {object} [opts] - Carrier options, forwarded to extractToken.
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(opts = {}) {
  return function requireAuthMiddleware(req, res, next) {
    const token = extractToken(req, opts);
    const result = verifyAuthToken(token);
    if (!result.ok) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        reason: result.reason,
      });
    }
    req.user = result.user;
    // Mirror authenticateToken's session side-effect so downstream helpers
    // (getUserTokenFromSession) behave identically on guarded routes.
    if (req.session) {
      req.session.userToken = token;
      req.session.userData = result.user;
      req.session.lastActivity = Date.now();
    }
    return next();
  };
}

/** Pre-built guard for ordinary JSON APIs (Bearer header only). */
export const requireAuthHeader = requireAuth();

/** Pre-built guard for browser-issued media subresources (header|cookie|query). */
export const requireAuthMedia = requireAuth({ allowCookie: true, allowQuery: true });

export default { requireAuth, requireAuthHeader, requireAuthMedia, extractToken, verifyAuthToken, parseCookies, MEDIA_COOKIE_NAME };
