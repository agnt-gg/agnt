import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchConversation = vi.fn(async () => null);
const loadTranscriptByConversationId = vi.fn(async () => null);
const saveTranscript = vi.fn(async () => ({ ok: true, outputId: 'out-1', contentHash: 'h-saved' }));
const streamChat = vi.fn(async () => {});
const reattachRun = vi.fn(async () => false);
const pendingCatchUp = vi.fn(() => null);

vi.mock('@/services/chatService.js', () => ({
  streamChat: (...a) => streamChat(...a),
  toChatHistory: vi.fn((messages) => messages.map((m) => ({ role: m.role, content: m.content }))),
  reattachRun: (...a) => reattachRun(...a),
  cancelRun: vi.fn(async () => true),
  fetchConversation: (...a) => fetchConversation(...a),
  saveReplyEdit: vi.fn(),
}));
vi.mock('@/services/runResume.js', () => ({ pendingCatchUp: (...a) => pendingCatchUp(...a) }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(() => ({ provider: 'p', model: 'm' })),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(() => []),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/services/inflightRuns.js', () => ({ markRunStarted: vi.fn(), markRunEnded: vi.fn() }));
vi.mock('@/services/conversationTranscript.js', () => ({
  loadTranscriptByConversationId: (...a) => loadTranscriptByConversationId(...a),
  saveTranscript: (...a) => saveTranscript(...a),
  scopeTranscriptToChannel: vi.fn(async () => true),
  deriveTitle: (messages) => messages.find((m) => m.role === 'user')?.content || 'Untitled',
}));

const MAIN = 'orchestrator:main';
const CONV = 'conv-main';

let chatUnified;
let state;
let commit;
let dispatch;

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

const SYNCED = [
  { id: 'u1', role: 'user', content: 'build a landing page', timestamp: 1 },
  { id: 'a1', role: 'assistant', content: 'Started a sub-chat for the build.', timestamp: 2 },
];
const SERVER_AFTER_HANDOFF = [
  ...SYNCED,
  { id: 'u2', role: 'user', content: '[System: Sub-chat finished] Landing page rebuild', timestamp: 3 },
  { id: 'a2', role: 'assistant', content: 'Built and checked: Bramble & Bloom Coffee, a warm one-page landing page with menu, hours and a contact form.', timestamp: 4 },
];

const seed = (channelKey, extra = {}) => {
  state.conversations[channelKey] = {
    messages: SYNCED.map((m) => ({ ...m })),
    conversationId: CONV,
    suggestions: null,
    savedOutputId: 'out-1',
    savedContentHash: 'h-synced',
    lastUpdate: Date.now(),
    ...extra,
  };
};

const send = (content = 'and add a gallery') =>
  chatUnified.actions.sendMessage(
    { commit, dispatch, state, rootState: { aiProvider: {} } },
    { channelKey: MAIN, chatType: 'orchestrator', content },
  );

const assistantTexts = () => state.conversations[MAIN].messages.filter((m) => m.role === 'assistant').map((m) => m.content);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  fetchConversation.mockResolvedValue(null);
  loadTranscriptByConversationId.mockResolvedValue(null);
  saveTranscript.mockResolvedValue({ ok: true, outputId: 'out-1', contentHash: 'h-saved' });
  streamChat.mockResolvedValue(undefined);
  reattachRun.mockResolvedValue(false);
  pendingCatchUp.mockReturnValue(null);

  chatUnified = (await import('./chatUnified.js')).default;
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`Unknown mutation: ${type}`);
    fn(state, payload);
  };
  dispatch = vi.fn((type, payload) => chatUnified.actions[type]({ commit, state, dispatch, rootState: { aiProvider: {} } }, payload));
});

describe('catching chats up after the page was away', () => {
  it('refreshes only recent, idle chats that have a server conversation', async () => {
    seed(MAIN);
    seed('workspace:busy', { conversationId: 'conv-busy' });
    state.streamingChannels['workspace:busy'] = true;
    seed('workspace:old', { conversationId: 'conv-old', lastUpdate: Date.now() - 2 * 24 * 60 * 60 * 1000 });
    seed('artifact:new', { conversationId: null });
    seed('widget:temp', { conversationId: 'temp-123' });

    await dispatch('catchUpChannels');

    expect(loadTranscriptByConversationId.mock.calls.map(([id]) => id)).toEqual([CONV]);
  });

  it('adopts the turns the server finished while the phone slept, with their content hash', async () => {
    seed(MAIN);
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-1', messages: SERVER_AFTER_HANDOFF, contentHash: 'h-server' });

    const result = await dispatch('catchUpChannels');

    expect(result).toEqual({ checked: 1, updated: 1 });
    expect(assistantTexts().at(-1)).toMatch(/Bramble & Bloom/);
    expect(state.conversations[MAIN].savedContentHash).toBe('h-server');
  });

  it('keeps a local transcript that says more, but records what the server holds', async () => {
    seed(MAIN, { messages: SERVER_AFTER_HANDOFF.map((m) => ({ ...m })) });
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-1', messages: SYNCED, contentHash: 'h-server-short' });

    await dispatch('catchUpChannels');

    expect(assistantTexts().at(-1)).toMatch(/Bramble & Bloom/);
    expect(state.conversations[MAIN].savedContentHash).toBe('h-server-short');
  });
});

