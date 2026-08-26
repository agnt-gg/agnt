/**
 * withFreshness: the cacheability contract.
 *
 * The wrapper documents "errors do not poison the cache", and that was true of
 * every error it could SEE. An action that catches its own failure and returns
 * a fallback has, from here, succeeded — so the fallback was stamped fresh and
 * served for the whole TTL. Two provider actions did exactly that, and one
 * failed call around sign-in hid every connected integration until the user
 * reloaded the page.
 *
 * `isCacheable` is how an action declines that stamp without throwing at
 * callers which do not expect it. These tests pin the decline, and equally
 * pin that a good result is still cached — a wrapper that never caches is
 * just as broken as one that caches the wrong thing.
 */

import { describe, it, expect, vi } from 'vitest';
import { withFreshness, invalidateAllFreshness } from './withFreshness.js';

const ctx = {};
const authoritative = { authoritative: true };
const degraded = { authoritative: false };

describe('isCacheable', () => {
  it('caches a result the action vouches for', async () => {
    const fn = vi.fn(async () => authoritative);
    const action = withFreshness('t.good', fn, {
      staleAfter: 60000,
      isCacheable: (r) => r?.authoritative === true,
    });

    await action(ctx);
    await action(ctx);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a result the action calls degraded', async () => {
    const fn = vi.fn(async () => degraded);
    const action = withFreshness('t.degraded', fn, {
      staleAfter: 60000,
      isCacheable: (r) => r?.authoritative === true,
    });

    await action(ctx);
    await action(ctx);
    await action(ctx);

    // Every call retries rather than serving the first bad answer for a minute.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('still returns the degraded result to the caller', async () => {
    // Declining to CACHE is not declining to ANSWER. The caller asked for
    // whatever we have, and a fallback list is better than a thrown error in
    // a screen that is only trying to paint.
    const action = withFreshness('t.returns', async () => degraded, {
      isCacheable: (r) => r?.authoritative === true,
    });

    await expect(action(ctx)).resolves.toEqual(degraded);
  });

  it('recovers the moment the action succeeds again', async () => {
    let ok = false;
    const fn = vi.fn(async () => (ok ? authoritative : degraded));
    const action = withFreshness('t.recovers', fn, {
      staleAfter: 60000,
      isCacheable: (r) => r?.authoritative === true,
    });

    await action(ctx);
    ok = true;
    await action(ctx);
    await action(ctx);

    // Two real calls: the degraded one, then the good one. The third is a hit.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('leaves the previous good value in place when a later call degrades', async () => {
    // A degraded result must not overwrite a good cached one either. Not
    // caching means not writing ANY of the three cache fields.
    let result = authoritative;
    const fn = vi.fn(async () => result);
    const action = withFreshness('t.nooverwrite', fn, {
      staleAfter: 60000,
      isCacheable: (r) => r?.authoritative === true,
    });

    await action(ctx);
    result = degraded;
    await action(ctx, { forceRefresh: true });

    // The forced call answered with the degraded value, but did not replace
    // the cached good one — so an ordinary call is still a hit on the good.
    await expect(action(ctx)).resolves.toEqual(authoritative);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

/**
 * THE DEFECT THIS SUITE EXISTS FOR.
 *
 * This wrapper caches a RETURN VALUE and, on a hit, does not call the action.
 * But nearly every action it wraps does its real work in a `commit` — so a
 * cache hit means THE COMMIT DOES NOT HAPPEN.
 *
 * `resetUserScopedData` wipes module state on logout. If these closures
 * survive that, signing back in AS THE SAME USER produces an unchanged
 * identity and an unexpired TTL, so the next call is a hit, the commit never
 * runs, and the store stays empty.
 *
 * Measured in a real browser against the built app: after sign-out and back
 * in, `connectedApps` held 74 entries while `allProviders` held 0 — a
 * thirty-minute TTL over an emptied store — so the connectors screen mapped
 * over nothing. Reloading appeared to fix it only because a module reload
 * discards these closures.
 */
describe('a reset store must not leave a warm cache', () => {
  it('re-runs the action after invalidation, so its commit happens again', async () => {
    const commit = vi.fn();
    const fn = vi.fn(async () => {
      commit('SET_ALL_PROVIDERS', [1, 2, 3]);
      return authoritative;
    });
    const action = withFreshness('t.reset', fn, { staleAfter: 30 * 60 * 1000 });

    await action(ctx);
    await action(ctx);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);

    // The store has just been emptied. The cache describing it must go too.
    invalidateAllFreshness();

    await action(ctx);
    expect(fn, 'the action was skipped, so its commit never re-ran').toHaveBeenCalledTimes(2);
    expect(commit, 'the store was left empty').toHaveBeenCalledTimes(2);
  });

  it('invalidates even when the identity is unchanged', async () => {
    // The exact hole. Identity scoping asks "is this someone else's data?",
    // and signing back into the same account correctly answers no — which is
    // why identity alone could never have caught this.
    const fn = vi.fn(async () => authoritative);
    const action = withFreshness('t.sameIdentity', fn, {
      staleAfter: 30 * 60 * 1000,
      identity: () => 'user-1',
    });

    await action(ctx);
    invalidateAllFreshness();
    await action(ctx);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears every registered wrapper, not just one', async () => {
    const a = vi.fn(async () => authoritative);
    const b = vi.fn(async () => authoritative);
    const actionA = withFreshness('t.multiA', a, { staleAfter: 60000 });
    const actionB = withFreshness('t.multiB', b, { staleAfter: 60000 });

    await actionA(ctx);
    await actionB(ctx);
    invalidateAllFreshness();
    await actionA(ctx);
    await actionB(ctx);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('does not disturb a request already on the wire', async () => {
    // A caller is awaiting it. Rejecting or orphaning an in-flight request
    // would turn a stale screen into a broken one.
    let release;
    const fn = vi.fn(() => new Promise((resolve) => { release = () => resolve(authoritative); }));
    const action = withFreshness('t.inflight', fn, { staleAfter: 60000 });

    const pending = action(ctx);
    invalidateAllFreshness();
    release();

    await expect(pending).resolves.toEqual(authoritative);
  });

  it('is safe to call when nothing has been fetched yet', () => {
    expect(() => invalidateAllFreshness()).not.toThrow();
  });
});

describe('the predicate cannot break the fetch it only scopes', () => {
  it('treats a throwing predicate as "do not cache"', async () => {
    // Re-fetching costs a request. Wrongly freezing a bad answer costs the
    // user a broken screen until they reload, so the failure direction is
    // deliberate.
    const fn = vi.fn(async () => authoritative);
    const action = withFreshness('t.throws', fn, {
      staleAfter: 60000,
      isCacheable: () => {
        throw new Error('predicate blew up');
      },
    });

    await expect(action(ctx)).resolves.toEqual(authoritative);
    await action(ctx);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('requires exactly true, not merely truthy', async () => {
    const fn = vi.fn(async () => authoritative);
    const action = withFreshness('t.truthy', fn, {
      staleAfter: 60000,
      isCacheable: () => 'yes',
    });

    await action(ctx);
    await action(ctx);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('caches normally when no predicate is supplied', async () => {
    // Every other action in the store relies on this default.
    const fn = vi.fn(async () => ({ anything: true }));
    const action = withFreshness('t.default', fn, { staleAfter: 60000 });

    await action(ctx);
    await action(ctx);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not interfere with identity scoping', async () => {
    const fn = vi.fn(async () => authoritative);
    const action = withFreshness('t.identity', fn, {
      staleAfter: 60000,
      identity: (c) => c.subject,
      isCacheable: (r) => r?.authoritative === true,
    });

    await action({ subject: 'anonymous' });
    await action({ subject: 'anonymous' });
    await action({ subject: 'user-1' });

    // Cached per subject: a hit for the repeat, a miss for the new subject.
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
