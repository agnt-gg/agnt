// Stream-death recovery — the contract that a dead SSE transport is NEVER
// shown to the user as a truncated, mid-word reply.
//
// The backend deliberately keeps runs alive when their socket closes
// (activeRuns.js) and persists the completed transcript in conversation_logs.
// So when the frontend's reader dies without a terminal event ('done'/'error'),
// the truth is on the server and the UI must go get it:
//
//   1. reattach  — run still live: replay + continue (GET /runs/:id/stream)
//   2. reconcile — run finished while deaf: adopt the server transcript
//   3. announce  — nothing recoverable: an explicit notice, never silence
//
// Also pinned here: deliberate user Stop must NOT trigger recovery, a normal
// 'done' must NOT trigger recovery, and a resumed run adopts a blank temp
// conversation so the user can SEE it (fork prevention).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { reattachRun, fetchConversation } from '@/services/chatService.js';

const CONV = 'conv-1';

let chat;
let state;
let commit;

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

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  global.fetch = vi.fn();
  const mod = await import('./chat.js');
  chat = mod.default;
  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  chat.mutations.ENSURE_CONVERSATION(state, CONV);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// recoverInterruptedStream — the recovery ladder
// ---------------------------------------------------------------------------
describe('recoverInterruptedStream', () => {
  /** Build a ctx whose dispatch routes reattachConversation to a stub. */
  const ctx = ({ reattachResult = false, reattachImpl = null } = {}) => {
    const dispatch = vi.fn((type) => {
      if (type === 'reattachConversation') {
        return reattachImpl ? reattachImpl() : Promise.resolve(reattachResult);
      }
      return Promise.resolve();
    });
    return { commit, state, dispatch };
  };

  it('temp- conversation ids are not recoverable (server never knew them)', async () => {
    const c = ctx();
    expect(await chat.actions.recoverInterruptedStream(c, { conversationId: 'temp-1' })).toBe(false);
    expect(c.dispatch).not.toHaveBeenCalled();
  });

  it('skips recovery while another concurrent stream owns the conversation', async () => {
    state.conversations[CONV]._activeStreams = 1;
    const c = ctx();
    expect(await chat.actions.recoverInterruptedStream(c, { conversationId: CONV })).toBe(false);
    expect(c.dispatch).not.toHaveBeenCalled();
  });

  it('prefers a live reattach and stops there', async () => {
    const c = ctx({ reattachResult: true });
    expect(await chat.actions.recoverInterruptedStream(c, { conversationId: CONV })).toBe(true);
    expect(c.dispatch).toHaveBeenCalledWith('reattachConversation', CONV);
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it('retries reattach once (backend restarts need a beat) before reconciling', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const c = ctx({ reattachImpl: () => Promise.resolve(++calls >= 2) });

    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);

    expect(calls).toBe(2);
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it('reconciles from the server transcript when the run already finished', async () => {
    vi.useFakeTimers();
    // Local: user turn + truncated assistant turn.
    state.conversations[CONV].messages = [
      { id: 'u1', role: 'user', content: 'question' },
      { id: 'a1', role: 'assistant', content: 'truncated mid-wo' },
    ];
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'the complete answer, all of it' },
      ],
    });

    const c = ctx({ reattachResult: false });
    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);

    const msgs = state.conversations[CONV].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe('the complete answer, all of it');
    // The reconciled truth is persisted immediately — the truncated version
    // must never survive as the saved transcript.
    expect(c.dispatch).toHaveBeenCalledWith('autosaveConversation', { debounce: false, conversationId: CONV });
  });

  it('NEVER lets a shorter (older) server transcript clobber local messages', async () => {
    vi.useFakeTimers();
    state.conversations[CONV].messages = [
      { id: 'u1', role: 'user', content: 'q1' },
      { id: 'a1', role: 'assistant', content: 'a1' },
      { id: 'u2', role: 'user', content: 'q2' },
      { id: 'a2', role: 'assistant', content: 'partial a2' },
    ];
    // Server only has the PREVIOUS completed turn — run still in limbo.
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
      ],
    });

    const c = ctx({ reattachResult: false });
    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);

    const msgs = state.conversations[CONV].messages;
    // Local content intact + an explicit interruption notice appended.
    expect(msgs[3].content).toBe('partial a2');
    expect(msgs[4].role).toBe('assistant');
    expect(msgs[4].metadata).toContain('Error');
    expect(msgs[4].content).toMatch(/lost mid-response/);
  });

  // The reconcile path reads the RAW PROVIDER transcript, where a tool-using
  // turn stores content as a block array. Recovering a tool-heavy turn used to
  // replace a good local reply with "[object Object]" — a recovery that
  // destroyed the thing it was recovering.
  it('recovers a tool-using turn as words, not as coerced objects', async () => {
    vi.useFakeTimers();
    state.conversations[CONV].messages = [
      { id: 'u1', role: 'user', content: 'move the windows' },
      { id: 'a1', role: 'assistant', content: 'Let me look' },
    ];
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: 'move the windows' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'read layout first' },
            { type: 'text', text: 'Let me look at the current layout first.' },
            { type: 'tool_use', id: 'toolu_01', name: 'get_canvas_state', input: {} },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done \u2014 chat slimmed to 3 columns.' }] },
      ],
    });

    const c = ctx({ reattachResult: false });
    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);

    const msgs = state.conversations[CONV].messages;
    // The tool-result turn is plumbing, not a user bubble.
    expect(msgs).toHaveLength(3);
    expect(msgs.some((m) => String(m.content).includes('[object Object]'))).toBe(false);
    expect(msgs[1].content).toBe('Let me look at the current layout first.');
    expect(msgs[1].toolCalls[0]).toMatchObject({ name: 'get_canvas_state', result: 'ok' });
    expect(msgs[2].content).toBe('Done \u2014 chat slimmed to 3 columns.');
  });

  it('refuses a remote transcript with MORE rows but less to say', async () => {
    vi.useFakeTimers();
    state.conversations[CONV].messages = [
      { id: 'u1', role: 'user', content: 'move the windows' },
      { id: 'a1', role: 'assistant', content: 'Done \u2014 chat slimmed to 3 columns, sim stretched to 9x8.' },
    ];
    // Three rows beats two on length; it says nothing. Whatever conversion
    // produced this, adopting it would be a downgrade.
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: '[object Object]' },
        { role: 'assistant', content: '[object Object],[object Object]' },
        { role: 'assistant', content: '[object Object]' },
      ],
    });

    const c = ctx({ reattachResult: false });
    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);

    const msgs = state.conversations[CONV].messages;
    expect(msgs[1].content).toBe('Done \u2014 chat slimmed to 3 columns, sim stretched to 9x8.');
  });

  it('announces instead of dying silently when nothing is recoverable', async () => {
    vi.useFakeTimers();
    fetchConversation.mockResolvedValue(null);

    const c = ctx({ reattachResult: false });
    const p = chat.actions.recoverInterruptedStream(c, { conversationId: CONV });
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);

    const msgs = state.conversations[CONV].messages;
    expect(msgs.at(-1).metadata).toContain('Error');
  });
});

