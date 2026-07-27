// Last measured request size, per conversation.
//
// The context breakdown (system / tools / messages / output reserve) is
// computed by the backend at request time and pushed over SSE. It lives only
// in the in-memory monitoring slot, so a page reload had nothing to show and
// the panel sat at "0 / 1.0M" until the user sent another message.
//
// This is a DISPLAY CACHE of the last value the backend actually reported for
// a conversation — not a derived estimate. The next live context_status event
// supersedes it. Deliberately localStorage rather than a DB column: it is
// per-browser presentation state, it needs no migration, and losing it costs
// nothing more than the blank panel we already had.

const STORAGE_KEY = 'agnt_last_context_status';

// Bounded so a long-lived browser profile cannot grow this without limit.
export const CACHE_LIMIT = 40;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Corrupt payload, quota error, or storage disabled (private mode).
    return {};
  }
}

function isPersistableId(conversationId) {
  return (
    !!conversationId &&
    typeof conversationId === 'string' &&
    // Optimistic client-side ids are replaced once the server assigns a real
    // one, so caching against them would strand entries that never resolve.
    !conversationId.startsWith('temp-')
  );
}

/**
 * @returns {object|null} the cached context status, or null when absent.
 */
export function loadContextStatus(conversationId) {
  if (!isPersistableId(conversationId)) return null;
  const entry = readAll()[conversationId];
  if (!entry || typeof entry !== 'object') return null;
  // `cachedAt` is bookkeeping for eviction — strip it so callers receive the
  // same shape the SSE event delivers.
  const { cachedAt: _cachedAt, ...status } = entry;
  return status;
}

/**
 * Persist the last reported context status for a conversation.
 * Silently no-ops when storage is unavailable — this is presentation state.
 */
export function saveContextStatus(conversationId, status) {
  if (!isPersistableId(conversationId) || !status || typeof status !== 'object') return;
  try {
    const all = readAll();
    all[conversationId] = { ...status, cachedAt: Date.now() };

    const ids = Object.keys(all);
    if (ids.length > CACHE_LIMIT) {
      ids.sort((a, b) => (all[b]?.cachedAt || 0) - (all[a]?.cachedAt || 0));
      for (const id of ids.slice(CACHE_LIMIT)) delete all[id];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota exceeded or storage disabled — nothing here is load-bearing */
  }
}

export function clearContextStatusCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
