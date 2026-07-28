/**
 * Media-subresource authentication cookie.
 *
 * `/api/local-file/*` now requires a credential (it previously served any file
 * on disk to any unauthenticated caller on the network). But the requests that
 * hit it are issued by the BROWSER, not by our code: <img src>, <video src>,
 * <iframe src>, and — critically — relative URLs inside served HTML that
 * resolve against an injected `<base href="/api/local-file/<dir>/">`.
 *
 * None of those can carry an Authorization header, and a query parameter does
 * not survive relative-URL resolution (a relative href does not inherit the
 * parent's query string). A cookie is the only carrier that works for all of
 * them, which is why it exists.
 *
 * Scope is deliberately narrow:
 *   path=<one media route>  — never sent to any other endpoint
 *   SameSite=Strict         — never sent on a cross-site navigation
 *   Secure when on https    — omitted on http://localhost, where Secure would
 *                             stop the cookie being set at all
 *
 * WHY A LIST OF PATHS, NOT ONE `/api`
 * ───────────────────────────────────
 * Cookie paths are prefix-matched, so a single `path=/api` cookie would ride
 * along on POST /api/filesystem/file and every other mutating endpoint — a
 * CSRF carrier we have no reason to create. Instead one cookie is written per
 * byte-streaming route (same name, distinct paths: the browser keys cookies on
 * name+path, so these coexist and only the matching one is ever sent).
 *
 * The list must mirror backend/src/utils/mediaRoutes.js — a route missing here
 * gets a 401 on every <img>/<video>/<iframe> load, which is exactly the outage
 * that produced this comment. A cross-file test asserts the two agree.
 */

export const MEDIA_COOKIE_NAME = 'agnt_media_token';

/**
 * Every route whose bytes are loaded by the browser itself.
 * Mirrors MEDIA_ROUTE_PREFIXES in backend/src/utils/mediaRoutes.js.
 */
export const MEDIA_COOKIE_PATHS = Object.freeze([
  '/api/local-file', // arbitrary absolute path, Range-enabled (chat, widgets, artifact HTML)
  '/api/filesystem/raw', // workspace-relative bytes (Artifacts image/video/audio/PDF preview)
  '/api/images', // generated images by id, once the in-memory base64 cache is gone
]);

/** @deprecated Kept for callers that predate multi-path scoping. */
export const MEDIA_COOKIE_PATH = MEDIA_COOKIE_PATHS[0];

const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

/**
 * Seconds until a JWT expires, or null when it has no readable `exp`.
 * Best-effort: a token we cannot parse still gets the default lifetime, and
 * the server is the one that actually decides validity.
 */
function secondsUntilExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload?.exp) return null;
    const seconds = Math.floor(payload.exp - Date.now() / 1000);
    return seconds > 0 ? seconds : 0;
  } catch {
    return null;
  }
}

function isSecureContext() {
  return typeof window !== 'undefined' && window.location?.protocol === 'https:';
}

/**
 * Write the media cookie so browser-issued subresource requests authenticate.
 * @param {string} token
 * @returns {boolean} whether a cookie was written
 */
export function setMediaCookie(token) {
  if (typeof document === 'undefined') return false;
  if (!token || token === 'null' || token === 'undefined') {
    clearMediaCookie();
    return false;
  }
  const ttl = secondsUntilExpiry(token);
  if (ttl === 0) {
    // Already expired — writing it would only produce confusing 401s on media.
    clearMediaCookie();
    return false;
  }
  const maxAge = ttl ?? DEFAULT_MAX_AGE;
  for (const cookiePath of MEDIA_COOKIE_PATHS) {
    const parts = [
      `${MEDIA_COOKIE_NAME}=${encodeURIComponent(token)}`,
      `path=${cookiePath}`,
      `max-age=${maxAge}`,
      'SameSite=Strict',
    ];
    if (isSecureContext()) parts.push('Secure');
    document.cookie = parts.join('; ');
  }
  return true;
}

/**
 * Remove the media cookie from every path it was written to.
 * Each path must be mirrored EXACTLY — a clear with a mismatched path is a
 * no-op and silently leaves a live credential behind on logout.
 */
export function clearMediaCookie() {
  if (typeof document === 'undefined') return;
  for (const cookiePath of MEDIA_COOKIE_PATHS) {
    document.cookie = `${MEDIA_COOKIE_NAME}=; path=${cookiePath}; max-age=0; SameSite=Strict`;
  }
}

/**
 * Sync the cookie from whatever token is already in localStorage.
 *
 * Called synchronously at app boot, BEFORE mount: a chat message containing an
 * <img> can render on the first paint, and if the cookie is not in place by
 * then that image 401s and shows broken for the rest of the session.
 */
export function syncMediaCookieFromStorage() {
  try {
    const token = localStorage.getItem('token');
    if (token) return setMediaCookie(token);
    clearMediaCookie();
    return false;
  } catch {
    return false;
  }
}

export default {
  setMediaCookie,
  clearMediaCookie,
  syncMediaCookieFromStorage,
  MEDIA_COOKIE_NAME,
  MEDIA_COOKIE_PATH,
  MEDIA_COOKIE_PATHS,
};
