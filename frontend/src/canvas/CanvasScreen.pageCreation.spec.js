/**
 * Regression guard for the duplicate-layout-page bug (2026-07-26).
 *
 * CanvasScreen used to call ensurePageForScreen() synchronously on mount,
 * before fetchLayouts() had resolved. At that moment `pages` is EMPTY, so the
 * "does a page exist for this route?" lookup answered null no matter what, and
 * the component created + POSTed a brand new page. The in-flight GET then
 * replaced `pages`, orphaning the row. One leaked DB row per cold start —
 * 1,455 duplicate ChatScreen rows in the observed production database.
 *
 * Two invariants are pinned here:
 *   1. Mount must NEVER create a page before layouts are loaded.
 *   2. createPageFromDefault must be idempotent per route regardless of caller.
 *
 * Invariant 2 is exercised against the REAL store module, not a fake, because
 * a mock of the thing under test proves nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/composables/useElectron', () => ({
  useElectron: () => ({ isElectron: { value: false } }),
  electronUtils: {
    minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
  },
}));

import CanvasScreen from './CanvasScreen.vue';
import widgetLayoutModule from '@/store/features/widgetLayout.js';

// ── helpers ──────────────────────────────────────────────────────────────

/** Fresh copy of the real module — `state` is a shared object literal. */
function freshWidgetLayout() {
  return {
    ...widgetLayoutModule,
    namespaced: true,
    state: { pages: [], activePageId: null, layouts: {}, isDirty: false, isLoaded: false },
  };
}

/** Minimal surrounding store: CanvasScreen only reads these three modules. */
function makeStore(widgetLayout) {
  return createStore({
    modules: {
      widgetLayout,
      userAuth: { namespaced: true, getters: { isAuthenticated: () => true } },
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider: 'openai', selectedModel: 'gpt-4o' }),
      },
    },
  });
}

const mountCanvas = (store, screenName = 'ChatScreen') =>
  mount(CanvasScreen, {
    props: { screenName },
    global: {
      plugins: [store],
      stubs: {
        WidgetCanvas: true, WidgetCatalog: true, Tooltip: true,
        ChatProviderSelector: true, SimpleModal: true, PageSwitcher: true,
        Teleport: true,
      },
    },
  });

