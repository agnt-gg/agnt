import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FallbackProviders from './FallbackProviders.vue';

/**
 * Custom OpenAI-compatible providers as user-global fallback tiers.
 *
 * The backend now admits a custom provider into the failover chain when the
 * caller supplies the user's active custom-provider ids (see
 * ProviderFallback.js). This component is the surface that WRITES that chain,
 * and it filtered custom providers out entirely:
 *
 *   AI_PROVIDERS_WITH_API.includes(key) && connectedLower.includes(key)
 *
 * Custom providers are keyed by UUID so they are in neither list, and both
 * conditions fail.
 *
 * These tests mount the component and assert on `providerOptionsFor()` — the
 * function that actually feeds the dropdown — rather than grepping the source,
 * so they fail if the option list is wrong for any reason, not just if a
 * particular line of code goes missing.
 */

const SPARK_LING = '2d6a62f5-b7e9-4cfe-92cc-d4bede6e9202';
const SPARK_QWEN = '56515f9f-92ca-4456-b9cf-72bfdc30277e';

/** Records props so a test can read what the dropdown was actually handed. */
const SelectStub = {
  name: 'CustomSelect',
  props: ['options', 'modelValue', 'placeholder'],
  emits: ['option-selected'],
  template: '<div class="select-stub"></div>',
};

const ButtonStub = {
  name: 'BaseButton',
  props: ['variant', 'size', 'disabled'],
  template: '<button><slot /></button>',
};

function makeStore({
  providers = ['Anthropic', 'OpenAI'],
  customProviders = [],
  connectedApps = [],
  selectedProvider = 'Anthropic',
  allModels = {},
} = {}) {
  const dispatched = [];
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider, allModels, customProviders }),
        getters: { filteredProviders: (state) => providers },
        actions: {
          fetchCustomProviders: () => Promise.resolve([]),
          fetchProviderModels: () => Promise.resolve([]),
          fetchAnthropicModels: () => Promise.resolve([]),
          fetchOpenAIModels: () => Promise.resolve([]),
        },
      },
      appAuth: {
        namespaced: true,
        state: () => ({ connectedApps }),
        actions: { fetchConnectedApps: () => Promise.resolve([]) },
      },
    },
  });
  const realDispatch = store.dispatch.bind(store);
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    return realDispatch(type, payload);
  };
  return { store, dispatched };
}

/** Settings responses for load(); PUT bodies are captured for assertions. */
function mockFetch({ fallbackProviders = [], fallbackEnabled = true } = {}) {
  const puts = [];
  global.fetch = vi.fn((url, opts = {}) => {
    if ((opts.method || 'GET').toUpperCase() === 'PUT') {
      puts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ fallbackEnabled, fallbackProviders }),
    });
  });
  return puts;
}

