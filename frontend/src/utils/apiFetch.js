/**
 * The one place that knows a call to our own backend must carry the session
 * token.
 *
 * WHY THIS EXISTS
 * ---------------
 * `authenticateToken` used to degrade to an anonymous request instead of
 * rejecting, so a `fetch()` that forgot the Authorization header still worked —
 * it just ran with `req.user.id === undefined`. When those routes were hardened
 * to actually 401, every call site that had quietly been relying on that became
 * a hard failure, and the whole plugin lifecycle (install, uninstall, update,
 * inspect) plus voice transcription broke at once.
 *
 * The reason it was a *class* of bug rather than one mistake is that there was
 * no single owner of the rule: `getAuthHeaders()` had been copy-pasted into
 * seven store modules and services, so any new `fetch` either duplicated it or
 * forgot it, and forgetting was silent. apiAuthContract.spec.js now fails the
 * build on the forgetting case, and this module is the thing it points people
 * at.
 *
 * WHY A HEADER HELPER RATHER THAN A fetch() WRAPPER EVERYWHERE
 * -----------------------------------------------------------
 * Several call sites need the raw Response for streaming (SSE readers),
 * AbortController plumbing, or FormData uploads. A wrapper that owned the whole
 * call would have to re-expose all of that. Owning only the headers composes
 * with every existing pattern, so adoption never forces a rewrite.
 */

/** Current session token, or null. */
export function getAuthToken() {
  try {
    return localStorage.getItem('token');
  } catch {
    // Storage can throw in a sandboxed/partitioned context. A missing token is
    // a 401, which is recoverable; a thrown error here would take out the call.
    return null;
  }
}

/**
 * Headers for a backend call, with the bearer token attached when we have one.
 *
 * Pass `extra` for anything call-specific. Content-Type is NOT added for you:
 * a FormData upload must leave it unset so the browser can generate the
 * multipart boundary, and hardcoding JSON here would silently corrupt those.
 *
 * @param {Record<string,string>} [extra]
 * @returns {Record<string,string>}
 */
export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Convenience for the common JSON case. */
export function jsonAuthHeaders(extra = {}) {
  return authHeaders({ 'Content-Type': 'application/json', ...extra });
}

/**
 * fetch() with the token attached. Returns the raw Response so callers keep
 * full control over streaming, aborting and error handling.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 */
export function apiFetch(url, options = {}) {
  const { headers, ...rest } = options;
  const isFormData = typeof FormData !== 'undefined' && rest.body instanceof FormData;
  const base = isFormData ? authHeaders(headers) : jsonAuthHeaders(headers);
  return fetch(url, { ...rest, headers: base });
}

export default { apiFetch, authHeaders, jsonAuthHeaders, getAuthToken };
