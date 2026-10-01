/**
 * stickToBottom — the decisions behind "follow the stream until I scroll away".
 *
 * WHY FOLLOWING IS A STATE, NOT A DISTANCE
 * ----------------------------------------
 * The chats used to re-ask on every streamed token: "is the viewport within
 * 150px of the bottom? then snap it there". A deliberate scroll up of less
 * than 150px between two tokens was simply undone, so leaving the bottom of a
 * live stream meant out-scrolling the token rate. Intent cannot be read off a
 * single position; it has to be remembered. So following is a boolean that
 * changes only on events:
 *
 *   - released by ANY upward intent — a wheel notch, a touch drag, a key,
 *     grabbing the scrollbar, selecting text, or the viewport moving up off
 *     the bottom for any reason the stream itself did not cause;
 *   - re-engaged by returning to the bottom, the scroll-to-bottom control,
 *     or sending a message.
 *
 * While following, content growth pins the viewport to the bottom instantly.
 * Nothing here animates: a smooth pin chasing a growing document is itself a
 * scroll the user has to fight.
 *
 * WHY THIS FILE IS PURE
 * ---------------------
 * jsdom reports 0 for every layout property, so the rules live here over plain
 * numbers and composables/useStickToBottom.js only measures and applies.
 */

/** Within this many px of the bottom, moving down re-engages following. */
export const FOLLOW_THRESHOLD = 8;

/**
 * A viewport that moved UP but still sits within this many px of the bottom
 * was clamped by the browser (content shrank under it) — not scrolled by the
 * user. Sub-pixel scrollTop at fractional zoom needs the slack.
 */
export const CLAMP_EPSILON = 1;

/** Finger travel, in px, before a touch drag counts as a scroll. */
export const TOUCH_SLOP = 4;

/** Distance from the viewport's bottom edge to the end of the content. */
export function distanceFromBottom(scrollTop, scrollHeight, clientHeight) {
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite)) return 0;
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

/**
 * Next following state after a `scroll` event.
 *
 * This is the backstop that catches every upward movement the input listeners
 * cannot see (keyboard paging, middle-click autoscroll, momentum, programmatic
 * scrolls by other components). It never needs to know who scrolled: the pin
 * only ever moves down, so any upward move away from the bottom is a release.
 */
export function followAfterScroll(following, { prevTop, scrollTop, scrollHeight, clientHeight }) {
  const distance = distanceFromBottom(scrollTop, scrollHeight, clientHeight);
  const movedUp = Number.isFinite(prevTop) && scrollTop < prevTop - 0.5;
  if (movedUp) return distance > CLAMP_EPSILON ? false : following;
  return distance <= FOLLOW_THRESHOLD ? true : following;
}

/** A wheel event that scrolls content up. Ctrl+wheel is zoom, not scroll. */
export function isUpwardWheel({ deltaY, ctrlKey } = {}) {
  return !ctrlKey && Number.isFinite(deltaY) && deltaY < 0;
}

/** Finger dragged DOWN the screen, which scrolls the content up. */
export function isUpwardTouch(startY, currentY) {
  return Number.isFinite(startY) && Number.isFinite(currentY) && currentY - startY > TOUCH_SLOP;
}

/** A pointer press landing in the scroll container's own vertical scrollbar gutter. */
export function isScrollbarPress(offsetX, clientWidth) {
  return Number.isFinite(offsetX) && Number.isFinite(clientWidth) && clientWidth > 0 && offsetX >= clientWidth;
}

export default {
  FOLLOW_THRESHOLD,
  CLAMP_EPSILON,
  TOUCH_SLOP,
  distanceFromBottom,
  followAfterScroll,
  isUpwardWheel,
  isUpwardTouch,
  isScrollbarPress,
};
