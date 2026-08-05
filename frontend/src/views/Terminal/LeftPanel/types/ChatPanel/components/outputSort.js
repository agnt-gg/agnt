/**
 * Sidebar conversation ordering.
 *
 * ONE axis, not two tiers.
 *
 * The previous implementation kept a separate "bump" tier that floated any
 * item that had ever transitioned to unread above everything else:
 *
 *     if (aBump && bBump) return bBump - aBump;
 *     if (aBump) return -1;
 *     if (bBump) return 1;
 *
 * That tier was sticky (reading an item deliberately does NOT clear its bump,
 * so the item doesn't jump under the cursor) and unbounded (nothing ever
 * removed an entry). The combination is unsound: every conversation that went
 * unread once outranked every conversation that never did — permanently, for
 * the rest of the session.
 *
 * The conversation you are actively looking at can never enter that tier,
 * because both writers of `unreadOutputIds` guard on
 * `activeConversationId !== conversationId` (chat.js SCOPED_SET_STREAMING and
 * SCOPED_ADD_MESSAGE). So a brand-new chat — the newest thing in the list —
 * sorted BELOW stale, already-read conversations.
 *
 * The fix is to stop modelling "bumped" as a privileged rank and model it as
 * what it actually is: a timestamp of last activity. A save updates
 * `updated_at` server-side (the sidebar refetches on `conversation-saved`); a
 * manual "Mark as Unread" has no server-side write, so it contributes a
 * client-side timestamp instead. Taking the max of the two puts both kinds of
 * activity on the same axis, where they compete fairly:
 *
 *   - new chat saved        -> newest updated_at  -> top
 *   - existing chat saved   -> updated_at moves   -> top
 *   - marked unread         -> bump = now         -> top
 *   - opened / read         -> nothing changes    -> stays put
 *
 * Bumps apply only to the time-based sorts. If the user explicitly sorts
 * alphabetically, injecting recency into that order is simply wrong.
 */

/**
 * Last-activity time for an output, in epoch ms.
 * Invalid or absent dates contribute 0 rather than NaN, which would make
 * every comparison against them false and produce an unstable order.
 */
import { parseServerTime } from '@/utils/serverTime.js';
import { isUnread } from '@/utils/conversationAttention.js';

export function activityTime(output, bumps = {}) {
  if (!output) return 0;
  // parseServerTime, not `new Date()`: a naive SQLite timestamp is UTC but
  // carries no marker, so the plain constructor reads it as local time and
  // lands hours in the future. That made `bumped` (a client-side Date.now())
  // permanently unable to win, which is exactly how "Mark as Unread" stopped
  // bumping. See utils/serverTime.js.
  const natural = parseServerTime(output.updated_at || output.created_at);
  const bumped = bumps[output.id] || 0;
  return Math.max(natural, bumped);
}

/**
 * Order outputs for the sidebar. Pure: returns a new array.
 *
 * @param {Array}    list        outputs to sort
 * @param {string}   sortKey     'updated_at' | 'created_at' | 'content' | any field
 * @param {string}   sortOrder   'asc' | 'desc'
 * @param {Object}   bumps       { [outputId]: epochMs } client-side activity
 * @param {Function} previewOf   (output) => string, used for the 'content' sort
 */
export function sortOutputs(list, { sortKey = 'updated_at', sortOrder = 'desc', bumps = {}, previewOf } = {}) {
  // 'attention' is a SEMANTIC order, not a directional one: unread first,
  // newest at the top, then everything else by recency. Surfaced in the UI
  // as the "Unread" sort mode.
  //
  // This order is what lets the panel have no separate unread section. There
  // was once a pinned "Needs you" card above the groups holding exactly the
  // rows this comparator already lifts to the top — the same conversation
  // rendered twice, a few pixels apart. The sort makes the card redundant, so
  // the card is gone and this is the single place the ordering lives.
  //
  // sortOrder is deliberately ignored here — "unread, backwards" is not a
  // thing a user wants; the one meaningful axis (unread above read) has no
  // useful reverse.
  //
  // BOTH partitions are newest-first — one direction, like an inbox. The
  // unread partition was briefly longest-waiting-first; Nathan reversed it:
  // the newest thing is what you are most likely to want next, and the
  // partition split already guarantees the oldest unread cannot be buried
  // under read rows — it is at worst a short scroll down a group of dots.
  //
  // Bumps apply only to the read partition. Inside the unread partition the
  // measure is updated_at alone — the same one triageRail() uses, so the
  // Unread count/clear-all badge and the list top agree on the same rows.
  //
  // A manual "Mark as Unread" MOVES updated_at server-side (queueing a
  // conversation is activity — see ContentOutputModel.setReadState), so it
  // needs no client-side bump to hold its place. It lands at "now", which
  // under newest-first puts a freshly queued conversation at the VERY TOP
  // of the list — and reading it later re-dates it again (unread→read
  // transition), so it stays the top row of the read partition instead of
  // dropping back to wherever its original date happened to fall.
  if (sortKey === 'attention') {
    return [...list].sort((a, b) => {
      const aUnread = isUnread(a);
      const bUnread = isUnread(b);
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      if (aUnread) return activityTime(b) - activityTime(a);
      return activityTime(b, bumps) - activityTime(a, bumps);
    });
  }

  const dir = sortOrder === 'asc' ? 1 : -1;
  const isTimeSort = sortKey === 'updated_at' || sortKey === 'created_at';

  return [...list].sort((a, b) => {
    let aValue;
    let bValue;

    if (isTimeSort) {
      aValue = activityTime(a, bumps);
      bValue = activityTime(b, bumps);
    } else if (sortKey === 'content') {
      aValue = previewOf ? previewOf(a) : '';
      bValue = previewOf ? previewOf(b) : '';
    } else {
      aValue = a[sortKey];
      bValue = b[sortKey];
    }

    if (aValue < bValue) return -dir;
    if (aValue > bValue) return dir;
    return 0; // Array#sort is stable (ES2019), so ties keep their input order.
  });
}
