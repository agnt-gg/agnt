import { describe, it, expect, vi } from 'vitest';
import { renameConversation, setConversationRead, setConversationArchived, deleteConversation } from './conversationActions.js';

const storeWith = (dispatch = vi.fn(() => Promise.resolve())) => ({ commit: vi.fn(), dispatch });

describe('conversation actions', () => {
  it('rename is optimistic and puts the old title back on failure', async () => {
    const ok = storeWith();
    await renameConversation(ok, { id: 'c', title: 'Old' }, '  New  ');
    expect(ok.commit).toHaveBeenCalledWith('contentOutputs/PATCH_OUTPUT', { id: 'c', updates: { title: 'New' } });
    expect(ok.dispatch).toHaveBeenCalledWith('chat/updateConversationTitle', { outputId: 'c', title: 'New' });

    const bad = storeWith(vi.fn(() => Promise.reject(new Error('500'))));
    await expect(renameConversation(bad, { id: 'c', title: 'Old' }, 'New')).rejects.toThrow('500');
    expect(bad.commit).toHaveBeenLastCalledWith('contentOutputs/PATCH_OUTPUT', { id: 'c', updates: { title: 'Old' } });
  });

  it('rename ignores a blank or unchanged title', async () => {
    const s = storeWith();
    await renameConversation(s, { id: 'c', title: 'Same' }, '   ');
    await renameConversation(s, { id: 'c', title: 'Same' }, 'Same');
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.dispatch).not.toHaveBeenCalled();
  });

  it('delete removes at once and restores the row on failure', async () => {
    const row = { id: 'c', title: 'Gone' };
    const bad = storeWith(vi.fn(() => Promise.reject(new Error('500'))));
    await expect(deleteConversation(bad, row)).rejects.toThrow('500');
    expect(bad.commit.mock.calls).toEqual([['contentOutputs/REMOVE_OUTPUT', 'c'], ['contentOutputs/ADD_OUTPUT', row]]);
  });

  it('read and archive go through the store actions that roll themselves back', async () => {
    const s = storeWith();
    await setConversationRead(s, 'c', true);
    await setConversationRead(s, 'c', false);
    await setConversationArchived(s, 'c', 1);
    expect(s.dispatch.mock.calls).toEqual([
      ['contentOutputs/markRead', 'c'],
      ['contentOutputs/markUnread', 'c'],
      ['contentOutputs/setArchived', { outputId: 'c', archived: true }],
    ]);
  });
});
