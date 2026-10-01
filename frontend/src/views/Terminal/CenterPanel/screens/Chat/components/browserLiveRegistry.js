import { ref, computed } from 'vue';

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
 *
 * ONE OWNER PER CONVERSATION, NOT PER APP
 * ---------------------------------------
 * Each conversation drives its own browser tab (backend browserLanes.js), so
 * the "one card" rule is per conversation: two chats on screen at once (a
 * workspace with two chat windows, a split view) each stream their OWN tab.
 * A single app-wide owner would leave one of them blank, or worse, let one
 * conversation's card take the stream the other is watching.
 */

/** key -> { order, group }, for every card currently mounted. */
const mounted = new Map();

/** group (conversation) -> the key entitled to stream it right now. */
const owners = ref({});

function recomputeOwners() {
  const best = {};
  for (const [key, { order, group }] of mounted) {
    if (!(group in best) || order > best[group].order) best[group] = { key, order };
  }
  const next = {};
  for (const [group, { key }] of Object.entries(best)) next[group] = key;
  owners.value = next;
}

/**
 * Register a mounted card.
 *
 * @param {string} key    Stable identity for the card.
 * @param {number} order  Monotonic within a conversation; higher is newer.
 * @param {string} [group] The conversation the card belongs to. Cards with
 *   no conversation share one default group, as before.
 * @returns {boolean} Whether this card now owns its conversation's stream.
 */
export function claimLiveView(key, order, group = '') {
  if (!key) return false;
  mounted.set(key, { order: Number.isFinite(order) ? order : 0, group: group || '' });
  recomputeOwners();
  return ownsLiveView(key);
}

/**
 * Deregister a card as it unmounts.
 *
 * If it was the owner, the next-highest mounted card of the same
 * conversation takes over — which is what makes the live view survive a
 * virtualised transcript reclaiming rows.
 */
export function releaseLiveView(key) {
  if (!mounted.delete(key)) return;
  recomputeOwners();
}

/** Reactive: does this card own its conversation's stream right now? */
export function ownsLiveView(key) {
  // Read the reactive owners FIRST, unconditionally. A card's computed runs
  // before its own onMounted claim; returning early on "not mounted yet"
  // without touching owners.value left that computed with no dependency, so
  // it never re-ran and the card stayed invisible after claiming.
  const current = owners.value;
  if (!key) return false;
  return Object.values(current).includes(key);
}

/** The owner of the default (no-conversation) group. Kept for callers that predate groups. */
export const activeLiveKey = computed(() => owners.value[''] ?? null);

/** Test seam. */
export function _resetLiveRegistry() {
  mounted.clear();
  owners.value = {};
}
