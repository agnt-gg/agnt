/**
 * withFreshness — wrap a Vuex action so the second call within `staleAfter`
 * is a no-op that returns the previously-resolved value.
 *
 * Four properties:
 *   1. Per-action TTL (skip the network entirely while data is "fresh enough")
 *   2. In-flight de-duplication (two callers in the same tick share one HTTP
 *      request, both await the same promise)
 *   3. Explicit `forceRefresh: true` opt-out for save-then-reload flows
 *   4. Optional `identity(ctx)` scoping — a TTL answers "is this data old?",
 *      which is the wrong question for anything fetched *on behalf of a
 *      subject*. Logging in, logging out, or switching accounts changes WHO
 *      the cached value describes, and a value describing someone else is not
 *      fresh at any age. When `identity` is supplied, a changed identity is a
 *      cache MISS regardless of TTL.
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
 * Identity-scoped usage:
 *   validateLicense: withFreshness('userAuth.validateLicense', fn, {
 *     staleAfter: TTL.userAuthValidateLicense,
 *     identity: (ctx) => authSubject(ctx.state.token),
 *   })
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
  window.__AGNT_FETCH_STATS__ = { hits: 0, misses: 0, dedupes: 0, identityMisses: 0, perKey: {} };
}

function bump(key, kind) {
  if (!DEV || typeof window === 'undefined') return;
  const stats = window.__AGNT_FETCH_STATS__;
  if (!stats) return;
  const k = (stats.perKey[key] = stats.perKey[key] || { hits: 0, misses: 0, dedupes: 0, identityMisses: 0 });
  stats[kind] = (stats[kind] || 0) + 1;
  k[kind] = (k[kind] || 0) + 1;
}

export const DEFAULT_STALE_AFTER = 5 * 60 * 1000; // 5 minutes

export function withFreshness(key, fn, { staleAfter = DEFAULT_STALE_AFTER, identity = null } = {}) {
  let lastFetched = 0;
  let lastResult;
  let lastIdentity;
  let inFlight = null;
  let inFlightIdentity;

  return async function freshnessWrapped(ctx, payload, ...rest) {
    const force =
      payload && typeof payload === 'object' && payload.forceRefresh === true;
    const now = Date.now();

    // Whose data is this? An identity change invalidates the cache outright:
    // the previous result describes a different subject, so its age is
    // irrelevant. Resolved defensively — a throwing identity fn must not be
    // able to break the fetch it is only meant to scope.
    let currentIdentity;
    if (identity) {
      try {
        currentIdentity = identity(ctx);
      } catch {
        // Unknown identity: fall through to a miss rather than serve a value
        // that may belong to someone else.
        currentIdentity = Symbol('unresolved-identity');
      }
    }
    const identityChanged = !!identity && lastFetched > 0 && currentIdentity !== lastIdentity;
    if (identityChanged) bump(key, 'identityMisses');

    // Cache hit — fresh, same subject, not forced
    if (!force && !identityChanged && lastFetched && now - lastFetched < staleAfter) {
      bump(key, 'hits');
      return lastResult;
    }

    // A request already on the wire carries the credentials of whoever was
    // logged in when it was ISSUED. A caller who has since become a different
    // subject must not adopt its answer — that is the same mistake as reading
    // the TTL cache across a login, just inside a narrower window.
    const inFlightIsForSomeoneElse = !!identity && inFlight != null && currentIdentity !== inFlightIdentity;

    // Coalesce concurrent callers onto one in-flight promise.
    // Exception: a force call must NOT ride a pre-existing in-flight that
    // started before the caller's mutation completed — that in-flight will
    // return stale (pre-mutation) data and stomp the UI back to old values
    // after a save. Force always starts its own fetch.
    if (inFlight && !force && !identityChanged && !inFlightIsForSomeoneElse) {
      bump(key, 'dedupes');
      return inFlight;
    }

    bump(key, 'misses');
    // Capture the subject at ISSUE time, not completion time. The request goes
    // out with the credentials that exist now, so the response describes THIS
    // subject no matter who is logged in by the time it lands. Stamping the
    // post-await value would label an anonymous response as the freshly
    // logged-in user's — which is precisely the defect this option exists to
    // prevent, reintroduced one layer down.
    const fetchIdentity = currentIdentity;
    const fetchPromise = (async () => {
      try {
        const result = await fn(ctx, payload, ...rest);
        lastResult = result;
        lastFetched = Date.now();
        lastIdentity = fetchIdentity;
        return result;
      } finally {
        // Only clear inFlight if WE'RE still the registered promise. With
        // force bypassing dedup, two fetches can run concurrently — without
        // this guard, the first to finish would null out the tracker for
        // the second, letting unrelated callers race instead of dedupe.
        if (inFlight === fetchPromise) {
          inFlight = null;
          inFlightIdentity = undefined;
        }
      }
    })();
    inFlight = fetchPromise;
    inFlightIdentity = fetchIdentity;
    return fetchPromise;
  };
}
