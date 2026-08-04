/**
 * chatDrafts — per-conversation composer drafts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every composer used to hold its draft in a plain component ref, so text
 * typed into one conversation followed you into the next — and died entirely
 * on a reload. A draft is not incidental UI state: it is an unsent message TO
 * A SPECIFIC CONVERSATION, so it is keyed by the conversation's identity
 * (activeConversationId for the main chat, channelKey for panel chats) and
 * outlives the component that happened to render it.
 *
 * WHY localStorage AND NOT THE BACKEND
 * ------------------------------------
 * The per-conversation provider selection persists inside the conversation
 * state itself, which is saved when conversations are saved. A draft cannot
 * ride that vehicle: it exists precisely while nothing has been sent, and it
 * changes on every keystroke — the wrong cadence for a network write. Drafts
 * are device-local by nature, like browser form state. One JSON blob under one
 * key, same shape as soundPreferences.js, the established pattern here.
 *
 * BOUNDED BY CONSTRUCTION
 * -----------------------
 * localStorage is a shared 5MB budget. An unbounded draft map is a slow leak
 * that eventually breaks unrelated features, so both axes are capped: drafts
 * longer than MAX_DRAFT_CHARS are clamped, and beyond MAX_DRAFTS conversations
 * the oldest entries are evicted. Storage failures (quota, private mode) are
 * swallowed — a draft is a convenience, and losing one must never become an
 * error dialog.
 */

const STORAGE_KEY = 'chatDraftsV1';

/** Longest draft we will persist. Beyond this, the tail is dropped. */
export const MAX_DRAFT_CHARS = 20000;

/** Most conversations with a stored draft. Oldest are evicted past this. */
export const MAX_DRAFTS = 50;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Corrupted blob: drafts are not worth an error. Start clean.
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
 * The stored draft for a conversation, or '' when there is none.
 * @param {string} id  activeConversationId or channelKey
 */
export function getDraft(id) {
  if (!id || typeof id !== 'string') return '';
  const entry = load()[id];
  return entry && typeof entry.text === 'string' ? entry.text : '';
}

/**
 * Write-through save. An empty or whitespace-only draft DELETES the entry —
 * sending a message clears the input, and that clear must not leave a tombstone
 * that resurrects stale text later.
 */
export function setDraft(id, text) {
  if (!id || typeof id !== 'string') return;
  const all = load();
  const clean = typeof text === 'string' ? text : '';

  if (!clean.trim()) {
    if (all[id]) {
      delete all[id];
      persist(all);
    }
    return;
  }

  all[id] = { text: clean.slice(0, MAX_DRAFT_CHARS), at: Date.now() };

  const ids = Object.keys(all);
  if (ids.length > MAX_DRAFTS) {
    ids
      .sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
      .slice(0, ids.length - MAX_DRAFTS)
      .forEach((k) => delete all[k]);
  }

  persist(all);
}

export function clearDraft(id) {
  setDraft(id, '');
}

export default { getDraft, setDraft, clearDraft, MAX_DRAFT_CHARS, MAX_DRAFTS };
