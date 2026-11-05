// Workspace / panel chats: Delete from here.
//
// The saved transcript is the system of record for hydration, so it is
// written at once; the provider log is cut too, for the fallback path.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(),
  toChatHistory: vi.fn(),
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
  saveReplyEdit: vi.fn(),
  truncateConversation: vi.fn(async () => ({ ok: true, status: 200 })),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

const CHANNEL = 'workspace:w1';

let chatUnified;
let truncateConversation;
let state;
let commit;
let dispatch;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  chatUnified = (await import('./chatUnified.js')).default;
  truncateConversation = (await import('@/services/chatService.js')).truncateConversation;
  truncateConversation.mockClear();
  state = {
    conversations: {
      [CHANNEL]: {
        conversationId: 'srv-9',
        messages: [
          { id: 'u1', role: 'user', content: 'Summarise.' },
          { id: 'a1', role: 'assistant', content: 'A summary.' },
          { id: 'u2', role: 'user', content: 'Shorter.' },
          { id: 'a2', role: 'assistant', content: 'Short.' },
        ],
      },
    },
    streamingChannels: {},
  };
  commit = vi.fn((type, payload) => chatUnified.mutations[type](state, payload));
  dispatch = vi.fn(() => Promise.resolve());
});

const del = (payload) => chatUnified.actions.deleteFromMessage({ commit, dispatch, state }, { channelKey: CHANNEL, ...payload });
const ids = () => state.conversations[CHANNEL].messages.map((m) => m.id);

describe('chatUnified deleteFromMessage', () => {
  it('cuts here and after, saves the transcript, and mirrors the cut', async () => {
    expect(await del({ messageId: 'a1' })).toEqual({ ok: true, removed: 3, serverSynced: true });
    expect(ids()).toEqual(['u1']);
    expect(dispatch).toHaveBeenCalledWith('saveChannelTranscript', { channelKey: CHANNEL });
    expect(truncateConversation).toHaveBeenCalledWith('srv-9', { anchorText: 'Summarise.', sameTextAfter: 0, mode: 'through' });
  });

  it('refuses to empty the channel or to run under a live turn', async () => {
    expect(await del({ messageId: 'u1' })).toEqual({ ok: false, reason: 'would-empty' });
    state.streamingChannels[CHANNEL] = true;
    expect(await del({ messageId: 'u2' })).toEqual({ ok: false, reason: 'streaming' });
    expect(commit).not.toHaveBeenCalled();
    expect(truncateConversation).not.toHaveBeenCalled();
  });
});
