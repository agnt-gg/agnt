/**
 * Conversation attention — derived unread + archive semantics.
 *
 * THE MODEL
 * ---------
 * Unread is NOT stored anywhere. It is derived from two server columns on
 * content_outputs:
 *
 *     unread  :=  archived_at IS NULL
 *                 AND last_read_at IS NOT NULL
 *                 AND updated_at > last_read_at
 *
 * `updated_at` moves on every save (a finished run autosaves, a background
 * agent turn autosaves, a rename saves). `last_read_at` moves only when the
 * user actually opens the conversation (or on a save while they are viewing
 * it). So "something happened that you haven't seen" falls out of the data
 * with no event bookkeeping, survives reloads, and is identical on every
 * device — the previous localStorage implementation was per-device and a
 * conversation read on the desktop stayed "unread" on the phone forever.
 *
 * WHY A NULL WATERMARK IS *NOT* UNREAD
 * ------------------------------------
 * This clause used to read `last_read_at IS NULL OR updated_at > last_read_at`,
 * i.e. "no watermark" was treated as "needs your attention". That is a
 * category error, and it emptied the feature of meaning the moment it shipped:
 * every conversation predating the column had no watermark, so 1624 of 1649
 * conversations — the entire history — appeared in the "Needs you" rail at
 * once. A triage queue containing everything is not a queue.
 *
 * The migration tried to paper over this by backfilling `last_read_at =
 * updated_at` on the run that added the column. That is a one-shot,
 * fire-and-forget UPDATE across ~780MB of conversation content whose ONLY
 * failure mode is "the entire feature inverts, silently, forever". It did not
 * run. Correctness must not depend on a single unverified write.
 *
 * So NULL now means exactly what it says: no read watermark has ever been
 * recorded, therefore there is no evidence of anything unseen, therefore the
 * conversation is quiet. Unread requires POSITIVE evidence — a watermark that
 * a later change has overtaken. Rows acquire a watermark lazily the first
 * time they are opened or saved (see ContentOutputModel.createOrUpdate), so
 * the population converges with no migration and no mass rewrite.
 *
 * A manual "Mark as Unread" therefore cannot be expressed as NULL. It writes a
 * watermark one second BEFORE `updated_at` — "I have read up to just before
 * the last change" — which is both literally true and derives unread through
 * the same single predicate as everything else. One rule, no special cases.
 *
 * Archived conversations are never unread: archiving IS the statement
 * "I'm done with this".
 *
 * All timestamp inputs accept Date | naive-UTC string | epoch ms | null,
 * normalised through parseServerTime (see utils/serverTime.js for why naive
 * SQLite strings must never hit `new Date()` directly).
 */

import { parseServerTime, toServerDate } from '@/utils/serverTime.js';

/**
 * Is this output unread?
 * @param {{ updated_at?: any, last_read_at?: any, archived_at?: any }} output
 * @returns {boolean}
 */
export function isUnread(output) {
  if (!output) return false;
  if (output.archived_at) return false;

  // No watermark recorded => no evidence of anything unseen => not unread.
  // Checked on the RAW value, not the parsed one: parseServerTime collapses
  // both "absent" and "the epoch" to 0, and the epoch is a real instant.
  const raw = output.last_read_at;
  if (raw === null || raw === undefined || raw === '') return false;

  return parseServerTime(output.updated_at) > parseServerTime(raw);
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
 * Email-style timestamp for a conversation list row.
 *
 *   today       -> "6:52 PM"        (activity today is VISIBLE as it happens)
 *   this year   -> "Aug 5"
 *   older       -> "Aug 5, 2025"
 *
 * The previous rendering was day-only ("Aug 5, 2026"), which meant a save or
 * a Mark-as-Unread today — both of which genuinely move updated_at, server
 * and store alike — produced the exact same string all day. The date WAS
 * updating; the format could not show it. An email client shows the time for
 * today's mail for precisely this reason.
 *
 * @param {any} value server timestamp (Date | string | ms)
 * @param {Date} [now] injectable for tests
 * @returns {string} empty string for absent/unparseable input
 */
export function formatListDate(value, now = new Date()) {
  const d = toServerDate(value);
  if (!d) return '';

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The subset of unread ids that should make NOISE (the sidebar chime).
 *
 * Unread ≠ notifiable. ONE kind of unread must stay silent:
 *
 *   - STREAMING conversations: a running agent autosaves every few seconds,
 *     and each save legitimately re-derives the row as unread. Chiming on
 *     those turns a long agent run into a metronome — the reported
 *     "notification sound ringing over and over". The pulsing indicator
 *     already communicates "working"; the chime's job is "FINISHED changing,
 *     and you haven't seen the result". When the stream ends the id leaves
 *     streamingIds, enters this set, and rings exactly once.
 *
 * The ACTIVE conversation is deliberately NOT excluded. The chime is an
 * oven timer: a run finishing rings once, even for the conversation that is
 * currently selected — "selected" says nothing about whether the user is
 * looking (they may be on another screen entirely, with the chat still
 * active underneath). A manual "Mark as Unread" rings too: every entry into
 * the unread set sounds the same, and the ring confirms the row is queued.
 *
 * Pure function so the exact chime contract is testable without mounting
 * the sidebar.
 *
 * @param {Set<string>} unreadIds derived unread set (unreadIdSet)
 * @param {{ streamingIds?: Set<string> }} context
 * @returns {Set<string>} new set — the ids a NEW appearance of which warrants a chime
 */
export function notifiableUnreadIds(unreadIds, { streamingIds } = {}) {
  const result = new Set();
  for (const id of unreadIds || []) {
    if (streamingIds && streamingIds.has(id)) continue;
    result.add(id);
  }
  return result;
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
