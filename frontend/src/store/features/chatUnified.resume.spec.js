/**
 * Reattaching a sidebar chat to a turn that outlived the page.
 *
 * The user-visible bug: start a message, refresh, and the answer is gone
 * forever. Three things had to be true for that, and these tests pin all three
 * being fixed:
 *   1. the server keeps generating and can replay (backend);
 *   2. the client knows a turn was in flight (inflightRuns);
 *   3. replaying does not duplicate the partial the client already persisted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const reattachRun = vi.fn();
const cancelRun = vi.fn(() => Promise.resolve(true));

vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(),
  toChatHistory: vi.fn(() => []),
  reattachRun: (...args) => reattachRun(...args),
  cancelRun: (...args) => cancelRun(...args),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(() => ({ provider: 'p', model: 'm' })),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(() => []),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({
  emitSteer: vi.fn(),
  emitClearSteer: vi.fn(),
}));

let chatUnified;
let handleStreamEvent;
let state;
const CH = 'agent:test';

const makeState = () => ({
  conversations: {},
  streamingChannels: {},
  loadingSuggestionsChannels: {},
  expandedToolCalls: {},
  runningToolCalls: {},
  messageStates: {},
  abortControllers: {},
  pendingSteers: {},
  imageCaches: {},
  dataCaches: {},
  _migrated: {},
});

/**
 * Drive the real mutations exactly as the store would, recording each one.
 *
 * The recording matters: some defects are purely transient (a spinner raised
 * and then cleared in the same call) and are invisible to an assertion that
 * only inspects final state.
 */
let committed;
const makeCommit = () => (type, payload) => {
  committed.push({ type, payload });
  const fn = chatUnified.mutations[type];
  if (!fn) throw new Error(`Unknown mutation: ${type}`);
  fn(state, payload);
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  const mod = await import('./chatUnified.js');
  chatUnified = mod.default;
  handleStreamEvent = mod.handleStreamEvent;
  state = makeState();
  committed = [];
});

describe('replaying a turn the client partially holds', () => {
  const seedPartialTurn = () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'u1', role: 'user', content: 'question' } });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'a1', role: 'assistant', content: '' } });
    commit('APPEND_MESSAGE_CONTENT', { channelKey: CH, messageId: 'a1', delta: 'half an ans' });
    return commit;
  };

  it('does not render the answer twice', () => {
    const commit = seedPartialTurn();

    // The server replays from the start of the turn, including the assistant
    // message the client already has a partial copy of.
    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'run_resumed',
      data: { userMessage: 'question', replayedMessageIds: ['a1'], startedAt: 1000 },
    });
    handleStreamEvent({
      commit, channelKey: CH, eventName: 'assistant_message', data: { id: 'a1' },
    });
    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'content_delta',
      data: { assistantMessageId: 'a1', delta: 'half an answer, now complete' },
    });

    const messages = state.conversations[CH].messages;
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(messages.find((m) => m.id === 'a1').content).toBe('half an answer, now complete');
  });

  it('keeps earlier completed turns untouched', () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'u1', role: 'user', content: 'first' } });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'a1', role: 'assistant', content: 'first answer' } });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'u2', role: 'user', content: 'second' } });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'a2', role: 'assistant', content: 'partial' } });

    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'run_resumed',
      data: { userMessage: 'second', replayedMessageIds: ['a2'] },
    });

    const messages = state.conversations[CH].messages;
    // Truncation is anchored on server-assigned ids, so it cannot reach back
    // into a prior turn no matter how the clocks disagree.
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(messages.find((m) => m.id === 'a1').content).toBe('first answer');
  });

  it('restores the question when the local snapshot predates the send', () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });

    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'run_resumed',
      data: { userMessage: 'a question never persisted locally', replayedMessageIds: [] },
    });

    const messages = state.conversations[CH].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'a question never persisted locally' });
  });

  it('does not duplicate a question the client already shows', () => {
    const commit = seedPartialTurn();
    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'run_resumed',
      data: { userMessage: 'question', replayedMessageIds: ['a1'] },
    });
    expect(state.conversations[CH].messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('drops nothing when the client holds none of the turn', () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'u1', role: 'user', content: 'old' } });
    commit('ADD_MESSAGE', { channelKey: CH, message: { id: 'a1', role: 'assistant', content: 'old answer' } });

    handleStreamEvent({
      commit,
      channelKey: CH,
      eventName: 'run_resumed',
      data: { userMessage: 'new question', replayedMessageIds: ['a99'] },
    });

    expect(state.conversations[CH].messages.map((m) => m.id)).toEqual(['u1', 'a1', expect.any(String)]);
    expect(state.conversations[CH].messages.at(-1).content).toBe('new question');
  });
});

