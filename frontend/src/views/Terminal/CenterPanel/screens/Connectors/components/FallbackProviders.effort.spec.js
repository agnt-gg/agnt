import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FallbackProviders from './FallbackProviders.vue';

/**
 * Per-tier reasoning effort on Connectors → Fallback Providers.
 *
 * A backup tier can carry its own effort. Unset ('') means "same as chat" —
 * the key is omitted on save, which is exactly the shape every chain saved
 * before this feature has, so the backend runs those unchanged.
 */

const SelectStub = {
  name: 'CustomSelect',
  props: ['options', 'modelValue', 'placeholder'],
  emits: ['option-selected'],
  template: '<div class="select-stub"></div>',
};
const ButtonStub = { name: 'BaseButton', props: ['variant', 'size', 'disabled'], template: '<button><slot /></button>' };

const control = (...values) => ({
  kind: 'effort',
  options: values.map((v) => ({ value: v, label: v === 'xhigh' ? 'Max' : v[0].toUpperCase() + v.slice(1) })),
});

// What /models/grok-build/metadata returns (proxy-published efforts).
const MODEL_METADATA = {
  'Grok-Build': {
    'grok-4.7': { reasoningControl: control('default', 'low', 'medium', 'high', 'xhigh') },
    'grok-4.5': { reasoningControl: control('default', 'low', 'medium', 'high') },
    'grok-plain': {},
  },
};

function makeStore() {
  const dispatched = [];
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({
          selectedProvider: 'Anthropic',
          allModels: { 'Grok-Build': ['grok-4.7', 'grok-4.5', 'grok-plain'] },
          customProviders: [],
          modelMetadata: MODEL_METADATA,
        }),
        getters: {
          filteredProviders: () => ['Anthropic', 'Grok-Build'],
          inferReasoningControl: () => () => null,
        },
        actions: {
          fetchCustomProviders: () => Promise.resolve([]),
          fetchProviderModels: () => Promise.resolve([]),
        },
      },
      appAuth: { namespaced: true, state: () => ({ connectedApps: ['grok-build'] }), actions: { fetchConnectedApps: () => Promise.resolve([]) } },
    },
  });
  const realDispatch = store.dispatch.bind(store);
  store.dispatch = (type, payload) => { dispatched.push({ type, payload }); return realDispatch(type, payload); };
  return { store, dispatched };
}

async function mountWith(fallbackProviders) {
  const { store, dispatched } = makeStore();
  const puts = [];
  global.fetch = vi.fn((url, opts = {}) => {
    if ((opts.method || 'GET').toUpperCase() === 'PUT') {
      puts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ fallbackEnabled: true, fallbackProviders }) });
  });
  const wrapper = mount(FallbackProviders, {
    global: { plugins: [store], stubs: { CustomSelect: SelectStub, BaseButton: ButtonStub } },
  });
  await flushPromises();
  return { wrapper, puts, dispatched };
}

const values = (opts) => opts.map((o) => o.value);

beforeEach(() => localStorage.setItem('token', 'test-token'));
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('FallbackProviders — effort options', () => {
  it('offers the model\'s own efforts, led by "same as chat"', async () => {
    const { wrapper } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    const opts = wrapper.vm.effortOptionsFor(wrapper.vm.rows[0]);
    expect(values(opts)).toEqual(['', 'default', 'low', 'medium', 'high', 'xhigh']);
    expect(opts[0].label).toMatch(/same as chat/i);
    expect(opts.find((o) => o.value === 'default').label).toBe('Provider default');
  });

  it('renders a third select only for a model with an effort control', async () => {
    const withCtl = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    expect(withCtl.wrapper.findAllComponents(SelectStub)).toHaveLength(3);
    const without = await mountWith([{ provider: 'Grok-Build', model: 'grok-plain' }]);
    expect(without.wrapper.findAllComponents(SelectStub)).toHaveLength(2);
  });

  it('loads a saved effort into the row', async () => {
    const { wrapper } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    expect(wrapper.vm.rows[0].reasoning).toBe('xhigh');
  });
});

describe('FallbackProviders — saving effort', () => {
  it('sends a chosen effort with its tier', async () => {
    const { wrapper, puts } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    wrapper.vm.onEffortChange(0, 'xhigh');
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders).toEqual([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
  });

  it('omits the key for "same as chat", keeping the pre-existing shape', async () => {
    const { wrapper, puts } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'low' }]);
    wrapper.vm.onEffortChange(0, '');
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders).toEqual([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
  });
});

describe('FallbackProviders — keeping effort valid for the row', () => {
  it('clears an effort the newly chosen model does not offer', async () => {
    const { wrapper } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    wrapper.vm.onModelChange(0, 'grok-4.5'); // 4.5 has no xhigh
    expect(wrapper.vm.rows[0].reasoning).toBe('');
  });

  it('keeps an effort the new model also offers', async () => {
    const { wrapper } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'low' }]);
    wrapper.vm.onModelChange(0, 'grok-4.5');
    expect(wrapper.vm.rows[0].reasoning).toBe('low');
  });

  it('does not discard a saved effort on load, before metadata is confirmed', async () => {
    // grok-plain has no control in this store, standing in for "metadata not
    // arrived yet". The value must survive a load+save untouched.
    const { wrapper, puts } = await mountWith([{ provider: 'Grok-Build', model: 'grok-plain', reasoning: 'high' }]);
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders[0].reasoning).toBe('high');
  });

  it('resets effort when the provider changes', async () => {
    const { wrapper } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    await wrapper.vm.onProviderChange(0, 'Anthropic');
    expect(wrapper.vm.rows[0].reasoning).toBe('');
  });
});

describe('FallbackProviders — model loading', () => {
  it('asks fetchProviderModels for a built-in even when a list is already cached', async () => {
    // Used to return early on a cached list (pinning the tab to a stale one)
    // and to dispatch a generated action name that did not exist for Grok-Build.
    const { dispatched } = await mountWith([{ provider: 'Grok-Build', model: 'grok-4.7' }]);
    const call = dispatched.find((d) => d.type === 'aiProvider/fetchProviderModels');
    expect(call?.payload).toMatchObject({ provider: 'Grok-Build' });
  });
});
