import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ProviderModelSearch from './ProviderModelSearch.vue';

/**
 * Custom providers must stay findable in the provider search when they have
 * no cached models.
 *
 * The search index was built by flattening providers into ONE ROW PER MODEL:
 *
 *   for (const model of models) entries.push({ provider, providerLabel, model })
 *
 * A custom provider whose endpoint is unreachable has no model list, so it
 * contributed zero rows and vanished from search entirely — exactly when the
 * user needs to find it, because the picker is the only place a custom
 * provider can be edited or deleted.
 *
 * A second, independent defect kept even HEALTHY custom providers out of the
 * index: the mount-time model sweep reads customProviders, but this component
 * is a child of the provider picker and Vue mounts children before parents, so
 * the parent's fetchCustomProviders had not resolved yet. The list was empty,
 * every custom provider was skipped, and nothing ever re-ran the sweep.
 *
 * These tests mount the component and assert on rendered rows and on the
 * actions actually dispatched, so they fail if the behaviour breaks for any
 * reason — not merely if a particular line goes missing.
 */

const SPARK = '052c419d-1beb-42c9-81b8-f287685af155';
const OLLAMA = '85b1bffe-2734-4c2c-97fe-e81beac0cf03';

function makeStore({
  providers = ['Anthropic', 'OpenAI'],
  customProviders = [],
  allModels = {},
  // Models each provider's endpoint returns when fetchProviderModels is called.
  fetchResult = {},
} = {}) {
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({ providers, customProviders, allModels }),
        mutations: {
          SET_CUSTOM_PROVIDERS(state, list) {
            state.customProviders = list;
          },
          SET_PROVIDER_MODELS(state, { provider, models }) {
            state.allModels = { ...state.allModels, [provider]: models };
          },
        },
        actions: {
          fetchProviderModels: (_ctx, { provider } = {}) =>
            Promise.resolve(fetchResult[provider] || []),
          setProvider: () => Promise.resolve(),
          setModel: () => Promise.resolve(),
        },
      },
    },
  });

  const dispatched = [];
  const realDispatch = store.dispatch.bind(store);
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    return realDispatch(type, payload);
  };

  return { store, dispatched };
}

async function mountSearch(opts = {}, props = {}) {
  const { store, dispatched } = makeStore(opts);
  const wrapper = mount(ProviderModelSearch, {
    props,
    global: { plugins: [store] },
  });
  await flushPromises();
  dispatched.length = 0; // drop the mount-time sweep
  return { wrapper, store, dispatched };
}

/** Type a query and open the dropdown the way a real user would. */
async function search(wrapper, text) {
  const input = wrapper.find('input.search-input');
  await input.setValue(text);
  await input.trigger('focus');
  await flushPromises();
  return wrapper.findAll('.search-result').map((n) => n.text());
}

const CUSTOMS = [
  { id: SPARK, provider_name: 'spark-deepseek' },
  { id: OLLAMA, provider_name: 'ollama-local' },
];

describe('ProviderModelSearch — custom providers with no cached models', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists a custom provider that has no cached models', async () => {
    const { wrapper } = await mountSearch({
      customProviders: CUSTOMS,
      allModels: {}, // nothing cached for anyone
    });

    const rows = await search(wrapper, 'ollama');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('ollama-local (Custom)');
  });

  it('labels the model-less row rather than rendering an empty gap', async () => {
    const { wrapper } = await mountSearch({
      customProviders: CUSTOMS,
      allModels: {},
    });

    await search(wrapper, 'ollama');

    const row = wrapper.find('.search-result');
    expect(row.find('.result-model-none').exists()).toBe(true);
    expect(row.text()).toContain('no models loaded');
  });

  it('lists real model rows and NO extra provider-only row once models are cached', async () => {
    const { wrapper } = await mountSearch({
      customProviders: CUSTOMS,
      allModels: { [SPARK]: ['deepseek-v4-flash-0731', 'deepseek-v4-thinking'] },
    });

    const rows = await search(wrapper, 'spark');

    expect(rows).toHaveLength(2);
    expect(rows.join(' ')).toContain('deepseek-v4-flash-0731');
    expect(rows.join(' ')).toContain('deepseek-v4-thinking');
    // The provider-only fallback must not double-list a working provider.
    expect(wrapper.find('.result-model-none').exists()).toBe(false);
  });

  it('does NOT invent provider-only rows for built-in providers', async () => {
    // A built-in with no models means "not connected". Listing every
    // unconnected built-in would bury the providers that actually work.
    const { wrapper } = await mountSearch({
      providers: ['Anthropic', 'OpenAI'],
      customProviders: [],
      allModels: {},
    });

    const rows = await search(wrapper, 'anthropic');

    expect(rows).toHaveLength(0);
    expect(wrapper.find('.search-empty').exists()).toBe(true);
  });
});

