import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MessageItem from './MessageItem.vue';

/**
 * Pins the stable-identity refactor: Chat.vue no longer clones every message
 * to bake expandedToolCalls onto it (that cloning forced every MessageItem to
 * re-render on every streaming chunk). Expansion state now arrives as a
 * separate prop keyed by message id — with a fallback to the legacy
 * message.expandedToolCalls shape still used by the other chat containers.
 */

const makeStore = () =>
  createStore({
    modules: {
      agents: { namespaced: true, state: { agents: [] } },
      chat: { namespaced: true, state: { dataCache: new Map() } },
    },
  });

const baseMessage = (overrides = {}) => ({
  id: 'msg-1',
  role: 'assistant',
  content: 'done',
  timestamp: Date.now(),
  toolCalls: [
    { id: 'tc-1', name: 'web_search', args: {}, result: 'r1' },
    { id: 'tc-2', name: 'web_scrape', args: {}, result: 'r2' },
  ],
  ...overrides,
});

const mountItem = (props) =>
  mount(MessageItem, {
    props,
    global: {
      plugins: [makeStore()],
      stubs: { teleport: true },
    },
  });

describe('MessageItem tool-call expansion source', () => {
  it('reads expansion from the separate expandedToolCalls prop (new path)', () => {
    const wrapper = mountItem({
      message: baseMessage(),
      expandedToolCalls: { 'msg-1': [1] },
    });
    expect(wrapper.vm.isExpanded(1)).toBe(true);
    expect(wrapper.vm.isExpanded(0)).toBe(false);
  });

  it('falls back to message.expandedToolCalls when the prop is absent (legacy containers)', () => {
    const wrapper = mountItem({
      message: baseMessage({ expandedToolCalls: [0] }),
    });
    expect(wrapper.vm.isExpanded(0)).toBe(true);
    expect(wrapper.vm.isExpanded(1)).toBe(false);
  });

  it('prop takes precedence over the legacy message field', () => {
    const wrapper = mountItem({
      message: baseMessage({ expandedToolCalls: [0] }),
      expandedToolCalls: { 'msg-1': [1] },
    });
    expect(wrapper.vm.isExpanded(1)).toBe(true);
    expect(wrapper.vm.isExpanded(0)).toBe(false);
  });
});
