/**
 * Conversation attention — derived unread + archive semantics.
 *
 * THE MODEL
 * ---------
 * Unread is NOT stored anywhere. It is derived from two server columns on
 * content_outputs:
 *
 *     unread  :=  archived_at IS NULL
 *                 AND (last_read_at IS NULL OR updated_at > last_read_at)
 *
 * `updated_at` moves on every save (a finished run autosaves, a background
 * agent turn autosaves, a rename saves). `last_read_at` moves only when the
 * user actually opens the conversation (or on a save while they are viewing
 * it). So "something happened that you haven't seen" falls out of the data
 * with no event bookkeeping, survives reloads, and is identical on every
 * device — the previous localStorage implementation was per-device and a
 * conversation read on the desktop stayed "unread" on the phone forever.
 *
 * Archived conversations are never unread: archiving IS the statement
 * "I'm done with this".
 *
 * All timestamp inputs accept Date | naive-UTC string | epoch ms | null,
 * normalised through parseServerTime (see utils/serverTime.js for why naive
 * SQLite strings must never hit `new Date()` directly).
 */

import { parseServerTime } from '@/utils/serverTime.js';

/**
 * Is this output unread?
 * @param {{ updated_at?: any, last_read_at?: any, archived_at?: any }} output
 * @returns {boolean}
 */
export function isUnread(output) {
  if (!output) return false;
  if (output.archived_at) return false;

  const lastRead = parseServerTime(output.last_read_at);
  if (lastRead === 0) return true; // never read (or manually marked unread)

  return parseServerTime(output.updated_at) > lastRead;
}

/**
 * Set of unread output ids — the shape the sidebar renders against.
 * @param {Array} outputs
 * @returns {Set<string>}
 */
export function unreadIdSet(outputs) {
  const set = new Set();
  for (const output of outputs || []) {
    if (isUnread(output)) set.add(output.id);
  }
  return set;
}

/**
 * The triage rail: every unread, non-archived conversation, OLDEST first.
 *
 * Oldest-first is the invariant that solves "days-old unread conversations
 * get buried": the longer something has waited, the higher it sits. A
 * recency sort would reproduce exactly the failure mode this rail exists
 * to fix.
 *
 * @param {Array} outputs
 * @returns {Array} new array, unread only, ascending updated_at
 */
export function triageRail(outputs) {
  return (outputs || [])
    .filter(isUnread)
    .sort((a, b) => parseServerTime(a.updated_at) - parseServerTime(b.updated_at));
}

/**
 * Compact age label for the rail: "now", "5m", "3h", "4d".
 *
 * Clamped at 0 (clock skew must not print negative ages) and capped at days —
 * past a week the exact number is the message, "this has sat for 12 days".
 *
 * @param {any} value server timestamp (Date | string | ms)
 * @param {number} [now] injectable for tests
 * @returns {string} empty string for unparseable input
 */
export function formatAge(value, now = Date.now()) {
  const t = parseServerTime(value);
  if (t === 0) return '';

  const ageMs = Math.max(0, now - t);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

/**
 * Count unread outputs inside a set of group ids (a group plus its
 * descendants) — the rollup badge on a collapsed group header.
 *
 * @param {Array} outputs
 * @param {Set<string>} groupIds
 * @returns {number}
 */
export function groupUnreadCount(outputs, groupIds) {
  let count = 0;
  for (const output of outputs || []) {
    if (output.group_id && groupIds.has(output.group_id) && isUnread(output)) count++;
  }
  return count;
}
