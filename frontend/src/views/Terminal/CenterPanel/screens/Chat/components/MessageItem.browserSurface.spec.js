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

function mountBrowserMessage({ insideWidgetCanvas = false } = {}) {
  return mount(MessageItem, {
    props: {
      message: {
        id: 'm-browser',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't-browser', name: 'browser', args: { action: 'navigate' } }],
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
});
