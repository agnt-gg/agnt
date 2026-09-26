/**
 * conversationSuggestions — the quick-reply pills belong to ONE conversation,
 * at ONE point in it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Suggestions used to live beside the conversation instead of in it: the main
 * chat kept one `ref` for the whole screen, the embedded chats kept one array
 * per channel. Switching conversations therefore carried the pills along, and
 * a suggestion request that finished after a switch wrote its answer into
 * whatever was on screen by then. Both are the same mistake — a write that
 * looks up its target when it lands instead of carrying its address.
 *
 * So a set of suggestions is stored WITH the conversation (in its slot and in
 * its saved transcript) and stamped with an ANCHOR: the point in the
 * conversation it was generated for. A set is only ever shown while its anchor
 * still matches the messages, which makes every stale case — a newer turn, an
 * edit-and-resend, a transcript rewritten by the server at turn end — resolve
 * to "no suggestions" instead of to someone else's.
 *
 * WHY THE ANCHOR IS THE USER'S TURNS, NOT A MESSAGE ID
 * ----------------------------------------------------
 * The server rewrites a conversation's saved row at the end of every turn
 * (persistTurnTranscript), and that projection mints its own message ids.
 * User turns are the one part of a transcript every writer preserves — the
 * server's own merge rules are built on that invariant (preservesUserTurns) —
 * so they are the only anchor that survives a round trip through the server.
 */

import { API_CONFIG } from '@/tt.config.js';

/** Messages of recent history sent to the suggestions endpoint. */
const HISTORY_WINDOW = 10;

const userText = (message) => (typeof message?.content === 'string' ? message.content.trim() : '');

/**
 * FNV-1a, 32-bit. The anchor needs equality, not secrecy, and storing the raw
 * last message would duplicate an arbitrarily large paste into every save.
 */
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The point in a conversation a set of suggestions answers, or null when the
 * user has not said anything yet (a fresh chat shows its starters instead).
 */
export function suggestionAnchor(messages = []) {
  const userTurns = (messages || []).filter((m) => m?.role === 'user');
  if (!userTurns.length) return null;
  return { userTurns: userTurns.length, lastUserHash: hashText(userText(userTurns.at(-1))) };
}

function anchorsEqual(a, b) {
  return !!a && !!b && a.userTurns === b.userTurns && a.lastUserHash === b.lastUserHash;
}

/** A suggestion pill as the UI renders it. Anything else is dropped. */
function isSuggestionItem(item) {
  return !!item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '';
}

/**
 * Validate a stored value (from a slot, localStorage, or a saved transcript).
 * Returns the canonical `{ items, anchor }` or null. Bare arrays — the old,
 * unanchored shape — are rejected: they are exactly the suggestions whose
 * conversation cannot be known.
 */
export function normalizeStoredSuggestions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items.filter(isSuggestionItem) : [];
  const anchor = raw.anchor;
  if (!items.length || !anchor || !Number.isInteger(anchor.userTurns) || typeof anchor.lastUserHash !== 'string') {
    return null;
  }
  return { items, anchor: { userTurns: anchor.userTurns, lastUserHash: anchor.lastUserHash } };
}

/** Stamp freshly generated items with the conversation point they answer. */
export function anchorSuggestions(items, messages) {
  const anchor = suggestionAnchor(messages);
  if (!anchor) return null;
  return normalizeStoredSuggestions({ items, anchor });
}

/** The items to show for `messages`, or [] when the stored set is for another point. */
export function suggestionsFor(stored, messages) {
  const valid = normalizeStoredSuggestions(stored);
  if (!valid) return [];
  return anchorsEqual(valid.anchor, suggestionAnchor(messages)) ? valid.items : [];
}

/** True when `stored` still describes this exact point in `messages`. */
export function isAnchoredTo(stored, messages) {
  return suggestionsFor(stored, messages).length > 0;
}

/**
 * Ask the server for suggestions about `messages`.
 *
 * Returns the raw items, or null on any failure. Never throws: suggestions
 * are an optional garnish and must not be able to break a chat turn.
 */
export async function requestSuggestions({ messages = [], provider, model, context } = {}) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastUser || !lastAssistant) return null;

  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        history: messages.slice(-HISTORY_WINDOW).map((m) => ({ role: m.role, content: m.content })),
        lastUserMessage: lastUser.content,
        lastAssistantMessage: lastAssistant.content,
        provider,
        model,
        ...(context ? { context } : {}),
      }),
    });
    if (!response.ok) {
      console.warn('[conversationSuggestions] request failed:', response.status);
      return null;
    }
    const data = await response.json().catch(() => null);
    return Array.isArray(data?.suggestions) ? data.suggestions : null;
  } catch (e) {
    console.warn('[conversationSuggestions] request failed:', e?.message || e);
    return null;
  }
}
