/**
 * Browser presentation follows the chat surface.
 *
 * Standalone chat has no canvas, so its one live Browser card belongs in the
 * transcript. Workspace chat is already embedded beside a widget canvas; a
 * second inline viewer would duplicate the Browser widget and make two places
 * claim to be the live page.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  IMAP_EMAIL_DOMAIN: '',
  AI_PROVIDERS_CONFIG: {},
  DEPLOYMENT_CONFIG: {},
  default: {},
}));
vi.mock('@/assets/images/annie-avatar.png', () => ({ default: 'avatar.png' }));
vi.mock('highlight.js/styles/atom-one-dark.css', () => ({}));

import MessageItem from './MessageItem.vue';

const store = createStore({
  state: { agents: { agents: [] }, chat: { activeConversationId: null, conversations: {} } },
  modules: {},
});

function mountBrowserMessage({
  insideWidgetCanvas = false,
  toolCalls = [{ id: 't-browser', name: 'browser', args: { action: 'navigate' } }],
} = {}) {
  return mount(MessageItem, {
    props: {
      message: {
        id: 'm-browser',
        role: 'assistant',
        content: '',
        toolCalls,
      },
      imageCache: new Map(),
    },
    global: {
      plugins: [store],
      provide: { isInsideWidgetCanvas: insideWidgetCanvas },
      stubs: {
        ProviderSetup: true,
        GoalProgressWidget: true,
        Tooltip: true,
        Teleport: true,
        BrowserLiveCard: { template: '<div data-test="browser-live-card" />' },
      },
    },
  });
}

describe('MessageItem browser presentation', () => {
  it('shows the live Browser in standalone chat', () => {
    const wrapper = mountBrowserMessage();
    expect(wrapper.find('[data-test="browser-live-card"]').exists()).toBe(true);
  });

  it('leaves Browser presentation to the workspace canvas when embedded', () => {
    const wrapper = mountBrowserMessage({ insideWidgetCanvas: true });
    expect(wrapper.find('[data-test="browser-live-card"]').exists()).toBe(false);
  });

  // trace c59eb9e9: a script that read an environment variable mounted an
  // empty Live browser card. A browser CALL is not a browser PAGE.
  it('shows no card for a turn whose browser calls never had a page', () => {
    for (const toolCalls of [
      [{ id: 't1', name: 'browser', args: { action: 'script', python: 'print(1)' } }],
      [{ id: 't2', name: 'browser', args: { action: 'console' } }],
      [{ id: 't3', name: 'browser', args: { action: 'navigate', url: 'file:///C:/x.html' },
        result: { success: false, error: 'Refusing to navigate to a file: URL.' } }],
    ]) {
      const wrapper = mountBrowserMessage({ toolCalls });
      expect(wrapper.find('[data-test="browser-live-card"]').exists(), JSON.stringify(toolCalls)).toBe(false);
    }
  });
});