describe('reattachChannel', () => {
  const dispatchReattach = (payload) =>
    chatUnified.actions.reattachChannel({ commit: makeCommit(), state }, payload);

  it('asks the server for the run and streams what it replays', async () => {
    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('run_resumed', { userMessage: 'q', replayedMessageIds: [] });
      onEvent('assistant_message', { id: 'a1' });
      onEvent('content_delta', { assistantMessageId: 'a1', delta: 'recovered text' });
      return true;
    });

    const result = await dispatchReattach({ channelKey: CH, conversationId: 'conv-1' });

    expect(result).toBe(true);
    expect(reattachRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1' }));
    expect(state.conversations[CH].messages.find((m) => m.id === 'a1').content).toBe('recovered text');
  });

  it('leaves no spinner when nothing was running', async () => {
    reattachRun.mockResolvedValue(false); // HTTP 204

    const result = await dispatchReattach({ channelKey: CH, conversationId: 'conv-1' });

    expect(result).toBe(false);
    expect(state.streamingChannels[CH]).toBeUndefined();

    // Final state alone cannot catch this: raising the spinner optimistically
    // and clearing it in `finally` leaves identical end state while flashing a
    // spinner on every page load. Assert it was never raised at all.
    const raised = committed.filter(
      (c) => c.type === 'SET_STREAMING' && c.payload.isStreaming === true,
    );
    expect(raised).toHaveLength(0);
  });

  it('clears streaming state after a replayed run finishes', async () => {
    reattachRun.mockImplementation(async ({ onEvent }) => {
      onEvent('assistant_message', { id: 'a1' });
      return true;
    });
    await dispatchReattach({ channelKey: CH, conversationId: 'conv-1' });
    expect(state.streamingChannels[CH]).toBeUndefined();
    expect(state.abortControllers[CH]).toBeUndefined();
  });

  it('does not fight an already-streaming channel', async () => {
    state.streamingChannels[CH] = true;
    const result = await dispatchReattach({ channelKey: CH, conversationId: 'conv-1' });
    expect(result).toBe(false);
    expect(reattachRun).not.toHaveBeenCalled();
  });

  it('survives a failed reattach without breaking the channel', async () => {
    reattachRun.mockRejectedValue(new Error('network down'));
    const result = await dispatchReattach({ channelKey: CH, conversationId: 'conv-1' });
    expect(result).toBe(false);
    expect(state.streamingChannels[CH]).toBeUndefined();
  });

  it('ignores a missing conversation id', async () => {
    expect(await dispatchReattach({ channelKey: CH, conversationId: null })).toBe(false);
    expect(reattachRun).not.toHaveBeenCalled();
  });
});

describe('Stop means stop on the server too', () => {
  it('asks the server to cancel, not just the local reader', async () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });
    commit('SET_CONVERSATION_ID', { channelKey: CH, conversationId: 'conv-1' });
    const controller = new AbortController();
    commit('REGISTER_ABORT_CONTROLLER', { channelKey: CH, controller });

    chatUnified.actions.stopStream({ commit, state }, { channelKey: CH });

    // Closing the socket no longer cancels generation, so without this call the
    // model would keep running (and billing) with its output thrown away.
    expect(cancelRun).toHaveBeenCalledWith('conv-1');
    expect(controller.signal.aborted).toBe(true);
  });

  it('still tears down locally when the conversation has no server id yet', () => {
    const commit = makeCommit();
    commit('INITIALIZE_CHANNEL', { channelKey: CH });
    const controller = new AbortController();
    commit('REGISTER_ABORT_CONTROLLER', { channelKey: CH, controller });

    expect(() => chatUnified.actions.stopStream({ commit, state }, { channelKey: CH })).not.toThrow();
    expect(cancelRun).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);
  });
});
