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
 *   5. Optional `isCacheable(result)` — lets an action say "I answered, but
 *      with a DEGRADED result; do not freeze it." See the note on errors
 *      below for why resolving successfully is not the same as succeeding.
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
 *
 *     That guarantee only covers errors THIS WRAPPER SEES. An action that
 *     catches its own failure and returns a fallback has, as far as the
 *     wrapper can tell, succeeded — so the fallback is stamped fresh and
 *     served for the whole TTL. Two provider actions did exactly that, and a
 *     single failed call at sign-in hid every connected integration until the
 *     user reloaded the page. `isCacheable` is how such an action declines
 *     the stamp without having to throw at callers that do not expect it.
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

/**
 * Every live wrapper, so a session end can clear all of them at once.
 *
 * ---------------------------------------------------------------------------
 * WHY A REGISTRY IS NECESSARY
 * ---------------------------------------------------------------------------
 * This wrapper caches an action's RETURN VALUE and, on a hit, does not call
 * the action at all. But almost every action here does its real work in a
 * `commit` — the return value is incidental. So a cache hit means the commit
 * DOES NOT HAPPEN.
 *
 * That is fine while the store and the cache agree. `resetUserScopedData`
 * breaks the agreement: it wipes the module state on logout and leaves these
 * closures untouched. Sign in again AS THE SAME USER and the identity is
 * unchanged, the TTL has not elapsed, so the next call is a hit — the commit
 * never runs and the store stays empty.
 *
 * That is exactly how a fresh sign-in came to show an empty provider list
 * while `connectedApps` was fully populated: `fetchAllProviders` has a THIRTY
 * MINUTE TTL, so `allProviders` stayed `[]` and the screen mapped over
 * nothing. Reloading the page appeared to fix it only because a module reload
 * discards these closures.
 *
 * The identity option cannot cover this. It answers "is this someone else's
 * data?", and signing back into the same account correctly answers no. The
 * question here is different: "does the store still hold what this cache says
 * it delivered?"
 *
 * So cache lifetime is tied to store lifetime. Whoever empties the store
 * empties these too.
 */
const liveCaches = new Set();

/**
 * Forget every cached result, everywhere.
 *
 * Called when user-scoped state is reset. Deliberately blunt: a wrapper whose
 * store module was not reset simply re-fetches once, which costs a request.
 * The alternative — tracking which wrapper belongs to which module — is a
 * second mapping to keep in step with the first, and getting it wrong brings
 * back a blank screen that only a reload fixes.
 */
export function invalidateAllFreshness() {
  for (const forget of liveCaches) forget();
}

export function withFreshness(
  key,
  fn,
  { staleAfter = DEFAULT_STALE_AFTER, identity = null, isCacheable = null } = {},
) {
  let lastFetched = 0;
  let lastResult;
  let lastIdentity;
  let inFlight = null;
  let inFlightIdentity;

  // Only the CACHE is dropped, never an in-flight request. A request already
  // on the wire still has a caller awaiting it, and rejecting or orphaning it
  // would turn a stale screen into a broken one. It simply will not be cached:
  // its `fetchIdentity` no longer matches anything a later hit can serve.
  liveCaches.add(() => {
    lastFetched = 0;
    lastResult = undefined;
    lastIdentity = undefined;
  });

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

        // A result the action itself calls degraded is not written to the
        // cache at all — not the value, not the timestamp, not the subject.
        // Leaving `lastFetched` at its previous value is what makes the next
        // caller retry, which is the same mechanism a thrown error relies on.
        //
        // Only an explicit `true` caches. A predicate that throws, or returns
        // something that merely looks truthy, falls through to "do not cache":
        // re-fetching costs a request, while wrongly freezing a bad answer
        // costs the user a broken screen until they reload.
        let cacheable = true;
        if (isCacheable) {
          try {
            cacheable = isCacheable(result) === true;
          } catch {
            cacheable = false;
          }
        }

        if (cacheable) {
          lastResult = result;
          lastFetched = Date.now();
          lastIdentity = fetchIdentity;
        }
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
