import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ModelSelector from './ModelSelector.vue';

const connection = vi.hoisted(() => ({ connected: new Set(), toggle: null }));

vi.mock('@/composables/useProviderConnection.js', () => ({
  useProviderConnection: () => ({
    isProviderConnected: (id) => connection.connected.has(id),
    handleProviderToggle: (id) => connection.toggle(id),
  }),
}));

// Simple mock for CustomSelect
const CustomSelectMock = {
  template: '<div class="custom-select"><slot></slot></div>',
  props: ['options', 'placeholder'],
  methods: {
    setSelectedOption: vi.fn(),
  },
};

// Create a mock Vuex store with all required state
const createMockStore = ({ providers = ['openai', 'anthropic'], connectedApps = ['openai', 'anthropic'], setProvider = vi.fn() } = {}) => {
  return createStore({
    state: {
      globalProvider: 'openai',
      globalModel: 'gpt-4',
    },
    getters: {
      globalProvider: (state) => state.globalProvider,
      globalModel: (state) => state.globalModel,
    },
    modules: {
      aiProvider: {
        namespaced: true,
        state: {
          providers,
          selectedProvider: 'openai', // This is what globalProvider reads from
          allModels: {
            openai: ['gpt-4', 'gpt-3.5-turbo'],
            anthropic: ['claude-3'],
          },
        },
        getters: {
          // ModelSelector reads its provider list from this getter; without it
          // `providers.value` is undefined and providerOptions throws on .map().
          filteredProviders: (state) => state.providers,
        },
        actions: {
          fetchProviderModels: vi.fn(() => Promise.resolve()),
          setProvider,
        },
      },
      appAuth: {
        namespaced: true,
        state: {
          connectedApps,
        },
        actions: {
          fetchConnectedApps: vi.fn(),
          fetchAllProviders: vi.fn(),
        },
      },
    },
  });
};

describe('ModelSelector', () => {
  const createWrapper = (props = {}, storeOptions = {}) => {
    const store = createMockStore(storeOptions);
    return mount(ModelSelector, {
      global: {
        plugins: [store],
        stubs: {
          CustomSelect: CustomSelectMock,
        },
      },
      props,
    });
  };

  it('renders correctly', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('#model-selector').exists()).toBe(true);
    expect(wrapper.findAllComponents(CustomSelectMock)).toHaveLength(2);
  });

  it('has a provider selector', () => {
    const wrapper = createWrapper();
    const selects = wrapper.findAllComponents(CustomSelectMock);
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('has a model selector', () => {
    const wrapper = createWrapper();
    const selects = wrapper.findAllComponents(CustomSelectMock);
    expect(selects.length).toBe(2);
  });

  it('accepts initialProvider prop', () => {
    const wrapper = createWrapper({ initialProvider: 'anthropic' });
    expect(wrapper.props('initialProvider')).toBe('anthropic');
  });

  describe('connecting from the picker', () => {
    const STORE = { providers: ['OpenAI', 'Cursor', 'Z.AI', 'Local'], connectedApps: ['cursor-cli', 'zai'] };

    it('a connected Cursor or Z.AI is pickable; it used to read as "not connected"', () => {
      const wrapper = createWrapper({}, STORE);
      const options = wrapper.findAllComponents(CustomSelectMock)[0].props('options');
      const byValue = Object.fromEntries(options.map((o) => [o.value, o]));

      expect(byValue.Cursor.connect).toBe(false);
      expect(byValue['Z.AI'].connect).toBe(false);
      expect(byValue.Local.connect).toBe(false);
      expect(byValue.OpenAI.connect).toBe(true);
      // The Connect pill states it; the label no longer carries a suffix.
      expect(options.map((o) => o.label).join()).not.toContain('not connected');
    });

    it('Connect picks the provider in this selector only, never the global default', async () => {
      connection.connected = new Set(['cursor-cli', 'zai']);
      connection.toggle = vi.fn(async (id) => { connection.connected.add(id); });
      const setProvider = vi.fn();
      const wrapper = createWrapper({}, { ...STORE, setProvider });
      await flushPromises();

      wrapper.findAllComponents(CustomSelectMock)[0].vm.$emit('connect-option', { label: 'OpenAI', value: 'OpenAI', connect: true });
      await flushPromises();

      expect(connection.toggle).toHaveBeenCalledWith('openai');
      expect(wrapper.vm.localProvider).toBe('OpenAI');
      expect(setProvider).not.toHaveBeenCalled();
    });
  });
});
