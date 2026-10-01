// Workspace / panel chats: editing the latest assistant reply in place.
//
// The saved transcript must be written at once: hydration adopts whichever
// copy says MORE, so a shortening edit left unsaved would lose to the old
// words on the next load.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(),
  toChatHistory: vi.fn(),
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
  saveReplyEdit: vi.fn(async () => ({ ok: true, status: 200 })),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

const CHANNEL = 'workspace:w1';

let chatUnified;
let saveReplyEdit;
let state;
let commit;
let dispatch;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  chatUnified = (await import('./chatUnified.js')).default;
  saveReplyEdit = (await import('@/services/chatService.js')).saveReplyEdit;
  saveReplyEdit.mockClear();
  state = {
    conversations: {
      [CHANNEL]: {
        conversationId: 'srv-9',
        messages: [
          { id: 'u1', role: 'user', content: 'Summarise.' },
          { id: 'a1', role: 'assistant', content: 'A long summary.', contentParts: [{ type: 'text', text: 'A long summary.' }] },
        ],
      },
    },
    streamingChannels: {},
  };
  commit = vi.fn((type, payload) => chatUnified.mutations[type](state, payload));
  dispatch = vi.fn(() => Promise.resolve());
});

const edit = (payload) => chatUnified.actions.editLastReply({ commit, dispatch, state }, { channelKey: CHANNEL, ...payload });

describe('chatUnified editLastReply', () => {
  it('edits in place, saves the transcript, and mirrors to the server', async () => {
    expect(await edit({ messageId: 'a1', content: 'Short.' })).toEqual({ ok: true, serverSynced: true });
    const reply = state.conversations[CHANNEL].messages[1];
    expect(reply.content).toBe('Short.');
    expect(reply.contentParts).toEqual([{ type: 'text', text: 'Short.' }]);
    expect(dispatch).toHaveBeenCalledWith('saveChannelTranscript', { channelKey: CHANNEL });
    expect(saveReplyEdit).toHaveBeenCalledWith('srv-9', { previousText: 'A long summary.', content: 'Short.' });
  });

  it('refuses while the channel is streaming', async () => {
    state.streamingChannels[CHANNEL] = true;
    expect(await edit({ messageId: 'a1', content: 'Short.' })).toEqual({ ok: false, reason: 'streaming' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('refuses a reply the user has already answered', async () => {
    state.conversations[CHANNEL].messages.push({ id: 'u2', role: 'user', content: 'more' });
    expect(await edit({ messageId: 'a1', content: 'Short.' })).toEqual({ ok: false, reason: 'not-latest-reply' });
  });

  it('skips the server for a channel without a conversation id', async () => {
    state.conversations[CHANNEL].conversationId = null;
    expect(await edit({ messageId: 'a1', content: 'Short.' })).toEqual({ ok: true, serverSynced: false });
    expect(saveReplyEdit).not.toHaveBeenCalled();
  });
});
