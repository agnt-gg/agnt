// One turn, one writer — the round trip is not a free-for-all.
//
// WHY THIS FILE EXISTS
// --------------------
// Two independent mechanisms deliver the same turn to a client that did not
// start it:
//
//   1. the socket DELTA MIRROR (chat:message_start / chat:content_delta),
//      which is live but has no replay, so it is useless to a client that
//      arrived mid-run;
//   2. the SSE REPLAY (GET /orchestrator/runs/:id/stream), which hands back the
//      turn from conversation_started onward.
//
// Reattaching on a `run:started` announcement makes (2) the one that matters.
// But the decision to reattach and the arrival of the replay are separated by
// an HTTP round trip, and during it the mirror is still writing. The replay
// then starts from the beginning of the turn and applies the same content
// again — and neither mutation is idempotent: SCOPED_ADD_MESSAGE pushes
// without checking ids, SCOPED_APPEND_MESSAGE_CONTENT appends unconditionally.
// The visible result is a duplicated bubble containing duplicated prose.
//
// isStreaming cannot close that window: it is raised only when the server
// actually sends something, precisely so an idle page load does not flash a
// spinner. So the claim is its own flag, taken before the request goes out.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
vi.mock('@/services/chatService.js', () => ({
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
}));

import { reattachRun } from '@/services/chatService.js';

const CONV = 'conv-race';

let chat;
let state;
let commit;
let dispatch;

const makeState = () => ({
  activeConversationId: CONV,
  currentConversationId: null,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
  streamEventCallbacks: [],
  autosaveEnabled: true,
});

/** A socket delta mirror event, exactly as useRealtimeSync forwards it. */
const socketEvent = (type, extra = {}) => chat.actions.handleRealtimeChatEvent(
  { commit, state, dispatch },
  { type, conversationId: CONV, assistantMessageId: 'a1', ...extra },
);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  global.fetch = vi.fn();
  const mod = await import('./chat.js');
  chat = mod.default;
  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());
  chat.mutations.ENSURE_CONVERSATION(state, CONV);
});

describe('claiming a conversation for a reattach', () => {
  it('is claimed before the request goes out, not when the reply arrives', async () => {
    let release;
    reattachRun.mockImplementation(() => new Promise((r) => { release = r; }));

    const pending = chat.actions.reattachConversation({ commit, state, dispatch }, CONV);
    await Promise.resolve();

    // The request is still in flight and the server has sent nothing, so the
    // spinner is correctly still down — but the slot is already spoken for.
    expect(state.conversations[CONV].isReattaching).toBe(true);
    expect(state.conversations[CONV].isStreaming).toBe(false);

    release(true);
    await pending;
  });

  it('DROPS delta-mirror events that arrive during the round trip', async () => {
    let release;
    reattachRun.mockImplementation(() => new Promise((r) => { release = r; }));

    const pending = chat.actions.reattachConversation({ commit, state, dispatch }, CONV);
    await Promise.resolve();

    // Exactly the sequence that used to double-apply: the mirror announces the
    // assistant turn and streams prose the replay is about to deliver again.
    await socketEvent('message_start');
    await socketEvent('content_delta', { delta: 'Half an answer' });

    expect(state.conversations[CONV].messages).toHaveLength(0);

    release(true);
    await pending;
  });

  it('lets the replay be the single source of the turn', async () => {
    // The replay writes through the SSE path while the claim is held, so the
    // transcript contains the turn exactly once.
    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('assistant_message', { id: 'a1', role: 'assistant', content: '' });
      onEvent('content_delta', { assistantMessageId: 'a1', delta: 'Half an answer' });
      onEvent('content_delta', { assistantMessageId: 'a1', delta: ' and the rest.' });
      return true;
    });

    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    const messages = state.conversations[CONV].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Half an answer and the rest.');
  });

  it('releases the claim when the run was already over', async () => {
    // 204: nothing running. A claim that outlived its request would leave the
    // conversation permanently deaf to the mirror.
    reattachRun.mockResolvedValue(false);

    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(state.conversations[CONV].isReattaching).toBe(false);
  });

  it('releases the claim when the request fails', async () => {
    reattachRun.mockRejectedValue(new Error('network went away'));

    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(state.conversations[CONV].isReattaching).toBe(false);
  });

  it('accepts mirror events again once the claim is released', async () => {
    reattachRun.mockResolvedValue(false);
    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    await socketEvent('message_start');

    // Suppression is scoped to the reattach, not permanent: a later turn
    // started in another tab must still stream in here.
    expect(state.conversations[CONV].messages).toHaveLength(1);
  });
});

describe('one run, one reattach', () => {
  it('refuses a second reattach while one is in flight', async () => {
    let release;
    reattachRun.mockImplementation(() => new Promise((r) => { release = r; }));

    const first = chat.actions.reattachConversation({ commit, state, dispatch }, CONV);
    await Promise.resolve();

    // Two announcements for one run — or an announcement landing during boot
    // resume — would otherwise open two replays of the same turn into one slot.
    const second = await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(second).toBe(false);
    expect(reattachRun).toHaveBeenCalledTimes(1);

    release(true);
    await first;
  });

  it('still refuses while the conversation is streaming normally', async () => {
    chat.mutations.SCOPED_SET_STREAMING(state, { conversationId: CONV, value: true });

    expect(await chat.actions.reattachConversation({ commit, state, dispatch }, CONV)).toBe(false);
    expect(reattachRun).not.toHaveBeenCalled();
  });
});

describe('a claimed conversation is live for eviction purposes', () => {
  it('is not evicted to make room while its replay is in flight', () => {
    // ENSURE_CONVERSATION evicts the least recent idle conversation at
    // capacity. Evicting one mid-reattach aborts its controller and drops the
    // turn on the floor — the exact outcome this whole path exists to prevent.
    state.activeConversationId = 'other';
    chat.mutations.SCOPED_SET_REATTACHING(state, { conversationId: CONV, value: true });

    for (let i = 0; i < 60; i++) chat.mutations.ENSURE_CONVERSATION(state, `filler-${i}`);

    expect(state.conversations[CONV]).toBeDefined();
    expect(state.conversations[CONV].isReattaching).toBe(true);
  });
});
