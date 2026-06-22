/**
 * withFreshness — wrap a Vuex action so the second call within `staleAfter`
 * is a no-op that returns the previously-resolved value.
 *
 * Three properties:
 *   1. Per-action TTL (skip the network entirely while data is "fresh enough")
 *   2. In-flight de-duplication (two callers in the same tick share one HTTP
 *      request, both await the same promise)
 *   3. Explicit `forceRefresh: true` opt-out for save-then-reload flows
 *
 * Usage:
 *   import { withFreshness } from '../_utils/withFreshness.js';
 *   import { TTL } from '../_utils/freshnessConfig.js';
 *
 *   actions: {
 *     fetchAgents: withFreshness('agents.fetchAgents', async ({ commit }) => {
 *       const res = await axios.get(...);
 *       commit('SET_AGENTS', res.data);
 *       return res.data;
 *     }, { staleAfter: TTL.agents }),
 *   }
 *
 * Bypass: dispatch('agents/fetchAgents', { forceRefresh: true })
 *
 * Notes:
 *   - Each wrapped action carries its own closure-local cache. There is no
 *     shared global cache, so module reloads / hot-reloads start fresh.
 *   - Errors do not poison the cache: a failed fetch leaves `lastFetched`
 *     unchanged, so the next call retries.
 *   - In dev, every wrapper bumps `window.__AGNT_FETCH_STATS__` counters so
 *     you can `console.table(window.__AGNT_FETCH_STATS__.perKey)` to see
 *     hits / misses / dedupes per action during a session.
 */

const DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
if (DEV && typeof window !== 'undefined' && !window.__AGNT_FETCH_STATS__) {
  window.__AGNT_FETCH_STATS__ = { hits: 0, misses: 0, dedupes: 0, perKey: {} };
}

function bump(key, kind) {
  if (!DEV || typeof window === 'undefined') return;
  const stats = window.__AGNT_FETCH_STATS__;
  if (!stats) return;
  stats[kind]++;
  const k = (stats.perKey[key] = stats.perKey[key] || { hits: 0, misses: 0, dedupes: 0 });
  k[kind]++;
}

export const DEFAULT_STALE_AFTER = 5 * 60 * 1000; // 5 minutes

export function withFreshness(key, fn, { staleAfter = DEFAULT_STALE_AFTER } = {}) {
  let lastFetched = 0;
  let lastResult;
  let inFlight = null;

  return async function freshnessWrapped(ctx, payload, ...rest) {
    const force =
      payload && typeof payload === 'object' && payload.forceRefresh === true;
    const now = Date.now();

    // Cache hit — fresh and not forced
    if (!force && lastFetched && now - lastFetched < staleAfter) {
      bump(key, 'hits');
      return lastResult;
    }

    // Coalesce concurrent callers onto one in-flight promise.
    // Exception: a force call must NOT ride a pre-existing in-flight that
    // started before the caller's mutation completed — that in-flight will
    // return stale (pre-mutation) data and stomp the UI back to old values
    // after a save. Force always starts its own fetch.
    if (inFlight && !force) {
      bump(key, 'dedupes');
      return inFlight;
    }

    bump(key, 'misses');
    const fetchPromise = (async () => {
      try {
        const result = await fn(ctx, payload, ...rest);
        lastResult = result;
        lastFetched = Date.now();
        return result;
      } finally {
        // Only clear inFlight if WE'RE still the registered promise. With
        // force bypassing dedup, two fetches can run concurrently — without
        // this guard, the first to finish would null out the tracker for
        // the second, letting unrelated callers race instead of dedupe.
        if (inFlight === fetchPromise) inFlight = null;
      }
    })();
    inFlight = fetchPromise;
    return fetchPromise;
  };
}
