/**
 * Connecting an AI provider from the chat's provider picker.
 *
 * Unconnected providers used to be dead rows. Clicking one now runs the
 * Connectors page's connect flow and, once connected, picks it in THIS
 * picker's scope. Two failure modes this guards against:
 *   - the picker closing under the sign-in modal (every parent mounts it with
 *     v-if, so closing unmounts the modal and drops the flow);
 *   - a conversation's picker writing the account-wide default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ChatProviderSelector from './ChatProviderSelector.vue';

const connection = vi.hoisted(() => ({ connected: new Set(), toggle: null }));

vi.mock('@/composables/useProviderConnection.js', () => ({
  useProviderConnection: () => ({
    isProviderConnected: (id) => connection.connected.has(id),
    handleProviderToggle: (id) => connection.toggle(id),
  }),
}));

function mountPicker({ props = {}, modalOpen = false, routingModeByConv = {} } = {}) {
  const aiActions = {
    setProvider: vi.fn(),
    setModel: vi.fn(),
    fetchCustomProviders: vi.fn(),
    fetchCustomProviderModels: vi.fn(),
  };
  const chatActions = { setConversationAi: vi.fn(), clearConversationAi: vi.fn(), setConversationRoutingMode: vi.fn() };
  const store = createStore({
    modules: {
      aiProvider: {
        namespaced: true,
        state: () => ({
          providers: ['OpenAI', 'Cursor', 'Local'],
          customProviders: [],
          // Models already loaded, so nothing is fetched on mount or on pick.
          allModels: { OpenAI: ['gpt-5'], Cursor: ['cursor-grok-4.5-high'] },
          loadingModels: {},
          modelMetadata: {},
          selectedProvider: 'OpenAI',
          selectedModel: 'gpt-5',
          routingMode: 'static',
        }),
        getters: {
          filteredProviders: (state) => state.providers,
          inferReasoningControl: () => () => null,
        },
        actions: aiActions,
      },
      appAuth: {
        namespaced: true,
        state: () => ({ connectedApps: [...connection.connected] }),
        actions: { fetchConnectedApps: vi.fn(), fetchAllProviders: vi.fn() },
      },
      chat: {
        namespaced: true,
        state: () => ({ aiByConv: {}, routingModeByConv }),
        actions: chatActions,
      },
    },
  });
  const wrapper = shallowMount(ChatProviderSelector, {
    props: { isOpen: true, ...props },
    attachTo: document.body,
    global: {
      plugins: [store],
      directives: { 'viewport-clamp': {} },
      stubs: {
        CustomSelect: { name: 'CustomSelect', template: '<div class="custom-select-stub" />', props: ['options'], emits: ['option-selected', 'connect-option'], methods: { setSelectedOption() {} } },
        SimpleModal: { template: '<div />', data: () => ({ isOpen: modalOpen }) },
      },
    },
  });
  return { wrapper, aiActions, chatActions };
}

const providerSelect = (wrapper) => wrapper.findAllComponents({ name: 'CustomSelect' })[0];

beforeEach(() => {
  connection.connected = new Set(['openai']);
  connection.toggle = vi.fn(async (id) => { connection.connected.add(id); });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); // local server probe
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ChatProviderSelector — connect from the picker', () => {
  it('offers Connect for an unconnected provider and a normal pick for a connected one', () => {
    const { wrapper } = mountPicker();
    const options = providerSelect(wrapper).props('options');
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));

    expect(byValue.Cursor.connect).toBe(true);
    expect(byValue.OpenAI.connect).toBe(false);
    expect(byValue.Local.connect).toBe(false); // nothing to connect
    for (const option of options) expect(option.disabled).toBeFalsy();
    wrapper.unmount();
  });

  it('a Connect row runs the connect flow and picks the provider as the default (global picker)', async () => {
    const { wrapper, aiActions } = mountPicker();
    providerSelect(wrapper).vm.$emit('connect-option', { label: 'Cursor', value: 'Cursor', connect: true });
    await flushPromises();

    expect(connection.toggle).toHaveBeenCalledWith('cursor-cli');
    expect(aiActions.setProvider).toHaveBeenCalledWith(expect.anything(), { provider: 'Cursor', source: 'chat-picker' });
    wrapper.unmount();
  });

  it("in a conversation's picker it pins this conversation only and never touches the default", async () => {
    const { wrapper, aiActions, chatActions } = mountPicker({
      props: { conversationId: 'conv-1' },
      routingModeByConv: { 'conv-1': 'pinned' },
    });
    providerSelect(wrapper).vm.$emit('connect-option', { label: 'Cursor', value: 'Cursor', connect: true });
    await flushPromises();

    expect(chatActions.setConversationAi).toHaveBeenCalledWith(expect.anything(), {
      conversationId: 'conv-1',
      provider: 'Cursor',
      model: 'cursor-grok-4.5-high',
    });
    expect(aiActions.setProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // The document listeners are attached at the END of an async onMounted, so
  // each test waits for it; otherwise "did not close" passes vacuously.
  it('a click inside the sign-in modal does not close the picker; a click elsewhere still does', async () => {
    const { wrapper } = mountPicker();
    await flushPromises();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const confirmButton = document.createElement('button');
    overlay.appendChild(confirmButton);
    document.body.appendChild(overlay);

    confirmButton.click();
    expect(wrapper.emitted('close')).toBeUndefined();

    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    elsewhere.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it("Escape while the sign-in modal is open is the modal's cancel, not the picker's close", async () => {
    const { wrapper } = mountPicker({ modalOpen: true });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('Escape with no modal open still closes the picker', async () => {
    const { wrapper } = mountPicker({ modalOpen: false });
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});
