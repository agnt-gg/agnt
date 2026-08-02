import { ref, computed } from 'vue';

/**
 * One async fact, with "not measured yet" as a first-class state.
 *
 * The bug this exists to make unrepresentable: a panel declares
 * `const enabled = ref(false)` and renders "you are NOT on the network"
 * before the fetch that would have said otherwise has landed. `false` is not
 * "unknown" — it is a claim, and the template believes it. Every settings
 * panel that fetches on mount can produce that flash of confidently-wrong UI.
 *
 * Here `data` is `null` until something is actually known, so a consumer
 * cannot read a field it has not measured, and `ready` is the single gate for
 * anything that asserts a negative.
 *
 * Also: a resource survives unmount. Settings sections are a plain `v-if`
 * chain, so leaving and re-entering a tab destroys and rebuilds the component
 * — without a cache the user pays the skeleton on every single visit. With
 * one, the second visit paints last-known-good immediately and revalidates
 * behind it (stale-while-revalidate).
 */

/** @type {Map<string, object>} keyed by `cacheKey`, survives unmount by design. */
const cache = new Map();

/**
 * @param {() => Promise<object>} fetcher Resolves to the resource. Normalise
 *   response shapes in here so consumers see exactly one shape.
 * @param {{ cacheKey?: string }} [options]
 */
export function useAsyncResource(fetcher, options = {}) {
  const { cacheKey = null } = options;

  const seed = cacheKey && cache.has(cacheKey) ? { ...cache.get(cacheKey) } : null;

  const data = ref(seed);
  const error = ref('');

  /** True once — and only once — a real value has been observed. */
  const ready = computed(() => data.value !== null);
  const state = computed(() => {
    if (ready.value) return 'ready';
    return error.value ? 'error' : 'loading';
  });

  // Guards against an in-flight response from an earlier refresh() landing
  // after a later one and reinstating stale data.
  let sequence = 0;

  /**
   * @param {{ onError?: (e: unknown) => string }} [handlers] Maps a thrown
   *   error to the message to display. Returning '' suppresses it.
   * @returns {Promise<object|null>} the new data, or null if the call failed.
   */
  async function refresh(handlers = {}) {
    const ticket = ++sequence;
    try {
      const next = await fetcher();
      if (ticket !== sequence) return null; // superseded
      data.value = next;
      error.value = '';
      if (cacheKey) cache.set(cacheKey, { ...next });
      return next;
    } catch (e) {
      if (ticket !== sequence) return null;
      // Deliberately keeps the last good value: a failed poll should surface
      // an error, not blank a panel that was working a second ago.
      error.value = handlers.onError ? handlers.onError(e) : (e?.message || 'Something went wrong.');
      return null;
    }
  }

  /**
   * Merge a locally-known change (e.g. the response to a toggle) without a
   * round trip.
   *
   * No-ops while unmeasured, on purpose: patching `null` would fabricate a
   * mostly-undefined resource and flip `ready` to true — reintroducing the
   * exact "assert without measuring" bug this module exists to prevent. It is
   * unreachable in practice because nothing is interactive before `ready`.
   */
  function patch(partial) {
    if (!ready.value) return;
    data.value = { ...data.value, ...partial };
    if (cacheKey) cache.set(cacheKey, { ...data.value });
  }

  return { data, error, ready, state, refresh, patch };
}

/** Test seam. Production code has no reason to call this. */
export function clearAsyncResourceCache(key) {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}
