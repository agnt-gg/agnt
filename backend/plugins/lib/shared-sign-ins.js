/**
 * The sign-ins AGNT has published for everyone, by id.
 *
 * Asked WITHOUT a credential on purpose: anonymously, api.agnt.gg/auth/providers
 * answers with exactly the global (shared) catalogue. Signed in, it would add
 * the caller's private sign-ins too, and a plugin that only resolves against
 * its author's private sign-in is precisely what must not be published
 * (Calendly, 2026-10-21).
 *
 * Returns null when the list cannot be read (offline, server down). Callers
 * treat null as "unknown", never as "empty": an empty list would turn every
 * sign-in into an error.
 */

const DEFAULT_BASE_URL = 'https://api.agnt.gg';
const CACHE_MS = 10 * 60 * 1000;

let cached = { at: 0, baseUrl: null, ids: null };

/** Ids from either response shape: a bare array (anonymous) or { providers }. */
export function sharedIdsFromResponse(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.providers) ? body.providers : null;
  if (!list) return null;
  return list
    .filter((provider) => provider && (provider.is_global === undefined || String(provider.is_global) === '1'))
    .map((provider) => String(provider.id || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {{ baseUrl?: string, timeoutMs?: number, fetchImpl?: typeof fetch, fresh?: boolean }} [options]
 * @returns {Promise<string[]|null>}
 */
export async function fetchSharedSignInIds({ baseUrl, timeoutMs = 8000, fetchImpl = globalThis.fetch, fresh = false } = {}) {
  const base = String(baseUrl || process.env.REMOTE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!fresh && cached.ids && cached.baseUrl === base && Date.now() - cached.at < CACHE_MS) return cached.ids;
  try {
    const response = await fetchImpl(`${base}/auth/providers`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const ids = sharedIdsFromResponse(await response.json());
    if (!ids || !ids.length) return null;
    cached = { at: Date.now(), baseUrl: base, ids };
    return ids;
  } catch {
    return null;
  }
}

/** Test hook. */
export function __resetSharedSignInCache() {
  cached = { at: 0, baseUrl: null, ids: null };
}
