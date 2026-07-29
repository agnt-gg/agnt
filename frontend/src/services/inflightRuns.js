/**
 * inflightRuns.js — a durable note of which turns were still generating when
 * this tab went away.
 *
 * WHY THIS IS ITS OWN THING, AND NOT STORE STATE:
 *
 * The two chat stores persist completely differently. `chatUnified` writes its
 * conversations to localStorage; the main `chat` module keeps messages in memory
 * only and relies on a debounced server-side autosave. Neither one can be
 * trusted to remember "a turn was in progress" across a refresh — which is
 * exactly the fact we need in order to reattach.
 *
 * So the marker lives on its own: written the moment the server assigns a
 * conversation id, cleared when the turn ends, and read once at boot. It is the
 * smallest piece of state that has to survive, and keeping it independent means
 * both stores (and any future chat surface) get resume from one mechanism
 * instead of each inventing its own.
 *
 * Entries are self-expiring: a marker whose tab died without cleanup would
 * otherwise trigger a pointless reattach on every future load, forever.
 */

const STORAGE_KEY = 'agnt_inflight_runs';

/**
 * How long a marker stays actionable. Comfortably longer than any real turn,
 * short enough that stale entries disappear on their own.
 */
const MARKER_TTL_MS = 30 * 60 * 1000;

/** Defensive ceiling — concurrent turns are normal, thousands are a leak. */
const MAX_MARKERS = 50;

const readAll = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (map) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // Storage full or unavailable (private mode). Resume is an enhancement, not
    // a correctness dependency — degrade quietly rather than break sending.
    console.warn('[inflightRuns] Could not persist run markers:', e?.message || e);
  }
};

const prune = (map) => {
  const cutoff = Date.now() - MARKER_TTL_MS;
  const entries = Object.entries(map)
    .filter(([, meta]) => meta && typeof meta.startedAt === 'number' && meta.startedAt > cutoff)
    .sort((a, b) => b[1].startedAt - a[1].startedAt)
    .slice(0, MAX_MARKERS);
  return Object.fromEntries(entries);
};

/**
 * Record that a turn is generating.
 *
 * @param {string} conversationId Server-assigned id. Call this on
 *        `conversation_started`, never with a client temp id — a temp id cannot
 *        be reattached to because the server never knew it.
 * @param {{chatType?: string, channelKey?: string|null}} meta
 */
export function markRunStarted(conversationId, { chatType = 'orchestrator', channelKey = null } = {}) {
  if (!conversationId || String(conversationId).startsWith('temp-')) return;
  const map = prune(readAll());
  map[conversationId] = { chatType, channelKey, startedAt: Date.now() };
  writeAll(map);
}

/** Clear the marker for a finished (or cancelled, or failed) turn. */
export function markRunEnded(conversationId) {
  if (!conversationId) return;
  const map = readAll();
  if (!(conversationId in map)) return;
  delete map[conversationId];
  writeAll(prune(map));
}

/**
 * Every turn that was still marked as generating, newest first.
 * @returns {Array<{conversationId: string, chatType: string, channelKey: string|null, startedAt: number}>}
 */
export function listInflightRuns() {
  const map = prune(readAll());
  writeAll(map);
  return Object.entries(map)
    .map(([conversationId, meta]) => ({ conversationId, ...meta }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Test helper. */
export function _clearAllMarkers() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const _STORAGE_KEY = STORAGE_KEY;