describe('ProviderModelSearch — selecting a provider-only row', () => {
  it('resolves a model on the fly and pins the pair when the endpoint answers', async () => {
    const { wrapper, dispatched } = await mountSearch({
      customProviders: CUSTOMS,
      allModels: {},
      fetchResult: { [SPARK]: ['deepseek-v4-flash-0731'] },
    });

    await search(wrapper, 'spark');
    await wrapper.find('.search-result').trigger('mousedown');
    await flushPromises();

    expect(dispatched).toContainEqual({
      type: 'aiProvider/fetchProviderModels',
      payload: { provider: SPARK },
    });
    expect(dispatched).toContainEqual({ type: 'aiProvider/setProvider', payload: SPARK });
    expect(dispatched).toContainEqual({
      type: 'aiProvider/setModel',
      payload: 'deepseek-v4-flash-0731',
    });
  });

  it('selects an unreachable provider WITHOUT dispatching a null model', async () => {
    // Selecting is how the user reaches the provider's Edit/Delete buttons, so
    // it must still work. But setModel(null) would clear the selection that
    // setProvider just made.
    const { wrapper, dispatched } = await mountSearch({
      customProviders: CUSTOMS,
      allModels: {},
      fetchResult: {}, // endpoint down — resolves to nothing
    });

    await search(wrapper, 'ollama');
    await wrapper.find('.search-result').trigger('mousedown');
    await flushPromises();

    expect(dispatched).toContainEqual({ type: 'aiProvider/setProvider', payload: OLLAMA });
    expect(dispatched.some((d) => d.type === 'aiProvider/setModel')).toBe(false);
  });

  it('survives a rejected model fetch instead of leaving the pick half-applied', async () => {
    const { store } = makeStore({ customProviders: CUSTOMS, allModels: {} });
    // Replace the action with a rejecting one.
    store.hotUpdate({
      modules: {
        aiProvider: {
          namespaced: true,
          actions: {
            fetchProviderModels: () => Promise.reject(new Error('ECONNREFUSED')),
            setProvider: () => Promise.resolve(),
            setModel: () => Promise.resolve(),
          },
        },
      },
    });
    const dispatched = [];
    const realDispatch = store.dispatch.bind(store);
    store.dispatch = (type, payload) => {
      dispatched.push({ type, payload });
      return realDispatch(type, payload);
    };

    const wrapper = mount(ProviderModelSearch, { global: { plugins: [store] } });
    await flushPromises();
    dispatched.length = 0;

    await search(wrapper, 'ollama');
    await wrapper.find('.search-result').trigger('mousedown');
    await flushPromises();

    expect(dispatched).toContainEqual({ type: 'aiProvider/setProvider', payload: OLLAMA });
    expect(dispatched.some((d) => d.type === 'aiProvider/setModel')).toBe(false);
  });
});

