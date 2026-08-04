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
  // longest-waiting at the top, then everything else by recency. It is the
  // triage rail's invariant applied to the whole list, which is the only
  // reason the rail can be a view of the list rather than a special case.
  //
  // sortOrder is deliberately ignored here — "needs you, backwards" is not a
  // thing a user wants, and offering it would only produce an ordering that
  // buries the oldest waiting conversation, which is the exact failure this
  // whole feature exists to prevent.
  //
  // Bumps apply only to the read partition. A manual "Mark as Unread" writes
  // nothing server-side, so inside the unread partition the honest measure of
  // "how long has this been waiting" is updated_at alone — the same measure
  // triageRail() uses, so rail and list agree on the order of the same rows.
  if (sortKey === 'attention') {
    return [...list].sort((a, b) => {
      const aUnread = isUnread(a);
      const bUnread = isUnread(b);
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      if (aUnread) return activityTime(a) - activityTime(b);
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
