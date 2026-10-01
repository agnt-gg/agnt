import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MessageItem from './MessageItem.vue';

/**
 * The edit affordance on the latest assistant reply: shown only when the
 * parent says so, edits only the closing text, Save (not Send), and plain
 * Enter is a newline because replies are multi-paragraph markdown.
 */

const makeStore = () =>
  createStore({
    modules: {
      agents: { namespaced: true, state: { agents: [] } },
      chat: { namespaced: true, state: { dataCache: new Map() } },
    },
  });

const reply = () => ({
  id: 'a1',
  role: 'assistant',
  content: 'Checking. Found it.',
  contentParts: [
    { type: 'text', text: 'Checking. ' },
    { type: 'tool_call', toolCallId: 'tc-1' },
    { type: 'text', text: 'Found it.' },
  ],
  toolCalls: [{ id: 'tc-1', name: 'web_search', args: {}, result: 'r' }],
  timestamp: Date.now(),
});

const mountItem = (props) =>
  mount(MessageItem, { props, global: { plugins: [makeStore()], stubs: { teleport: true } } });

describe('MessageItem reply editing', () => {
  it('shows no edit button on a reply unless the parent allows it', () => {
    expect(mountItem({ message: reply() }).find('.message-edit-btn').exists()).toBe(false);
    expect(mountItem({ message: reply(), canEditReply: true }).find('.message-edit-btn').exists()).toBe(true);
  });

  it('hides the button while the reply has a live status', () => {
    const wrapper = mountItem({ message: reply(), canEditReply: true, status: { type: 'thinking', text: '...' } });
    expect(wrapper.find('.message-edit-btn').exists()).toBe(false);
  });

  it('edits only the closing text, offers Save, and Enter inserts a newline', async () => {
    const wrapper = mountItem({ message: reply(), canEditReply: true });
    await wrapper.find('.message-edit-btn').trigger('click');

    const textarea = wrapper.find('textarea');
    expect(textarea.element.value).toBe('Found it.');
    expect(wrapper.find('.edit-send-btn').text()).toBe('Save');

    await textarea.setValue('Found it, twice.');
    await textarea.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('edit-reply')).toBeUndefined();

    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(wrapper.emitted('edit-reply')).toEqual([[{ messageId: 'a1', newContent: 'Found it, twice.' }]]);
    expect(wrapper.emitted('edit-message')).toBeUndefined();
  });

  it('leaves user-message editing unchanged: Enter sends via edit-message', async () => {
    const wrapper = mountItem({ message: { id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() } });
    await wrapper.find('.message-edit-btn').trigger('click');
    expect(wrapper.find('.edit-send-btn').text()).toBe('Send');
    await wrapper.find('textarea').setValue('hello');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('edit-message')).toEqual([[{ messageId: 'u1', newContent: 'hello' }]]);
  });
});
