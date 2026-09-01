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
 * So exactly one card streams, and — see BrowserLiveCard — the others render
 * nothing whatsoever.
 *
 * THE OWNER IS DERIVED, NOT AWARDED
 * ---------------------------------
 * Every mounted card is registered with its order, and the owner is simply the
 * highest one currently mounted. The first version awarded ownership on claim
 * and kept a high-water mark, which had two failures: an owner that scrolled
 * out of a virtualised transcript took the live view with it and nothing could
 * take over, and switching conversations left a stale mark that refused every
 * card in the next one. Deriving it makes both cases fall out for free — a
 * card leaving simply means the next-highest mounted card is now the newest.
 */

/** key -> order, for every card currently mounted. */
const mounted = new Map();

/** The key entitled to stream right now, or null. */
const activeKey = ref(null);

function recomputeOwner() {
  let bestKey = null;
  let bestOrder = -Infinity;
  for (const [key, order] of mounted) {
    if (order > bestOrder) {
      bestOrder = order;
      bestKey = key;
    }
  }
  activeKey.value = bestKey;
}

/**
 * Register a mounted card.
 *
 * @param {string} key   Stable identity for the card.
 * @param {number} order Monotonic within a conversation; higher is newer.
 * @returns {boolean} Whether this card now owns the stream.
 */
export function claimLiveView(key, order) {
  if (!key) return false;
  mounted.set(key, Number.isFinite(order) ? order : 0);
  recomputeOwner();
  return activeKey.value === key;
}

/**
 * Deregister a card as it unmounts.
 *
 * If it was the owner, the next-highest mounted card takes over — which is
 * what makes the live view survive a virtualised transcript reclaiming rows.
 */
export function releaseLiveView(key) {
  if (!mounted.delete(key)) return;
  recomputeOwner();
}

/** Reactive: does this card own the stream right now? */
export function ownsLiveView(key) {
  return activeKey.value !== null && activeKey.value === key;
}

export { activeKey as activeLiveKey };

/** Test seam. */
export function _resetLiveRegistry() {
  mounted.clear();
  activeKey.value = null;
}
