/**
 * scrollAnchor — the pure arithmetic behind "put the viewport back where I left it".
 *
 * WHY A PIXEL IS NOT ENOUGH
 * ------------------------
 * Saving `scrollTop` and writing it back is the obvious implementation and it
 * is wrong here, because four independent mechanisms change the height of the
 * transcript between the moment we measure and the moment we restore:
 *
 *   1. Windowed rendering. Only the most recent N messages mount on open. A
 *      pixel measured against 130 mounted messages is meaningless against 30.
 *   2. Content settles asynchronously. Markdown parse, sanitize, MathJax
 *      typeset and image decode all land over the hundreds of milliseconds
 *      AFTER mount, so the document grows under a restored pixel.
 *   3. Tool-call expansion state is component-local and reset on switch, so
 *      the same messages can occupy wildly different heights.
 *   4. The container reflows on width change (panel resize, fullscreen).
 *
 * So we store INTENT, not coordinates: which message was at the top of the
 * viewport, and how far into it we were. That survives all four.
 *
 * WHY `atBottom` IS ITS OWN STATE
 * -------------------------------
 * "At the bottom" is the common case and the one that must not degrade. If we
 * restored it as a pixel we would land a few pixels short of the true bottom,
 * which disarms the near-bottom autoscroll that makes live streaming follow
 * the response. Recording the INTENT lets the restore land exactly on the
 * bottom and leave that behaviour armed.
 *
 * WHY THIS FILE IS PURE
 * ---------------------
 * jsdom reports 0 for every layout property, so nothing that reads the DOM can
 * be meaningfully tested. All the decisions therefore live here, over plain
 * measured numbers, and the DOM adapter in useChatScrollRestore.js does
 * nothing but measure and apply.
 */

/** Attribute the transcript stamps on each message wrapper. */
export const ANCHOR_ATTR = 'data-message-id';

/**
 * Distance from the bottom, in px, still considered "at the bottom". Matches
 * the autoscroll threshold in Chat.vue / UnifiedChatContainer: if we called a
 * position "not bottom" that autoscroll considers "bottom", restoring it would
 * immediately be overridden by the next streamed chunk.
 */
export const BOTTOM_THRESHOLD = 150;

/**
 * Is this scroll position at the bottom of its container?
 * A container that cannot scroll is trivially at the bottom.
 */
export function isAtBottom(scrollTop, scrollHeight, clientHeight, threshold = BOTTOM_THRESHOLD) {
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite)) return true;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * Choose the message that the viewport is currently anchored to: the FIRST one
 * whose bottom edge is still below the top of the viewport — i.e. the topmost
 * visible message, including one scrolled halfway off the top.
 *
 * `items` are `{ id, top, height }` in the scroll container's CONTENT
 * coordinate space (0 = the very top of the transcript, not of the viewport).
 *
 * @returns {{anchorId: string, anchorOffset: number}|null} null when there is
 *   nothing to anchor to. anchorOffset is how far INTO the anchor the viewport
 *   top sits, so restoring means `scrollTop = anchor.top + anchorOffset`.
 */
export function pickAnchor(items, viewportTop) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const top = Number.isFinite(viewportTop) ? viewportTop : 0;

  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue;
    const itemTop = Number.isFinite(item.top) ? item.top : 0;
    const itemHeight = Number.isFinite(item.height) ? item.height : 0;
    if (itemTop + itemHeight > top) {
      return { anchorId: item.id, anchorOffset: top - itemTop };
    }
  }

  // Scrolled past everything (trailing non-message content, e.g. the
  // processing indicator). Anchor to the last real message.
  const last = [...items].reverse().find((i) => i && typeof i.id === 'string');
  if (!last) return null;
  return { anchorId: last.id, anchorOffset: top - (Number.isFinite(last.top) ? last.top : 0) };
}

/**
 * The scrollTop that reproduces a saved position against the CURRENT layout.
 *
 * Every failure mode resolves to the BOTTOM, never the top. A conversation
 * whose anchor has been deleted (edit-and-resend truncates the tail) or whose
 * entry is missing/corrupt should open where a chat naturally opens. Landing
 * the user on message 1 of 200 is the exact papercut this module exists to
 * remove, so it must not be the fallback.
 */
export function resolveScrollTarget({ items, anchorId, anchorOffset, atBottom, scrollHeight, clientHeight }) {
  const height = Number.isFinite(scrollHeight) ? scrollHeight : 0;
  const client = Number.isFinite(clientHeight) ? clientHeight : 0;
  const max = Math.max(0, height - client);

  if (atBottom !== false) return max;
  if (typeof anchorId !== 'string' || !anchorId) return max;
  if (!Array.isArray(items)) return max;

  const item = items.find((i) => i && i.id === anchorId);
  if (!item) return max;

  const offset = Number.isFinite(anchorOffset) ? anchorOffset : 0;
  const target = (Number.isFinite(item.top) ? item.top : 0) + offset;
  return Math.min(max, Math.max(0, target));
}

export default { ANCHOR_ATTR, BOTTOM_THRESHOLD, isAtBottom, pickAnchor, resolveScrollTarget };
