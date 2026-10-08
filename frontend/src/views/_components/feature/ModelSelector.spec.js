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
  props: ['options', 'placeholder', 'modelValue'],
  methods: {
    setSelectedOption: vi.fn(),
  },
};

// Create a mock Vuex store with all required state
const createMockStore = ({
  providers = ['openai', 'anthropic'],
  connectedApps = ['openai', 'anthropic'],
  selectedProvider = 'openai',
  allModels = { openai: ['gpt-4', 'gpt-3.5-turbo'], anthropic: ['claude-3'] },
  setProvider = vi.fn(),
} = {}) => {
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
          selectedProvider,
          allModels,
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

  const mountBound = (initial = {}, storeOptions = {}) => {
    const store = createMockStore(storeOptions);
    const wrapper = mount(ModelSelector, {
      global: { plugins: [store], stubs: { CustomSelect: CustomSelectMock } },
      props: {
        provider: '',
        model: '',
        ...initial,
        'onUpdate:provider': (value) => Promise.resolve().then(() => wrapper.setProps({ provider: value })),
        'onUpdate:model': (value) => Promise.resolve().then(() => wrapper.setProps({ model: value })),
      },
    });
    return { wrapper, store };
  };
  const selects = (wrapper) => wrapper.findAllComponents(CustomSelectMock);

  describe('the choice reaches the form', () => {
    it('picking a provider sends it and its first model to the parent', async () => {
      const { wrapper } = mountBound({ provider: 'openai', model: 'gpt-4' });
      await flushPromises();

      selects(wrapper)[0].vm.$emit('option-selected', { label: 'anthropic', value: 'anthropic' });
      await flushPromises();

      expect(wrapper.props('provider')).toBe('anthropic');
      expect(wrapper.props('model')).toBe('claude-3');
      expect(selects(wrapper)[0].props('modelValue')).toBe('anthropic');
      expect(selects(wrapper)[1].props('modelValue')).toBe('claude-3');
    });

    it('picking a model sends it to the parent', async () => {
      const { wrapper } = mountBound({ provider: 'openai', model: 'gpt-4' });
      await flushPromises();

      selects(wrapper)[1].vm.$emit('option-selected', { label: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo' });
      await flushPromises();

      expect(wrapper.props('model')).toBe('gpt-3.5-turbo');
    });

    it('a new tool starts on the global provider and records it, without touching the global default', async () => {
      const setProvider = vi.fn();
      const { wrapper } = mountBound({}, { setProvider });
      await flushPromises();

      expect(wrapper.props('provider')).toBe('openai');
      expect(wrapper.props('model')).toBe('gpt-4');
      expect(setProvider).not.toHaveBeenCalled();
    });

    it('the global provider counts as connected when its connection id differs from its name', async () => {
      const { wrapper } = mountBound(
        {},
        { providers: ['OpenAI', 'Cursor'], connectedApps: ['openai', 'cursor-cli'], selectedProvider: 'Cursor', allModels: { Cursor: ['composer-2'] } },
      );
      await flushPromises();

      expect(wrapper.props('provider')).toBe('Cursor');
      expect(wrapper.props('model')).toBe('composer-2');
    });

    it('a saved tool keeps its provider and model, even a model no longer listed', async () => {
      const { wrapper } = mountBound({ provider: 'anthropic', model: 'claude-2' });
      await flushPromises();

      expect(wrapper.props('provider')).toBe('anthropic');
      expect(wrapper.props('model')).toBe('claude-2');
      expect(selects(wrapper)[1].props('options').map((o) => o.value)).toContain('claude-2');
    });

    it('nothing is preselected when no provider is usable', async () => {
      const { wrapper } = mountBound({}, { providers: ['OpenAI', 'Anthropic'], connectedApps: [], selectedProvider: 'OpenAI' });
      await flushPromises();

      expect(wrapper.props('provider')).toBe('');
      expect(wrapper.props('model')).toBe('');
    });
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
      const { wrapper } = mountBound({ provider: 'Cursor' }, { ...STORE, setProvider });
      await flushPromises();

      selects(wrapper)[0].vm.$emit('connect-option', { label: 'OpenAI', value: 'OpenAI', connect: true });
      await flushPromises();

      expect(connection.toggle).toHaveBeenCalledWith('openai');
      expect(wrapper.props('provider')).toBe('OpenAI');
      expect(setProvider).not.toHaveBeenCalled();
    });
  });
});