describe('ProviderModelSearch — per-conversation overrides (applyGlobally: false)', () => {
  it('emits the resolved pair when a model is available', async () => {
    const { wrapper } = await mountSearch(
      {
        customProviders: CUSTOMS,
        allModels: {},
        fetchResult: { [SPARK]: ['deepseek-v4-flash-0731'] },
      },
      { applyGlobally: false },
    );

    await search(wrapper, 'spark');
    await wrapper.find('.search-result').trigger('mousedown');
    await flushPromises();

    const emitted = wrapper.emitted('selected');
    expect(emitted).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({ provider: SPARK, model: 'deepseek-v4-flash-0731' });
  });

  it('does NOT emit a null-model pin for an unreachable provider', async () => {
    // ChatProviderSelector pipes result.model straight into setConversationAi.
    // A provider pinned with a null model cannot route.
    const { wrapper, dispatched } = await mountSearch(
      { customProviders: CUSTOMS, allModels: {}, fetchResult: {} },
      { applyGlobally: false },
    );

    await search(wrapper, 'ollama');
    await wrapper.find('.search-result').trigger('mousedown');
    await flushPromises();

    expect(wrapper.emitted('selected')).toBeUndefined();
    // And it must not have written the global selection as a consolation prize.
    expect(dispatched.some((d) => d.type === 'aiProvider/setProvider')).toBe(false);
  });
});

describe('ProviderModelSearch — model sweep reaches custom providers', () => {
  it('re-runs the sweep when custom providers arrive after mount', async () => {
    // The parent dispatches fetchCustomProviders, and Vue mounts children
    // before parents — so on mount this list is empty. Without a watcher the
    // sweep never covers a custom provider at all.
    const { store, dispatched } = makeStore({ customProviders: [], allModels: {} });

    mount(ProviderModelSearch, { global: { plugins: [store] } });
    await flushPromises();

    expect(dispatched.some((d) => d.payload?.provider === SPARK)).toBe(false);
    dispatched.length = 0;

    store.commit('aiProvider/SET_CUSTOM_PROVIDERS', CUSTOMS);
    await flushPromises();

    expect(dispatched).toContainEqual({
      type: 'aiProvider/fetchProviderModels',
      payload: { provider: SPARK },
    });
    expect(dispatched).toContainEqual({
      type: 'aiProvider/fetchProviderModels',
      payload: { provider: OLLAMA },
    });
  });

  it('does not re-sweep a provider whose models are already cached', async () => {
    const { store, dispatched } = makeStore({
      customProviders: [],
      allModels: { [SPARK]: ['deepseek-v4-flash-0731'] },
    });

    mount(ProviderModelSearch, { global: { plugins: [store] } });
    await flushPromises();
    dispatched.length = 0;

    store.commit('aiProvider/SET_CUSTOM_PROVIDERS', CUSTOMS);
    await flushPromises();

    expect(dispatched.some((d) => d.payload?.provider === SPARK)).toBe(false);
    expect(dispatched).toContainEqual({
      type: 'aiProvider/fetchProviderModels',
      payload: { provider: OLLAMA },
    });
  });
});

describe('ProviderModelSearch — result ordering', () => {
  it('keeps provider-name-only matches in list order', async () => {
    // Characterization, not a comparator guard. Every row here scores Infinity,
    // so the comparator returns NaN — which looks alarming but is well-defined:
    // ECMA-262 SortCompare says "If v is NaN, return +0", i.e. a tie, and V8's
    // sort is stable. Verified by mutation: swapping the comparator for a
    // NaN-collapsing variant changes nothing, at 3 elements or at 30. What this
    // test does pin down is that ties surface in provider list order rather
    // than being shuffled by some future scoring change.
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`,
      provider_name: `spark-${String(i).padStart(2, '0')}`,
    }));
    const allModels = Object.fromEntries(many.map((p) => [p.id, [`model-${p.id}`]]));

    const { wrapper } = await mountSearch({ providers: [], customProviders: many, allModels });

    const rows = await search(wrapper, 'spark');

    expect(rows).toHaveLength(30);
    const order = rows.map((r) => r.match(/spark-(\d+)/)[1]);
    expect(order).toEqual(many.map((_, i) => String(i).padStart(2, '0')));
  });

  it('still ranks a model-name match above a provider-name-only match', async () => {
    const { wrapper } = await mountSearch({
      providers: [],
      customProviders: [
        { id: 'a', provider_name: 'zeta' },
        { id: 'b', provider_name: 'deepseek-host' },
      ],
      allModels: { a: ['deepseek-v4'], b: ['llama-3'] },
    });

    const rows = await search(wrapper, 'deepseek');

    expect(rows[0]).toContain('deepseek-v4');
  });
});