const flush = () => new Promise((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────

describe('CanvasScreen — page creation on mount', () => {
  let dispatched;
  let widgetLayout;

  beforeEach(() => {
    dispatched = [];
    widgetLayout = freshWidgetLayout();
    // Record every dispatch while keeping real behaviour for the rest.
    widgetLayout.actions = {
      ...widgetLayout.actions,
      fetchLayouts: vi.fn(async ({ commit }) => {
        dispatched.push('fetchLayouts');
        commit('SET_LOADED', true);
      }),
      createPageFromDefault: vi.fn(async (_ctx, payload) => {
        dispatched.push(`create:${payload.screenName}`);
      }),
      setActivePage: vi.fn(({ commit }, id) => {
        dispatched.push(`activate:${id}`);
        commit('SET_ACTIVE_PAGE', id);
      }),
    };
  });

  it('does NOT create a page before layouts have loaded', async () => {
    const store = makeStore(widgetLayout);
    const wrapper = mountCanvas(store);

    // The synchronous mount pass has run by now. Creating here is the bug.
    expect(dispatched.filter((d) => d.startsWith('create:'))).toEqual([]);
    expect(dispatched).toContain('fetchLayouts');

    wrapper.unmount();
  });

  it('creates exactly once, after the fetch resolves, when the page is genuinely missing', async () => {
    const store = makeStore(widgetLayout);
    const wrapper = mountCanvas(store);
    await flush();

    expect(dispatched.filter((d) => d === 'create:ChatScreen')).toHaveLength(1);
    wrapper.unmount();
  });

  it('activates the existing page instead of creating a second one', async () => {
    widgetLayout.state.pages = [{ id: 'page_real', name: 'Chat', icon: 'x', route: 'ChatScreen', order: 0 }];
    widgetLayout.state.isLoaded = true;

    const store = makeStore(widgetLayout);
    const wrapper = mountCanvas(store);
    await flush();

    expect(dispatched).toContain('activate:page_real');
    expect(dispatched.filter((d) => d.startsWith('create:'))).toEqual([]);
    // Already loaded — no redundant refetch either.
    expect(dispatched).not.toContain('fetchLayouts');

    wrapper.unmount();
  });

  it('does not create a duplicate when the fetch returns the page it was missing', async () => {
    // The original failure mode end-to-end: page exists on the server, local
    // state is empty at mount, fetch fills it in.
    widgetLayout.actions.fetchLayouts = vi.fn(async ({ commit }) => {
      dispatched.push('fetchLayouts');
      commit('SET_PAGES', [{ id: 'page_server', name: 'Chat', icon: 'x', route: 'ChatScreen', order: 0 }]);
      commit('SET_LOADED', true);
    });

    const store = makeStore(widgetLayout);
    const wrapper = mountCanvas(store);
    await flush();

    expect(dispatched.filter((d) => d.startsWith('create:'))).toEqual([]);
    expect(dispatched).toContain('activate:page_server');

    wrapper.unmount();
  });

  it('creates at most one page across repeated cold mounts', async () => {
    // Simulates many app launches against a server that already has the page.
    for (let i = 0; i < 5; i++) {
      const wl = freshWidgetLayout();
      wl.actions = {
        ...wl.actions,
        fetchLayouts: vi.fn(async ({ commit }) => {
          commit('SET_PAGES', [{ id: 'page_server', name: 'Chat', icon: 'x', route: 'ChatScreen', order: 0 }]);
          commit('SET_LOADED', true);
        }),
        createPageFromDefault: vi.fn(async (_c, p) => { dispatched.push(`create:${p.screenName}`); }),
        setActivePage: vi.fn(({ commit }, id) => commit('SET_ACTIVE_PAGE', id)),
      };
      const wrapper = mountCanvas(makeStore(wl));
      await flush();
      wrapper.unmount();
    }

    expect(dispatched.filter((d) => d.startsWith('create:'))).toEqual([]);
  });
});

describe('widgetLayout/createPageFromDefault — idempotent per route', () => {
  let store;

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    localStorage.clear();
    store = makeStore(freshWidgetLayout());
  });

  it('returns the existing page instead of minting a second one', async () => {
    const first = await store.dispatch('widgetLayout/createPageFromDefault', {
      screenName: 'ChatScreen',
      defaultWidgets: [{ widgetId: 'chat', col: 0, row: 0, cols: 12, rows: 8 }],
    });
    const second = await store.dispatch('widgetLayout/createPageFromDefault', {
      screenName: 'ChatScreen',
      defaultWidgets: [{ widgetId: 'chat', col: 0, row: 0, cols: 12, rows: 8 }],
    });

    expect(second).toBe(first);
    expect(store.state.widgetLayout.pages.filter((p) => p.route === 'ChatScreen')).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent dispatches for the same route into one POST', async () => {
    // The existence check and the POST are separated by an await, so without
    // the in-flight guard both callers pass the check and both create.
    await Promise.all([
      store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'GoalsScreen', defaultWidgets: [] }),
      store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'GoalsScreen', defaultWidgets: [] }),
      store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'GoalsScreen', defaultWidgets: [] }),
    ]);

    expect(store.state.widgetLayout.pages.filter((p) => p.route === 'GoalsScreen')).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('releases the route lock after a failed POST so a retry can still succeed', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down'); });
    await store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'ToolsScreen', defaultWidgets: [] });

    // The page landed locally, so the retry short-circuits on the route check
    // rather than being blocked forever by a stuck lock.
    const retry = await store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'ToolsScreen', defaultWidgets: [] });
    expect(retry).toBeTruthy();
    expect(store.state.widgetLayout.pages.filter((p) => p.route === 'ToolsScreen')).toHaveLength(1);
  });

  it('still creates separate pages for separate routes', async () => {
    await store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'ChatScreen', defaultWidgets: [] });
    await store.dispatch('widgetLayout/createPageFromDefault', { screenName: 'SettingsScreen', defaultWidgets: [] });

    expect(store.state.widgetLayout.pages).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('leaves addPage (custom pages, no route) unaffected', async () => {
    await store.dispatch('widgetLayout/addPage', { name: 'Scratch', icon: 'fas fa-th' });
    await store.dispatch('widgetLayout/addPage', { name: 'Scratch 2', icon: 'fas fa-th' });

    expect(store.state.widgetLayout.pages).toHaveLength(2);
  });
});
