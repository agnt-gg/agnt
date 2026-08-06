/**
 * Give a Vuex module a reset that is DERIVED from its own initial state.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * Logout used to clear four stores by name:
 *
 *     commit('agents/CLEAR_AGENTS',       null, { root: true });
 *     commit('workflows/CLEAR_WORKFLOWS', null, { root: true });
 *     commit('tools/CLEAR_TOOLS',         null, { root: true });
 *     commit('goals/CLEAR_GOALS',         null, { root: true });
 *
 * `initializeStore` fills twelve. The other eight kept the previous user's
 * data — and, worse, kept a `lastFetched` timestamp that made their fetch
 * short-circuit for the NEXT user, so signing in as someone else showed the
 * previous account's groups until the cache happened to age out.
 *
 * A hand-written clear also drifts silently: it enumerates the fields that
 * existed the day it was written, and every field added later is quietly not
 * cleared. `groups.activeGroupId` and `contentOutputs.hasLoadedAll` are exactly
 * that shape of leftover.
 *
 * So the reset is not written by hand. It is captured from the module's own
 * declared initial state, at module load, before any mutation can have run —
 * which means it is correct by construction today and stays correct as the
 * module grows.
 *
 * Usage:
 *   export default withUserScopedReset({ namespaced: true, state: {...}, ... });
 *
 * The module gains `RESET_USER_SCOPED_STATE`. `resetUserScopedData` in
 * store/state.js calls it for every user-scoped module, and
 * store/sessionReset.spec.js fails if a module `initializeStore` loads is
 * missing from that list.
 */

/**
 * Deep clone of plain data.
 *
 * Not structuredClone: it is absent in some of the runtimes this bundle
 * targets and it throws on functions, which a few modules park in state. Not
 * JSON round-trip either — that silently turns `undefined` into a missing key
 * and a Date into a string, so a reset would hand back a subtly different
 * shape from the one the module declared.
 *
 * Anything not a plain object/array/Map/Set is returned by reference. That is
 * correct for the primitives and frozen constants modules actually declare
 * (e.g. `categories: [...]` string arrays are cloned; a Vue component
 * reference would be shared, which is what you want).
 */
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, clone(v)]));
  if (value instanceof Set) return new Set([...value].map(clone));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

export const RESET_MUTATION = 'RESET_USER_SCOPED_STATE';

export function withUserScopedReset(module) {
  // `state` may be an object literal or a factory. contentOutputs uses a
  // factory precisely because a shared literal leaked between stores in tests;
  // calling it here gives us a pristine reference either way.
  const initial = typeof module.state === 'function' ? module.state() : module.state;
  const snapshot = clone(initial);

  return {
    ...module,
    mutations: {
      ...module.mutations,
      [RESET_MUTATION](state) {
        // Assign onto the EXISTING object rather than replacing it: Vuex hands
        // out a reactive proxy that components already hold references to.
        Object.assign(state, clone(snapshot));
      },
    },
  };
}
