import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import ModelSelector from './ModelSelector.vue';

// Simple mock for CustomSelect
const CustomSelectMock = {
  template: '<div class="custom-select"><slot></slot></div>',
  props: ['options', 'placeholder'],
  methods: {
    setSelectedOption: vi.fn(),
  },
};

// Create a mock Vuex store with all required state
const createMockStore = () => {
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
          providers: ['openai', 'anthropic'],
          selectedProvider: 'openai', // This is what globalProvider reads from
          allModels: {
            openai: ['gpt-4', 'gpt-3.5-turbo'],
            anthropic: ['claude-3'],
          },
        },
        actions: {
          fetchProviderModels: vi.fn(() => Promise.resolve()),
        },
      },
      appAuth: {
        namespaced: true,
        state: {
          connectedApps: ['openai', 'anthropic'],
        },
        actions: {
          fetchConnectedApps: vi.fn(),
        },
      },
    },
  });
};

describe('ModelSelector', () => {
  const createWrapper = (props = {}) => {
    const store = createMockStore();
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
});
