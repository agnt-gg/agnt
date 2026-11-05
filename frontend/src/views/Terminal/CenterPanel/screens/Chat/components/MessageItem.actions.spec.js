import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MessageItem from './MessageItem.vue';

/**
 * The action row under a message: Copy and Edit as before, plus whichever of
 * Regenerate / Fork / Delete the parent handles for that message. Delete is
 * two clicks; the first says how much goes and lapses on its own.
 */

const makeStore = () =>
  createStore({
    modules: {
      agents: { namespaced: true, state: { agents: [] } },
      chat: { namespaced: true, state: { dataCache: new Map() } },
    },
  });

const user = () => ({ id: 'u1', role: 'user', content: 'Find the bug.', timestamp: Date.now() });
const reply = () => ({ id: 'a1', role: 'assistant', content: 'It is in **parse()**.', timestamp: Date.now() });
const ALL = ['regenerate', 'fork', 'delete'];

const mountItem = (props) =>
  mount(MessageItem, { props, global: { plugins: [makeStore()], stubs: { teleport: true } } });
const buttons = (wrapper) => wrapper.findAll('.message-actions .message-action-btn').map((b) => b.attributes('aria-label'));

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('MessageItem actions', () => {
  it('shows Copy and Edit on a user message when the parent handles nothing more', () => {
    expect(buttons(mountItem({ message: user() }))).toEqual(['Copy', 'Edit & resend']);
  });

  it('shows only what the parent handles for this message', () => {
    expect(buttons(mountItem({ message: user(), branchActions: ALL }))).toEqual(['Copy', 'Edit & resend', 'Fork from here', 'Delete from here']);
    expect(buttons(mountItem({ message: reply(), branchActions: ALL }))).toEqual(['Copy', 'Regenerate', 'Fork from here', 'Delete from here']);
    expect(buttons(mountItem({ message: reply(), branchActions: ['fork'] }))).toEqual(['Copy', 'Fork from here']);
  });

  it('shows nothing while the message is still being written', () => {
    const wrapper = mountItem({ message: reply(), branchActions: ALL, status: { type: 'thinking', text: '...' } });
    expect(wrapper.find('.message-actions').exists()).toBe(false);
  });

  it('copies the message as written and confirms with a check that clears', async () => {
    const wrapper = mountItem({ message: reply() });
    await wrapper.find('.message-copy-btn').trigger('click');
    await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('It is in **parse()**.');
    expect(wrapper.find('.message-copy-btn i').classes()).toContain('fa-check');
    await vi.advanceTimersByTimeAsync(1300);
    expect(wrapper.find('.message-copy-btn i').classes()).toContain('fa-copy');
  });

  it('says so when the clipboard refuses', async () => {
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountItem({ message: reply() });
    await wrapper.find('.message-copy-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('.message-copy-btn').attributes('aria-label')).toBe('Could not copy');
  });

  it('emits regenerate and fork with the message id', async () => {
    const wrapper = mountItem({ message: reply(), branchActions: ALL });
    await wrapper.find('.message-regenerate-btn').trigger('click');
    await wrapper.find('.message-fork-btn').trigger('click');
    expect(wrapper.emitted('regenerate-message')).toEqual([[{ messageId: 'a1' }]]);
    expect(wrapper.emitted('fork-message')).toEqual([[{ messageId: 'a1' }]]);
  });

  it('deletes on the second click only, after saying how much goes', async () => {
    const wrapper = mountItem({ message: user(), branchActions: ALL, deleteCount: 4 });
    await wrapper.find('.message-delete-btn').trigger('click');
    expect(wrapper.emitted('delete-message')).toBeUndefined();
    expect(wrapper.find('.message-delete-btn').classes()).toContain('armed');
    expect(wrapper.find('.message-action-confirm').text()).toBe('Delete 4?');

    await wrapper.find('.message-delete-btn').trigger('click');
    expect(wrapper.emitted('delete-message')).toEqual([[{ messageId: 'u1' }]]);
    expect(wrapper.find('.message-action-confirm').exists()).toBe(false);
  });

  it('lets an armed delete lapse, so a later click starts over', async () => {
    const wrapper = mountItem({ message: user(), branchActions: ALL, deleteCount: 1 });
    await wrapper.find('.message-delete-btn').trigger('click');
    expect(wrapper.find('.message-action-confirm').text()).toBe('Delete?');
    await vi.advanceTimersByTimeAsync(3100);
    expect(wrapper.find('.message-action-confirm').exists()).toBe(false);
    await wrapper.find('.message-delete-btn').trigger('click');
    expect(wrapper.emitted('delete-message')).toBeUndefined();
  });

  it('another action disarms a pending delete', async () => {
    const wrapper = mountItem({ message: reply(), branchActions: ALL });
    await wrapper.find('.message-delete-btn').trigger('click');
    await wrapper.find('.message-fork-btn').trigger('click');
    expect(wrapper.find('.message-delete-btn').classes()).not.toContain('armed');
  });

  it('hides the row while the message is being edited', async () => {
    const wrapper = mountItem({ message: user(), branchActions: ALL });
    await wrapper.find('.message-edit-btn').trigger('click');
    expect(wrapper.find('.message-actions').exists()).toBe(false);
    expect(wrapper.find('.message-edit-textarea').exists()).toBe(true);
  });
});
