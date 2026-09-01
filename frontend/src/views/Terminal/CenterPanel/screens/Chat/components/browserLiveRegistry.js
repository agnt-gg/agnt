import { ref } from 'vue';

/**
 * Which browser tool-call card owns the live stream.
 *
 * WHY ONLY ONE CARD STREAMS
 * -------------------------
 * A conversation accumulates browser steps, and every one of them renders a
 * card. If each card subscribed, a single browsing turn would leave a dozen
 * live screencasts in the transcript — all showing the same browser, all
 * holding a viewer ref-count, all decoding JPEGs. Scrolled-off cards would
 * keep painting into detached canvases.
 *
 * The flow control makes that MORE confusing rather than less: frames are
 * acked on paint, so an offscreen card stalls its own stream instead of
 * failing, and the user sees several cards frozen at different moments of the
 * same session with nothing marking which one is current.
 *
 * So the newest card owns the stream and the rest say so.
 *
 * ORDERED, NOT MOUNT-ORDERED
 * --------------------------
 * Claims carry an explicit order rather than relying on mount sequence,
 * because a virtualised transcript re-mounts old cards as the user scrolls.
 * With mount order, scrolling up would hand the stream to a card from ten
 * minutes ago; with claim order, an older card cannot take it.
 */

/** The key of the card currently entitled to stream, or null. */
const activeKey = ref(null);

/**
 * The order that key was claimed with.
 *
 * Deliberately NOT a ref: nothing renders from it, and making it reactive
 * would re-run every card's computed on each claim for no visible difference.
 */
let activeOrder = -Infinity;

/**
 * Claim the live view for a card.
 *
 * @param {string} key   Stable identity for the card.
 * @param {number} order Monotonic within a conversation; higher is newer.
 * @returns {boolean} Whether this card now owns the stream.
 */
export function claimLiveView(key, order) {
  if (!key) return false;
  if (activeKey.value !== null && order < activeOrder) return false;
  activeOrder = order;
  activeKey.value = key;
  return true;
}

/**
 * Give the live view up, if this card holds it.
 *
 * Resetting the order as well as the key matters when the user switches
 * conversations: every card unmounts, and the next conversation's cards may
 * legitimately carry LOWER orders than the ones just torn down. Keeping the
 * old high-water mark would mean nothing could ever claim again.
 */
export function releaseLiveView(key) {
  if (activeKey.value !== key) return;
  activeKey.value = null;
  activeOrder = -Infinity;
}

/** Reactive: does this card own the stream right now? */
export function ownsLiveView(key) {
  return activeKey.value !== null && activeKey.value === key;
}

export { activeKey as activeLiveKey };

/** Test seam. */
export function _resetLiveRegistry() {
  activeKey.value = null;
  activeOrder = -Infinity;
}
