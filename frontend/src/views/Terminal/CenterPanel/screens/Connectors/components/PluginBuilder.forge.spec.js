/**
 * The Plugin Forge, as a user meets it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Forge's chat is the screen's left column (PluginForgePanel), a real
 * agent with plugin tools. This pane is what it produces. These tests pin
 * that the pane defers to the chat (empty state points there, Ask to fix is
 * sent there, nothing installs underneath a running chat turn), that the
 * install state is derived honestly, and that Test runs the installed tool
 * through the same endpoint an agent uses — never pretending a draft that is
 * not installed can be exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

let apiCalls;
let executeReply;
vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    apiCalls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => executeReply };
  }),
}));

import pluginBuilder from '@/store/features/pluginBuilder.js';
import PluginBuilder from './PluginBuilder.vue';
import { PLUGIN_FORGE_ASK_EVENT } from '@/composables/chat/usePluginChatContext.js';

const PRISTINE = JSON.parse(JSON.stringify(pluginBuilder.state));
const MANIFEST = {
  name: 'notion-sync',
  version: '0.4.0',
  description: 'Notion pages and search',
  tools: [
    {
      type: 'notion-search',
      schema: {
        title: 'Search',
        parameters: {
          query: { type: 'string', required: true, description: 'What to look for' },
          limit: { type: 'number', default: 5 },
          filter: { type: 'string' },
        },
      },
    },
  ],
};

const showModal = vi.fn().mockResolvedValue(true);
const SimpleModalStub = { name: 'SimpleModal', template: '<div />', methods: { showModal } };

function makeStore({ draft = false, installed = false, chatStreaming = false } = {}) {
  const store = createStore({
    modules: {
      pluginBuilder: { ...pluginBuilder, state: () => JSON.parse(JSON.stringify(PRISTINE)) },
      aiProvider: { namespaced: true, state: () => ({ selectedProvider: 'OpenAI', selectedModel: 'gpt-test' }) },
      tools: { namespaced: true, actions: { fetchTools: vi.fn() } },
      chatUnified: {
        namespaced: true,
        state: () => ({ streamingChannels: chatStreaming ? { 'plugin:plugin-forge': true } : {} }),
        actions: { clearConversation: vi.fn() },
      },
    },
  });
  if (draft) {
    store.commit('pluginBuilder/SET_GENERATED_MANIFEST', MANIFEST);
    store.commit('pluginBuilder/SET_GENERATED_CODE', { fileName: 'search.js', code: 'module.exports = {}' });
  }
  if (installed) store.commit('pluginBuilder/SET_INSTALLED_HASH', store.getters['pluginBuilder/draftHash']);
  return store;
}

function mountForge(store, installedNames = [], { openForgeChat = vi.fn(), mobile = false } = {}) {
  return mount(PluginBuilder, {
    props: { installedNames },
    global: {
      plugins: [store],
      provide: { openForgeChat, isMobile: ref(mobile) },
      stubs: { SimpleModal: SimpleModalStub, SvgIcon: true },
      directives: { tooltip: {} },
    },
  });
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'test-token');
  apiCalls = [];
  executeReply = { success: true, result: { hits: 2 } };
  global.fetch = vi.fn();
  showModal.mockClear();
});

describe('before anything exists', () => {
  it('points at the chat, where a plugin starts — no second composer here', () => {
    const wrapper = mountForge(makeStore());

    expect(wrapper.find('.empty-title').text()).toBe('What should your plugin do?');
    expect(wrapper.text()).toContain('chat on the left');
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('.forge-body').exists()).toBe(false);
  });

  it('shows the chat is building while it is', () => {
    const wrapper = mountForge(makeStore({ chatStreaming: true }));
    expect(wrapper.find('.empty-title').text()).toBe('Building your plugin…');
    expect(wrapper.find('.working').exists()).toBe(true);
  });

  it('on a phone, opens the chat sheet', async () => {
    const openForgeChat = vi.fn();
    const wrapper = mountForge(makeStore(), [], { openForgeChat, mobile: true });
    await buttonByText(wrapper, 'Open chat').trigger('click');
    expect(openForgeChat).toHaveBeenCalled();
  });

  it('offers packs as a way out, not as a peer tab', async () => {
    const wrapper = mountForge(makeStore());
    await buttonByText(wrapper, 'Make a pack instead').trigger('click');

    expect(wrapper.emitted('open-pack')).toHaveLength(1);
  });
});

describe('once a draft exists', () => {
  it('is the plugin, full width — the conversation lives in the left column', () => {
    const wrapper = mountForge(makeStore({ draft: true }));

    expect(wrapper.find('.forge-pane').exists()).toBe(true);
    expect(wrapper.find('.forge-chat').exists()).toBe(false);
    expect(wrapper.findAll('.pane-tab').map((t) => t.text())).toEqual(['Overview', 'Test', 'Code']);
  });

  it('nothing installs or resets underneath a running chat turn', () => {
    const wrapper = mountForge(makeStore({ draft: true, chatStreaming: true }));

    expect(buttonByText(wrapper, 'Install & try').attributes('disabled')).toBeDefined();
    expect(buttonByText(wrapper, 'Start over').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.working').text()).toContain('Annie is working');
  });

  it('reacts to what the chat did: a test result opens the Test tab, an install refreshes the list', async () => {
    const wrapper = mountForge(makeStore({ draft: true, installed: true }), ['notion-sync']);

    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType: 'plugin-test-result', eventData: { toolType: 'notion-search' } } }));
    await flushPromises();
    expect(wrapper.find('.pane-tab.active').text()).toBe('Test');

    window.dispatchEvent(new CustomEvent('chat-sse-event', { detail: { eventType: 'plugin-installed', eventData: { name: 'notion-sync', files: {} } } }));
    expect(wrapper.emitted('plugin-installed')).toHaveLength(1);
    wrapper.unmount();
  });

  it('a draft that was never installed says so, and cannot be published', () => {
    const wrapper = mountForge(makeStore({ draft: true }));

    expect(wrapper.find('.status-pill').text()).toBe('Draft · not installed');
    expect(buttonByText(wrapper, 'Install & try').attributes('disabled')).toBeUndefined();
    expect(buttonByText(wrapper, 'Publish').attributes('disabled')).toBeDefined();
  });

  it('is "Installed" only when the plugin is present AND unchanged', () => {
    const store = makeStore({ draft: true, installed: true });

    expect(mountForge(store, []).find('.status-pill').text()).toBe('Draft · not installed');
    const wrapper = mountForge(store, ['notion-sync']);
    expect(wrapper.find('.status-pill').text()).toBe('Installed');
    expect(buttonByText(wrapper, 'Publish').attributes('disabled')).toBeUndefined();
  });

  it('an edit after install turns the button into "Install changes"', async () => {
    const store = makeStore({ draft: true, installed: true });
    const wrapper = mountForge(store, ['notion-sync']);

    store.dispatch('pluginBuilder/updateFile', { fileName: 'search.js', content: '// edited' });
    await flushPromises();

    expect(wrapper.find('.status-pill').text()).toBe('Changes not installed');
    expect(buttonByText(wrapper, 'Install changes').exists()).toBe(true);
  });

  it('lists each tool with its inputs on Overview', () => {
    const wrapper = mountForge(makeStore({ draft: true }));
    const chips = wrapper.findAll('.tool-row .chip').map((c) => c.text());

    expect(wrapper.find('.tool-title').text()).toBe('Search');
    expect(chips).toEqual(['query', 'limit?', 'filter?']);
  });
});

describe('Test', () => {
  async function openTest(wrapper) {
    await buttonByText(wrapper, 'Test').trigger('click');
    await flushPromises();
  }

  it('will not run a tool that is not installed, and says why', async () => {
    const wrapper = mountForge(makeStore({ draft: true }));
    await openTest(wrapper);

    expect(wrapper.find('.test-body .callout').text()).toContain('Install the plugin to run its tools');
    expect(buttonByText(wrapper, 'Run').attributes('disabled')).toBeDefined();
  });

  it('runs the installed tool through the agent endpoint with typed args', async () => {
    const wrapper = mountForge(makeStore({ draft: true, installed: true }), ['notion-sync']);
    await openTest(wrapper);

    const inputs = wrapper.findAll('.test-fields .field-input');
    await inputs[0].setValue('Q3 roadmap');
    await buttonByText(wrapper, 'Run').trigger('click');
    await flushPromises();

    const call = apiCalls.find((c) => c.url.includes('/tools/'));
    expect(call.url).toBe('http://localhost:3333/api/tools/notion-search/execute');
    expect(call.method).toBe('POST');
    // number coerced from the default; the blank optional field is omitted
    expect(call.body).toEqual({ args: { query: 'Q3 roadmap', limit: 5 } });
    expect(wrapper.find('.test-result.ok').text()).toContain('Passed');
  });

  it('refuses to run with a required input missing', async () => {
    const wrapper = mountForge(makeStore({ draft: true, installed: true }), ['notion-sync']);
    await openTest(wrapper);
    await buttonByText(wrapper, 'Run').trigger('click');
    await flushPromises();

    expect(apiCalls.some((c) => c.url.includes('/tools/'))).toBe(false);
    expect(wrapper.emitted('show-alert')[0][1]).toContain('query');
  });

  it('a failure can be sent straight back to the chat to fix', async () => {
    executeReply = { success: false, error: '401 unauthorized' };
    const store = makeStore({ draft: true, installed: true });
    const wrapper = mountForge(store, ['notion-sync']);
    await openTest(wrapper);
    await wrapper.findAll('.test-fields .field-input')[0].setValue('x');
    await buttonByText(wrapper, 'Run').trigger('click');
    await flushPromises();

    expect(wrapper.find('.test-result.bad').text()).toContain('Failed');
    const asked = [];
    const listener = (event) => asked.push(event.detail.text);
    window.addEventListener(PLUGIN_FORGE_ASK_EVENT, listener);
    await buttonByText(wrapper, 'Ask to fix').trigger('click');
    window.removeEventListener(PLUGIN_FORGE_ASK_EVENT, listener);

    // To the chat, which can read the code, edit it, reinstall and re-test —
    // not to a generator that rewrites the whole plugin.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('401 unauthorized');
    expect(asked[0]).toContain('notion-search');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
