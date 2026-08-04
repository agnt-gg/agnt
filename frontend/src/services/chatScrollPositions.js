/**
 * chatScrollPositions — per-conversation "where I left off" in the transcript.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reading position is state that belongs to a conversation, exactly like its
 * composer draft and its provider selection — but it was the one piece we
 * threw away. Worse than throwing it away: opening a saved chat explicitly
 * scrolled to the TOP, so a 200-message conversation reopened at message 1.
 * There are three separate places the position died (switching conversations,
 * navigating away from the Chat screen while KeepAlive detaches the subtree,
 * and reloading the app) and one module fixes all three.
 *
 * WHY localStorage AND NOT THE BACKEND
 * ------------------------------------
 * Provider/model/skill/goal persist to `conversation_settings` because they
 * are SEMANTIC — they mean the same thing on every device. A reading position
 * is not: it depends on this viewport's width and height, this device's font
 * metrics and which tool calls happen to be expanded here. Syncing it would
 * teleport a phone user to a position measured on a 4K monitor. It also
 * changes at scroll frequency, which is the wrong cadence for a network
 * write. Device-local is not a compromise here, it is the correct scope —
 * same as chatDrafts.js, same shape, same key discipline.
 *
 * BOUNDED BY CONSTRUCTION
 * -----------------------
 * localStorage is a shared 5MB budget, so the map is LRU-capped. Every read
 * validates before trusting: a half-written or hand-edited entry must read as
 * "no position" rather than propagate a NaN into a scrollTop assignment.
 * Storage failures are swallowed — losing a scroll position is a convenience
 * lost, never an error to show a user.
 */

const STORAGE_KEY = 'chatScrollV1';

/** Most conversations with a stored position. Oldest are evicted past this. */
export const MAX_POSITIONS = 50;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Corrupted blob: a scroll position is not worth an error. Start clean.
    return {};
  }
}

function persist(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded / private mode. See header — never an error.
  }
}

/**
 * Coerce a stored entry into a trustworthy one, or null.
 *
 * This is the boundary where untrusted JSON becomes a number we will assign to
 * `element.scrollTop`. `NaN` there silently scrolls to 0 — i.e. the top, i.e.
 * precisely the bug we are fixing — so an invalid entry must be rejected
 * outright rather than partially honoured.
 */
function normalize(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const atBottom = entry.atBottom !== false;
  const anchorId = typeof entry.anchorId === 'string' && entry.anchorId ? entry.anchorId : null;
  const anchorOffset = Number.isFinite(entry.anchorOffset) ? entry.anchorOffset : 0;

  // A non-bottom position with no anchor carries no recoverable information.
  if (!atBottom && !anchorId) return null;

  let win = null;
  if (Number.isFinite(entry.window) && entry.window > 0) win = Math.floor(entry.window);

  return {
    anchorId,
    anchorOffset,
    atBottom,
    window: win,
    at: Number.isFinite(entry.at) ? entry.at : 0,
  };
}

/**
 * The stored position for a conversation, or null when there is none.
 * A null return means "open where a chat naturally opens" — the bottom.
 *
 * @param {string} id  activeConversationId (main chat) or channelKey (panels)
 */
export function getScrollPosition(id) {
  if (!id || typeof id !== 'string') return null;
  return normalize(load()[id]);
}

/**
 * Write-through save.
 *
 * Note that `atBottom: true` is STORED rather than treated as "no entry", even
 * though both restore to the bottom: the entry also carries the message-window
 * size, and a user sitting at the bottom of a conversation they expanded to
 * 130 messages should get those 130 back.
 */
export function setScrollPosition(id, position) {
  if (!id || typeof id !== 'string') return;
  const clean = normalize(position);
  if (!clean) return;

  const all = load();
  all[id] = {
    anchorId: clean.anchorId,
    anchorOffset: Math.round(clean.anchorOffset),
    atBottom: clean.atBottom,
    window: clean.window,
    at: Date.now(),
  };

  const ids = Object.keys(all);
  if (ids.length > MAX_POSITIONS) {
    ids
      .sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
      .slice(0, ids.length - MAX_POSITIONS)
      .forEach((k) => delete all[k]);
  }

  persist(all);
}

export function clearScrollPosition(id) {
  if (!id || typeof id !== 'string') return;
  const all = load();
  if (!(id in all)) return;
  delete all[id];
  persist(all);
}

/**
 * Follow a conversation through an identity change.
 *
 * A new chat starts life as `temp-<timestamp>` and is renamed to the
 * server-assigned UUID the moment streaming begins. Without this the entry
 * written under the temp id is orphaned: it can never be read again (nothing
 * will ever ask for that id) and it occupies an LRU slot until it is evicted,
 * pushing out positions the user can still reach. The store owns identity
 * renames, so it calls this from the same mutation that renames the skill,
 * goal and provider bindings.
 */
export function renameScrollPosition(oldId, newId) {
  if (!oldId || !newId || typeof oldId !== 'string' || typeof newId !== 'string') return;
  if (oldId === newId) return;
  const all = load();
  if (!all[oldId]) return;
  all[newId] = all[oldId];
  delete all[oldId];
  persist(all);
}

export default {
  getScrollPosition,
  setScrollPosition,
  clearScrollPosition,
  renameScrollPosition,
  MAX_POSITIONS,
};
