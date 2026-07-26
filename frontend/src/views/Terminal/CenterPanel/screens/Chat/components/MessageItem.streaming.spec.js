/**
 * MessageItem — streaming code-block rendering.
 *
 * Guards the contract between the component and the markdown pipeline: while a
 * message is streaming, an unclosed fenced block must reach the DOM with its
 * declared language AND the data-streaming marker, so highlightCode() skips it.
 *
 * This is the test that pins the removal of the legacy incomplete-fence branch.
 * That branch intercepted any odd number of ``` fences and emitted a bare
 * <pre><code> with no language class, containing the literal ```lang line. It
 * bypassed the fence machinery entirely and forced highlight.js into whole-block
 * auto-detection on every debounce tick. If someone reintroduces it, the
 * "declared language" and "no fence marker leaked" assertions below fail.
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

function mountMessage({ content, status }) {
  return mount(MessageItem, {
    props: {
      message: { id: 'm1', role: 'assistant', content, toolCalls: [] },
      status,
      imageCache: new Map(),
    },
    global: {
      plugins: [store],
      stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true },
    },
  });
}

const OPEN_BLOCK = '```html\n<!DOCTYPE html>\n<html><body><h1>Hi</h1>';

describe('MessageItem streaming code blocks', () => {
  it('marks an unclosed block as streaming so it is not highlighted yet', () => {
    const w = mountMessage({ content: OPEN_BLOCK, status: { type: 'streaming', text: '' } });
    const code = w.element.querySelector('pre code');
    expect(code).toBeTruthy();
    expect(code.getAttribute('data-streaming')).toBe('true');
    w.unmount();
  });

  it('keeps the declared language on a streaming block', () => {
    const w = mountMessage({ content: OPEN_BLOCK, status: { type: 'streaming', text: '' } });
    const code = w.element.querySelector('pre code');
    expect(code.className).toContain('language-html');
    w.unmount();
  });

  it('does not leak the ``` fence line into the rendered block', () => {
    const w = mountMessage({ content: OPEN_BLOCK, status: { type: 'streaming', text: '' } });
    expect(w.element.querySelector('pre code').textContent).not.toContain('```');
    w.unmount();
  });

  it('drops the streaming marker once the block is closed', () => {
    const w = mountMessage({ content: OPEN_BLOCK + '</body></html>\n```', status: { type: 'streaming', text: '' } });
    const code = w.element.querySelector('pre code');
    expect(code.hasAttribute('data-streaming')).toBe(false);
    expect(code.className).toContain('language-html');
    w.unmount();
  });

  it('never marks anything as streaming on a completed message', () => {
    const w = mountMessage({ content: OPEN_BLOCK, status: null });
    const code = w.element.querySelector('pre code');
    expect(code.hasAttribute('data-streaming')).toBe(false);
    expect(code.className).toContain('language-html');
    w.unmount();
  });
});
