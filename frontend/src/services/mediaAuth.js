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
 *   path=/api/local-file  — never sent to any other endpoint
 *   SameSite=Strict       — never sent on a cross-site navigation
 *   Secure when on https  — omitted on http://localhost, where Secure would
 *                           stop the cookie being set at all
 */

export const MEDIA_COOKIE_NAME = 'agnt_media_token';
export const MEDIA_COOKIE_PATH = '/api/local-file';

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
  const parts = [
    `${MEDIA_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `path=${MEDIA_COOKIE_PATH}`,
    `max-age=${maxAge}`,
    'SameSite=Strict',
  ];
  if (isSecureContext()) parts.push('Secure');
  document.cookie = parts.join('; ');
  return true;
}

/** Remove the media cookie. Must mirror path exactly or the browser keeps it. */
export function clearMediaCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${MEDIA_COOKIE_NAME}=; path=${MEDIA_COOKIE_PATH}; max-age=0; SameSite=Strict`;
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

export default { setMediaCookie, clearMediaCookie, syncMediaCookieFromStorage, MEDIA_COOKIE_NAME, MEDIA_COOKIE_PATH };