async function mountComponent(storeOpts = {}, fetchOpts = {}) {
  const { store, dispatched } = makeStore(storeOpts);
  const puts = mockFetch(fetchOpts);
  const wrapper = mount(FallbackProviders, {
    global: {
      plugins: [store],
      stubs: { CustomSelect: SelectStub, BaseButton: ButtonStub },
    },
  });
  await flushPromises();
  return { wrapper, store, dispatched, puts };
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('FallbackProviders — custom providers in the dropdown', () => {
  it('offers an active custom provider as a fallback option', async () => {
    const { wrapper } = await mountComponent({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    const opts = wrapper.vm.providerOptionsFor(0);
    expect(opts).toContainEqual({ label: 'spark-ling', value: SPARK_LING });
  });

  it('uses the provider id as the option value — the chain is matched on id, not name', async () => {
    const { wrapper } = await mountComponent({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    const opt = wrapper.vm.providerOptionsFor(0).find((o) => o.label === 'spark-ling');
    expect(opt.value).toBe(SPARK_LING);
  });

  it('does not require a connectedApps entry for a custom provider', async () => {
    // A custom provider's row in custom_openai_providers IS its connection —
    // it carries base_url + api_key. connectedApps only tracks OAuth/API-key
    // links for built-ins, so gating custom providers on it excludes them all.
    const { wrapper } = await mountComponent({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
      connectedApps: [],
    });
    expect(wrapper.vm.providerOptionsFor(0).some((o) => o.value === SPARK_LING)).toBe(true);
  });

  it('still hides a built-in provider that is not connected', async () => {
    const { wrapper } = await mountComponent({
      providers: ['Anthropic', 'OpenAI'],
      connectedApps: [],
      selectedProvider: 'Anthropic',
    });
    expect(wrapper.vm.providerOptionsFor(0).some((o) => o.value === 'OpenAI')).toBe(false);
  });

  it('excludes the custom provider that is currently the default', async () => {
    const { wrapper } = await mountComponent({
      customProviders: [
        { id: SPARK_LING, provider_name: 'spark-ling' },
        { id: SPARK_QWEN, provider_name: 'spark-qwen' },
      ],
      selectedProvider: SPARK_LING,
    });
    const values = wrapper.vm.providerOptionsFor(0).map((o) => o.value);
    expect(values).not.toContain(SPARK_LING);
    expect(values).toContain(SPARK_QWEN);
  });

  it('does not offer the same custom provider twice across rows', async () => {
    const { wrapper } = await mountComponent(
      {
        customProviders: [
          { id: SPARK_LING, provider_name: 'spark-ling' },
          { id: SPARK_QWEN, provider_name: 'spark-qwen' },
        ],
      },
      { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] }
    );
    // Row 0 holds spark-ling; a second row must not be able to pick it again.
    wrapper.vm.addRow();
    const values = wrapper.vm.providerOptionsFor(1).map((o) => o.value);
    expect(values).not.toContain(SPARK_LING);
    expect(values).toContain(SPARK_QWEN);
  });

  it('passes the custom option through to the rendered dropdown', async () => {
    const { wrapper } = await mountComponent(
      { customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }] },
      { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] }
    );
    const selects = wrapper.findAllComponents(SelectStub);
    expect(selects.length).toBeGreaterThanOrEqual(1);
    const values = selects[0].props('options').map((o) => o.value);
    expect(values).toContain(SPARK_LING);
  });
});

describe('FallbackProviders — models for a custom provider', () => {
  it('loads models through fetchProviderModels, which routes custom ids correctly', async () => {
    // PROVIDER_FETCH_ACTIONS is keyed by built-in display name, so a UUID finds
    // no action and the model list stays empty forever.
    const { wrapper, dispatched } = await mountComponent({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    wrapper.vm.addRow();
    await wrapper.vm.onProviderChange(0, SPARK_LING);
    await flushPromises();
    const call = dispatched.find((d) => d.type === 'aiProvider/fetchProviderModels');
    expect(call).toBeTruthy();
    expect(call.payload).toMatchObject({ provider: SPARK_LING });
  });

  it('fetches the custom provider list on mount', async () => {
    // Without this the dropdown is empty on a fresh load of the Connectors
    // screen unless some sibling component happened to populate the store.
    const { dispatched } = await mountComponent({
      customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
    });
    expect(dispatched.some((d) => d.type === 'aiProvider/fetchCustomProviders')).toBe(true);
  });
});

describe('FallbackProviders — saving a custom tier', () => {
  it('saves a complete custom row verbatim', async () => {
    const { wrapper, puts } = await mountComponent(
      {
        customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }],
        allModels: { [SPARK_LING]: ['ling-mini'] },
      },
      { fallbackProviders: [{ provider: SPARK_LING, model: 'ling-mini' }] }
    );
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders).toEqual([{ provider: SPARK_LING, model: 'ling-mini' }]);
  });

  it('omits a custom row with no model, because the backend would drop it', async () => {
    // buildProviderChain drops a custom tier with no model (no static model
    // list to default from). Sending one anyway means the UI shows a tier that
    // silently never fires — the exact failure this feature exists to remove.
    const { wrapper, puts } = await mountComponent(
      { customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }] },
      { fallbackProviders: [{ provider: SPARK_LING, model: null }] }
    );
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders).toEqual([]);
  });

  it('explains why an incomplete custom row was dropped', async () => {
    const { wrapper } = await mountComponent(
      { customProviders: [{ id: SPARK_LING, provider_name: 'spark-ling' }] },
      { fallbackProviders: [{ provider: SPARK_LING, model: null }] }
    );
    await wrapper.vm.save();
    await flushPromises();
    expect(wrapper.vm.statusMsg).toMatch(/spark-ling/);
    expect(wrapper.vm.statusMsg).toMatch(/model/i);
  });

  it('still sends a built-in row with no model (provider default is valid there)', async () => {
    const { wrapper, puts } = await mountComponent(
      { providers: ['Anthropic', 'OpenAI'], connectedApps: ['openai'], selectedProvider: 'Anthropic' },
      { fallbackProviders: [{ provider: 'OpenAI', model: null }] }
    );
    await wrapper.vm.save();
    await flushPromises();
    expect(puts[0].fallbackProviders).toEqual([{ provider: 'OpenAI', model: null }]);
  });
});