// ---------------------------------------------------------------------------
// Send path — when recovery fires and when it must not
// ---------------------------------------------------------------------------
describe('startStreamingConversation stream-death detection', () => {
  const encoder = new TextEncoder();

  /** SSE stream mock: yields the given blocks, then ends (done). */
  const streamOf = (...blocks) => {
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < blocks.length) return { done: false, value: encoder.encode(blocks[i++]) };
            return { done: true };
          },
          cancel: vi.fn(),
        }),
      },
    };
  };

  const send = async (response) => {
    global.fetch.mockResolvedValue(response);
    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.startStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { userInput: 'hello', provider: 'p', model: 'm' },
    );
    return dispatch;
  };

  it('a stream that ends WITHOUT a terminal event triggers recovery', async () => {
    const dispatch = await send(streamOf('event: llm_chunk\ndata: {"content":"par"}\n\n'));
    expect(dispatch).toHaveBeenCalledWith('recoverInterruptedStream', { conversationId: CONV });
  });

  it('a stream that ends WITH done does NOT trigger recovery', async () => {
    const dispatch = await send(streamOf('event: done\ndata: {}\n\n'));
    expect(dispatch).not.toHaveBeenCalledWith('recoverInterruptedStream', expect.anything());
  });

  it('a stream that ends WITH error does NOT trigger recovery (server spoke — turn is over)', async () => {
    const dispatch = await send(streamOf('event: error\ndata: {"error":"provider exploded"}\n\n'));
    expect(dispatch).not.toHaveBeenCalledWith('recoverInterruptedStream', expect.anything());
  });

  it('a thrown read (network reset) triggers recovery', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => { throw new Error('ECONNRESET'); },
          cancel: vi.fn(),
        }),
      },
    });
    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.startStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { userInput: 'hello', provider: 'p', model: 'm' },
    );
    expect(dispatch).toHaveBeenCalledWith('recoverInterruptedStream', { conversationId: CONV });
  });

  it('user Stop (aborted controller) does NOT trigger recovery', async () => {
    // First read aborts the conversation's own controller (what Stop does),
    // then the reader reports done — a premature end, but a DELIBERATE one.
    global.fetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            state.conversations[CONV].streamAbortController?.abort();
            return { done: true };
          },
          cancel: vi.fn(),
        }),
      },
    });
    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.startStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { userInput: 'hello', provider: 'p', model: 'm' },
    );
    expect(dispatch).not.toHaveBeenCalledWith('recoverInterruptedStream', expect.anything());
  });

  it('an AbortError from the reader does NOT trigger recovery', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    global.fetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => { throw abortErr; },
          cancel: vi.fn(),
        }),
      },
    });
    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.startStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { userInput: 'hello', provider: 'p', model: 'm' },
    );
    expect(dispatch).not.toHaveBeenCalledWith('recoverInterruptedStream', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Fork prevention — a resumed run adopts a blank temp conversation
// ---------------------------------------------------------------------------
describe('reattachConversation adoption', () => {
  it('switches a blank temp active conversation to the resumed one', async () => {
    const tempId = 'temp-99';
    chat.mutations.ENSURE_CONVERSATION(state, tempId);
    chat.mutations.SET_ACTIVE_CONVERSATION(state, tempId);

    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('llm_chunk', { content: 'resuming…' });
      return true;
    });

    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(state.activeConversationId).toBe(CONV);
  });

  it('does NOT steal focus from a conversation the user is typing in', async () => {
    const tempId = 'temp-99';
    chat.mutations.ENSURE_CONVERSATION(state, tempId);
    chat.mutations.SET_ACTIVE_CONVERSATION(state, tempId);
    state.conversations[tempId].messages.push({ id: 'u1', role: 'user', content: 'new question' });

    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('llm_chunk', { content: 'resuming…' });
      return true;
    });

    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(state.activeConversationId).toBe(tempId);
  });

  it('does NOT switch away from a real (non-temp) active conversation', async () => {
    const otherId = 'conv-other';
    chat.mutations.ENSURE_CONVERSATION(state, otherId);
    chat.mutations.SET_ACTIVE_CONVERSATION(state, otherId);

    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('llm_chunk', { content: 'resuming…' });
      return true;
    });

    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.reattachConversation({ commit, state, dispatch }, CONV);

    expect(state.activeConversationId).toBe(otherId);
  });
});
