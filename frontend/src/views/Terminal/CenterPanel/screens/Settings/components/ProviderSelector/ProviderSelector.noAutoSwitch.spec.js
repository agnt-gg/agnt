/**
 * The settings picker never chooses a provider on the user's behalf.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * On mount, and whenever a provider newly connected, this picker checked
 * whether the selected provider was in the connected list. The list is
 * assembled from separate probes (local keys, remote keys, CLI status probes),
 * so it is routinely partial for a moment. When the selected provider was
 * missing from such a list, the picker walked a fixed vendor ladder whose
 * first rung was Anthropic and SAVED the result as the account default. A
 * provider that had been connected the whole time was replaced, and every
 * turn then ran on a model the account did not have.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ProviderSelector from './ProviderSelector.vue';

function mountWith({ selectedProvider, connectedApps }) {
  const actions = {
    setProvider: vi.fn(),
    setModel: vi.fn(),
    ensureValidModel: vi.fn(),
    fetchCustomProviders: vi.fn(),
    fetchCustomProviderModels: vi.fn(),
    fetchProviderModels: vi.fn(),
  };
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({
          providers: ['AGNT', 'Anthropic', 'Claude-Code', 'OpenAI', 'Gemini'],
          customProviders: [],
          allModels: {},
          loadingModels: {},
          modelMetadata: {},
          selectedProvider,
          selectedModel: selectedProvider ? 'claude-opus-5-5' : null,
          routingMode: 'static',
          routingPolicy: 'balanced',
        }),
        getters: {
          filteredProviders: (state) => state.providers,
          filteredModels: () => [],
          inferReasoningControl: () => () => null,
        },
        actions,
      },
      appAuth: {
        namespaced: true,
        state: () => ({ connectedApps }),
        mutations: { SET_CONNECTED_APPS: (state, apps) => { state.connectedApps = apps; } },
        actions: { fetchConnectedApps: vi.fn(), fetchAllProviders: vi.fn() },
      },
    },
  });
  const wrapper = shallowMount(ProviderSelector, {
    global: {
      plugins: [store],
      // The picker syncs its dropdowns through this method after a change.
      stubs: { CustomSelect: { template: '<div />', methods: { setSelectedOption() {} } } },
    },
  });
  return { wrapper, store, actions };
}

beforeEach(() => {
  // The component probes a local model server on mount; it is not under test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProviderSelector keeps the chosen provider', () => {
  it('THE REPORTED BUG: a partial connected list that lacks the chosen provider does not switch it', async () => {
    // Claude-Code's status probe has not answered yet; Anthropic's key has.
    const { wrapper, actions } = mountWith({ selectedProvider: 'Claude-Code', connectedApps: ['anthropic', 'openai'] });
    await flushPromises();
    expect(actions.setProvider).not.toHaveBeenCalled();
    expect(actions.ensureValidModel).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('a provider connecting later re-runs the check and still does not switch', async () => {
    const { wrapper, store, actions } = mountWith({ selectedProvider: 'Claude-Code', connectedApps: ['openai'] });
    await flushPromises();
    store.commit('appAuth/SET_CONNECTED_APPS', ['openai', 'anthropic']);
    await flushPromises();
    expect(actions.setProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('with nothing chosen the picker still does not guess; the store owns the first-run default', async () => {
    const { wrapper, actions } = mountWith({ selectedProvider: null, connectedApps: ['anthropic', 'claude-code'] });
    await flushPromises();
    expect(actions.setProvider).not.toHaveBeenCalled();
    expect(actions.ensureValidModel).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
