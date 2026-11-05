/**
 * transcriptBranching.js — cut a PROVIDER transcript at a message the client
 * holds, for "delete from here" and "fork from here".
 *
 * WHY A CUT CANNOT BE AN INDEX OR AN ID
 * -------------------------------------
 * conversation_logs.full_history is the provider's wire format: one row per
 * tool round-trip, tool results on synthetic user rows, no UI message ids
 * (chatStreamReducer.mirror.js serverMessagesToUi). The client's transcript is
 * a projection of it with FEWER rows, and its head may have been compacted
 * into a summary the log no longer holds turn by turn. So neither a position
 * nor an id the client knows names a row here.
 *
 * What both sides do share is what the user typed. A cut is therefore named
 * by the user message it is anchored to — its exact words — and how many
 * later user messages carry the same words (so "continue", "continue" picks
 * the right one). Matching uses the same rule history rehydration trusts:
 * equal, or the server's decoration of those words (isDecorationOf).
 *
 * Searching from the END is what makes this survive compaction: compaction
 * only ever replaces the head, and every action a user can take is on a
 * message they can see.
 *
 * FAILS CLOSED. No match, or a malformed cut, returns a reason and no
 * transcript; the caller refuses rather than guessing a cut point.
 *
 * Pure: no database, no I/O.
 */

import { isDecorationOf } from './historyRehydration.js';

/**
 * Where the cut falls relative to the anchor user message:
 *   before  — drop the anchor and everything after it (delete a user message);
 *   through — keep the anchor, drop its reply and everything after
 *             (delete a reply, or fork at a user message);
 *   turn    — keep the anchor's whole turn, drop the next user message and
 *             everything after it (fork at a reply).
 */
export const CUT_MODES = Object.freeze(['before', 'through', 'turn']);

/** A user row someone typed, as opposed to tool-result plumbing. */
export function isUtterance(message) {
  if (message?.role !== 'user') return false;
  if (typeof message.content === 'string') return true;
  if (!Array.isArray(message.content) || message.content.length === 0) return false;
  return !message.content.every((block) => block?.type === 'tool_result');
}

function isSameUtterance(stored, text) {
  return typeof stored?.content === 'string' && (stored.content === text || isDecorationOf(stored.content, text));
}

/**
 * Validate a cut from an untrusted body.
 * @returns {{anchorText: string, sameTextAfter: number, mode: string}|null}
 */
export function parseCut(body, allowedModes = CUT_MODES) {
  const { anchorText, sameTextAfter = 0, mode } = body || {};
  if (typeof anchorText !== 'string' || anchorText === '') return null;
  if (!Number.isInteger(sameTextAfter) || sameTextAfter < 0) return null;
  if (!allowedModes.includes(mode)) return null;
  return { anchorText, sameTextAfter, mode };
}

/** Index of the anchor user row, or -1. */
export function locateAnchor(messages, { anchorText, sameTextAfter = 0 }) {
  let skip = sameTextAfter;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== 'user' || !isSameUtterance(messages[i], anchorText)) continue;
    if (skip === 0) return i;
    skip -= 1;
  }
  return -1;
}

/**
 * Cut a provider transcript.
 * @returns {{ok: true, messages: Array<object>} | {ok: false, reason: string}}
 *   `messages` is a new array (rows are shared, not copied).
 */
export function cutTranscript(messages, cut) {
  if (!Array.isArray(messages)) return { ok: false, reason: 'no-transcript' };
  if (!cut || !CUT_MODES.includes(cut.mode)) return { ok: false, reason: 'bad-cut' };
  const anchor = locateAnchor(messages, cut);
  if (anchor === -1) return { ok: false, reason: 'anchor-not-found' };

  if (cut.mode === 'before') return { ok: true, messages: messages.slice(0, anchor) };
  if (cut.mode === 'through') return { ok: true, messages: messages.slice(0, anchor + 1) };

  const nextTurn = messages.findIndex((message, i) => i > anchor && isUtterance(message));
  return { ok: true, messages: messages.slice(0, nextTurn === -1 ? messages.length : nextTurn) };
}

/** The last assistant text of a transcript, for conversation_logs.final_response. */
export function finalResponseOf(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('');
      if (text.trim()) return text;
    }
  }
  return '';
}

export default { CUT_MODES, isUtterance, parseCut, locateAnchor, cutTranscript, finalResponseOf };
