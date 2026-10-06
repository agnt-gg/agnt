/**
 * The Plugin Forge chat panel is Widget Forge's chat, wired to the plugin
 * surface. Pinned: it mounts the real chat container on the plugin channel
 * with the draft as page state, and sends what the Forge pane asks it to.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import pluginBuilder from '@/store/features/pluginBuilder.js';
import { askPluginForge } from '@/composables/chat/usePluginChatContext.js';
import PluginForgePanel from './PluginForgePanel.vue';

const executeSuggestion = vi.fn();
const ChatStub = {
  name: 'UnifiedChatContainer',
  props: ['channelKey', 'chatType', 'pageContext', 'pageState', 'onFrontendEvent'],
  template: '<div class="chat-stub" />',
  methods: { executeSuggestion },
};

function mountPanel() {
  const store = createStore({
    modules: {
      pluginBuilder: { ...pluginBuilder, state: () => JSON.parse(JSON.stringify(pluginBuilder.state)) },
      tools: { namespaced: true, actions: { fetchTools: vi.fn() } },
    },
  });
  return mount(PluginForgePanel, {
    global: {
      plugins: [store],
      stubs: { UnifiedChatContainer: ChatStub, SimpleModal: true, Tooltip: { template: '<div><slot /></div>' } },
    },
  });
}

// Every mounted panel listens on window; a test that leaves one mounted would
// answer the next test's asks.
enableAutoUnmount(afterEach);
beforeEach(() => executeSuggestion.mockClear());

describe('PluginForgePanel', () => {
  it('is a real chat on the plugin surface, carrying the draft', () => {
    const chat = mountPanel().findComponent(ChatStub);
    expect(chat.props('chatType')).toBe('plugin');
    expect(chat.props('channelKey')).toBe('plugin:plugin-forge');
    expect(chat.props('pageState')).toHaveProperty('pluginState.files');
    expect(typeof chat.props('onFrontendEvent')).toBe('function');
  });

  it('sends what the Forge pane asks, and stops listening when gone', () => {
    const wrapper = mountPanel();
    askPluginForge('  The Search tool failed with 401. Fix it.  ');
    expect(executeSuggestion).toHaveBeenCalledWith({ text: 'The Search tool failed with 401. Fix it.' });

    wrapper.unmount();
    executeSuggestion.mockClear();
    askPluginForge('after unmount');
    expect(executeSuggestion).not.toHaveBeenCalled();
  });

  it('ignores an empty ask', () => {
    mountPanel();
    executeSuggestion.mockClear();
    askPluginForge('   ');
    expect(executeSuggestion).not.toHaveBeenCalled();
  });
});
