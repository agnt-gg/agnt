import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';
import marketplace from './marketplace.js';

/**
 * The shelf slice exists to be ISOLATED from the Marketplace screen.
 *
 * `fetchMarketplaceItems` sends the global `filters` to the server, so whatever
 * the Marketplace screen was last filtered to decides what `marketplaceItems`
 * contains. If the shelf read that, browsing to "tools only" and then opening
 * the Agents screen would show an empty shelf for no reason the user can see.
 */
/**
 * The module exports `state` as a plain OBJECT, not a factory — correct for an
 * app with exactly one store, but it means every createStore() here would share
 * (and mutate) the same object. Without this clone, one test's populated cache
 * silently short-circuits the next test's fetch, and the failures land on
 * whichever assertion runs second. Clone per test.
 */
const pristine = JSON.parse(JSON.stringify(marketplace.state));
const makeStore = () =>
  createStore({
    modules: {
      marketplace: { ...marketplace, namespaced: true, state: JSON.parse(JSON.stringify(pristine)) },
    },
  });

const okResponse = (items) => ({ ok: true, status: 200, json: async () => ({ items }) });

const ITEMS = [
  { id: 'a1', asset_type: 'agent', title: 'Agent One' },
  { id: 'w1', asset_type: 'workflow', title: 'Workflow One' },
  { id: 't1', asset_type: 'tool', title: 'Tool One' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse(ITEMS))));
  localStorage.setItem('token', 'test-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marketplace store — shelf slice', () => {
  it('starts idle and empty so a component can tell "not yet" from "nothing"', () => {
    const store = makeStore();
    expect(store.getters['marketplace/shelfStatus']).toBe('idle');
    expect(store.getters['marketplace/shelfItems']).toEqual([]);
  });

  it('fetches the catalogue and marks itself ready', async () => {
    const store = makeStore();
    await store.dispatch('marketplace/fetchShelfItems');
    expect(store.getters['marketplace/shelfStatus']).toBe('ready');
    expect(store.getters['marketplace/shelfItems']).toHaveLength(3);
  });

  it('sends NO filter params, so the shelf is immune to the Marketplace screen', async () => {
    const store = makeStore();
    store.state.marketplace.filters.assetType = 'tool';
    store.state.marketplace.filters.search = 'something';
    await store.dispatch('marketplace/fetchShelfItems');
    const url = global.fetch.mock.calls[0][0];
    expect(url).not.toContain('?');
    expect(url).toMatch(/\/marketplace\/items$/);
  });

  it('never writes to the global filters', async () => {
    const store = makeStore();
    const before = JSON.stringify(store.state.marketplace.filters);
    await store.dispatch('marketplace/fetchShelfItems');
    expect(JSON.stringify(store.state.marketplace.filters)).toBe(before);
  });

  it('leaves the Marketplace screen’s own item list untouched', async () => {
    const store = makeStore();
    store.state.marketplace.marketplaceItems = [{ id: 'preexisting' }];
    await store.dispatch('marketplace/fetchShelfItems');
    expect(store.state.marketplace.marketplaceItems).toEqual([{ id: 'preexisting' }]);
  });

  it('narrows to one asset type, and returns empty for types the server does not serve', async () => {
    const store = makeStore();
    await store.dispatch('marketplace/fetchShelfItems');
    const byType = store.getters['marketplace/shelfItemsByType'];
    expect(byType('agent').map((i) => i.id)).toEqual(['a1']);
    expect(byType('skill')).toEqual([]);
    expect(byType('widget')).toEqual([]);
  });

  it('serves five screens from one request', async () => {
    const store = makeStore();
    await Promise.all([
      store.dispatch('marketplace/fetchShelfItems'),
      store.dispatch('marketplace/fetchShelfItems'),
      store.dispatch('marketplace/fetchShelfItems'),
    ]);
    await store.dispatch('marketplace/fetchShelfItems');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when forced', async () => {
    const store = makeStore();
    await store.dispatch('marketplace/fetchShelfItems');
    await store.dispatch('marketplace/fetchShelfItems', { force: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('re-fetches once the cache has expired', async () => {
    const store = makeStore();
    await store.dispatch('marketplace/fetchShelfItems');
    store.state.marketplace.lastShelfFetched = Date.now() - 6 * 60 * 1000;
    await store.dispatch('marketplace/fetchShelfItems');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe('failure is silent and safe', () => {
    it('reports error status and an empty list when the network throws', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
      const store = makeStore();
      await store.dispatch('marketplace/fetchShelfItems');
      expect(store.getters['marketplace/shelfStatus']).toBe('error');
      expect(store.getters['marketplace/shelfItems']).toEqual([]);
    });

    it('treats a non-2xx response as a failure rather than rendering junk', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) })));
      const store = makeStore();
      await store.dispatch('marketplace/fetchShelfItems');
      expect(store.getters['marketplace/shelfStatus']).toBe('error');
    });

    // An unreachable marketplace must not put an error banner on the Agents screen.
    it('does not raise the global error the Marketplace screen renders', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
      const store = makeStore();
      await store.dispatch('marketplace/fetchShelfItems');
      expect(store.getters['marketplace/error']).toBeNull();
    });

    it('does not flip the global loading flag the Marketplace screen renders', async () => {
      const store = makeStore();
      await store.dispatch('marketplace/fetchShelfItems');
      expect(store.getters['marketplace/isLoading']).toBe(false);
    });

    it('survives a response with no items array', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })));
      const store = makeStore();
      await store.dispatch('marketplace/fetchShelfItems');
      expect(store.getters['marketplace/shelfItems']).toEqual([]);
      expect(store.getters['marketplace/shelfStatus']).toBe('ready');
    });
  });
});