describe('saving against what this client last synced', () => {
  it('sends the synced content hash and records the new one', async () => {
    seed(MAIN);
    await dispatch('saveChannelTranscript', { channelKey: MAIN });
    expect(saveTranscript.mock.calls[0][0].baseContentHash).toBe('h-synced');
    expect(state.conversations[MAIN].savedContentHash).toBe('h-saved');
  });

  it('a stale save adopts the turns it missed, keeps what was typed here, and saves once on top', async () => {
    seed(MAIN, { messages: [...SYNCED.map((m) => ({ ...m })), { id: 'u9', role: 'user', content: 'and add a gallery' }] });
    saveTranscript
      .mockResolvedValueOnce({ ok: false, error: 'stale', contentHash: 'h-server' })
      .mockResolvedValueOnce({ ok: true, outputId: 'out-1', contentHash: 'h-merged' });
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-1', messages: SERVER_AFTER_HANDOFF, contentHash: 'h-server' });

    const result = await dispatch('saveChannelTranscript', { channelKey: MAIN });

    expect(result).toMatchObject({ ok: true });
    expect(saveTranscript).toHaveBeenCalledTimes(2);
    expect(saveTranscript.mock.calls[1][0].baseContentHash).toBe('h-server');
    expect(state.conversations[MAIN].messages.map((m) => m.content).slice(-3)).toEqual([
      SERVER_AFTER_HANDOFF[2].content,
      SERVER_AFTER_HANDOFF[3].content,
      'and add a gallery',
    ]);
    expect(state.conversations[MAIN].savedContentHash).toBe('h-merged');
  });

  it('a stale save with nothing missing never writes over the stored copy, and never loops', async () => {
    seed(MAIN, { messages: SERVER_AFTER_HANDOFF.map((m) => ({ ...m })) });
    saveTranscript.mockResolvedValue({ ok: false, error: 'stale', contentHash: 'h-server' });
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-1', messages: SYNCED, contentHash: 'h-server' });

    const result = await dispatch('saveChannelTranscript', { channelKey: MAIN });

    expect(result).toMatchObject({ ok: false, error: 'stale' });
    expect(saveTranscript).toHaveBeenCalledTimes(1);
  });
});

describe('a turn whose stream dropped', () => {
  const partialStream = async ({ onEvent }) => {
    onEvent('conversation_started', { conversationId: CONV });
    onEvent('assistant_message', { id: 'a9' });
    onEvent('content_delta', { assistantMessageId: 'a9', delta: 'Working on the gall' });
  };

  it('rejoins the run when the server is still generating, with no error shown', async () => {
    seed(MAIN);
    streamChat.mockImplementationOnce(partialStream);
    reattachRun.mockImplementationOnce(async ({ onEvent }) => {
      onEvent('content_delta', { assistantMessageId: 'a9', delta: 'ery. Done: six photos added.' });
      onEvent('done', {});
      return true;
    });

    await send();

    expect(reattachRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId: CONV }));
    expect(assistantTexts().join(' ')).not.toMatch(/Sorry|connection dropped/);
  });

  it('adopts the finished transcript when the run already ended', async () => {
    seed(MAIN);
    streamChat.mockRejectedValueOnce(new TypeError('Load failed'));
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-1', messages: SERVER_AFTER_HANDOFF, contentHash: 'h-server' });

    await send();

    expect(reattachRun).toHaveBeenCalledTimes(2);
    expect(assistantTexts().at(-1)).toMatch(/Bramble & Bloom/);
    expect(assistantTexts().join(' ')).not.toMatch(/Sorry/);
  });

  it('says so only when nothing could be recovered', async () => {
    seed(MAIN);
    streamChat.mockRejectedValueOnce(new Error('network down'));

    await send();

    expect(assistantTexts().at(-1)).toBe('Sorry, I encountered an error: network down');
  });

  it('an error after a clean finish is still shown, without a recovery attempt', async () => {
    seed(MAIN);
    streamChat.mockImplementationOnce(async ({ onEvent }) => {
      onEvent('done', {});
      throw new Error('reader broke after done');
    });

    await send();

    expect(reattachRun).not.toHaveBeenCalled();
    expect(assistantTexts().at(-1)).toBe('Sorry, I encountered an error: reader broke after done');
  });

  it('a stream that ended cleanly is not recovered', async () => {
    seed(MAIN);
    streamChat.mockImplementationOnce(async ({ onEvent }) => {
      onEvent('assistant_message', { id: 'a9' });
      onEvent('content_delta', { assistantMessageId: 'a9', delta: 'Gallery added.' });
      onEvent('done', {});
    });

    await send();

    expect(reattachRun).not.toHaveBeenCalled();
  });

  it('a stream the user stopped is not recovered', async () => {
    seed(MAIN);
    streamChat.mockImplementationOnce(async ({ signal }) => {
      chatUnified.actions.stopStream({ commit, state }, { channelKey: MAIN });
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      if (signal.aborted) throw abort;
    });

    await send();

    expect(reattachRun).not.toHaveBeenCalled();
    expect(assistantTexts().join(' ')).not.toMatch(/Sorry|connection dropped/);
  });
});

describe('sending while a catch-up is still running', () => {
  it('waits for it, so the new turn is built on the turns the server finished', async () => {
    seed(MAIN);
    let finishCatchUp;
    pendingCatchUp.mockReturnValue(new Promise((resolve) => { finishCatchUp = resolve; }));
    streamChat.mockImplementationOnce(async ({ onEvent }) => onEvent('done', {}));

    const sending = send('and add a gallery');
    await Promise.resolve();
    expect(streamChat).not.toHaveBeenCalled();

    commit('SET_CONVERSATION', { channelKey: MAIN, conversation: { messages: SERVER_AFTER_HANDOFF, conversationId: CONV, savedOutputId: 'out-1' } });
    finishCatchUp();
    await sending;

    const sentHistory = streamChat.mock.calls[0][0].messages.map((m) => m.content);
    expect(sentHistory.some((c) => /Bramble & Bloom/.test(c))).toBe(true);
    expect(state.conversations[MAIN].messages.at(-1)).toMatchObject({ role: 'user', content: 'and add a gallery' });
  });
});
