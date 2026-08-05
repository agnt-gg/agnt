// A workspace chat is saved like a main chat, or it is not saved.
//
// WHAT WENT WRONG
// ---------------
// The main chat writes its RENDERED transcript to content_outputs and reads it
// back verbatim. The unified chats — workspace, artifact, widget, workflow,
// tool — wrote to localStorage and rebuilt themselves on load from
// conversation_logs.full_history, the raw provider wire transcript.
//
// That is two distinct failures wearing one costume:
//
//   1. NOT DURABLE. localStorage is per-origin, per-device, silently evicted
//      under quota, and gone with site data. A conversation that a browser can
//      discard on its own initiative was never saved.
//   2. NOT THE SAME CONVERSATION. Rebuilding from the wire format is lossy by
//      construction, and it shipped two visible bugs in a row.
//
// These tests pin the fix at the level that matters: the transcript is written
// to the server at the end of every turn, and hydration reads THAT — falling
// back to the provider log only for conversations saved before any of this
// existed.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchConversation = vi.fn(async () => null);
const loadTranscriptByConversationId = vi.fn(async () => null);
const saveTranscript = vi.fn(async () => ({ ok: true, outputId: 'out-1' }));
const scopeTranscriptToChannel = vi.fn(async () => true);
const streamChat = vi.fn(async () => {});

vi.mock('@/services/chatService.js', () => ({
  streamChat: (...a) => streamChat(...a),
  toChatHistory: vi.fn(() => []),
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: (...a) => fetchConversation(...a),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(() => ({ provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(() => []),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({
  emitSteer: vi.fn(),
  emitClearSteer: vi.fn(),
}));
vi.mock('@/services/inflightRuns.js', () => ({
  markRunStarted: vi.fn(),
  markRunEnded: vi.fn(),
}));
vi.mock('@/services/conversationTranscript.js', () => ({
  loadTranscriptByConversationId: (...a) => loadTranscriptByConversationId(...a),
  saveTranscript: (...a) => saveTranscript(...a),
  scopeTranscriptToChannel: (...a) => scopeTranscriptToChannel(...a),
  deriveTitle: (messages) => messages.find((m) => m.role === 'user')?.content || 'Untitled',
}));

const CH = 'workspace:ws-1';
const CONV = 'conv-1';

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

/** One tool-using answer, as it sits in memory after streaming. */
const TURN = [
  { id: 'u1', role: 'user', content: 'make the sim bigger', timestamp: 1 },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Done — 9×8. 🛫',
    timestamp: 2,
    contentParts: [{ type: 'tool_call', toolCallId: 't1' }, { type: 'text', text: 'Done — 9×8. 🛫' }],
    toolCalls: [{ id: 't1', name: 'move_canvas_widget', status: 'completed', result: 'ok' }],
  },
];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  loadTranscriptByConversationId.mockResolvedValue(null);
  saveTranscript.mockResolvedValue({ ok: true, outputId: 'out-1' });
  scopeTranscriptToChannel.mockResolvedValue(true);
  fetchConversation.mockResolvedValue(null);

  chatUnified = (await import('./chatUnified.js')).default;
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`Unknown mutation: ${type}`);
    fn(state, payload);
  };
  dispatch = vi.fn((type, payload) =>
    chatUnified.actions[type]({ commit, state, dispatch, rootState: {} }, payload));
});

const seed = (messages, extra = {}) => {
  state.conversations[CH] = {
    messages,
    conversationId: CONV,
    suggestions: [],
    savedOutputId: null,
    lastUpdate: Date.now(),
    ...extra,
  };
};

const save = (opts = {}) =>
  chatUnified.actions.saveChannelTranscript({ commit, state }, { channelKey: CH, ...opts });

const hydrate = () =>
  chatUnified.actions.hydrateWorkspaceChannel({ commit, state, dispatch }, { channelKey: CH });

describe('the transcript is written to the server', () => {
  it('saves the rendered messages, not a reconstruction', async () => {
    seed(TURN);
    await save();

    expect(saveTranscript).toHaveBeenCalledTimes(1);
    const arg = saveTranscript.mock.calls[0][0];
    expect(arg.conversationId).toBe(CONV);
    expect(arg.messages).toBe(state.conversations[CH].messages);
    expect(arg.title).toBe('make the sim bigger');
  });

  it('remembers the row id so the next save UPDATES instead of duplicating', async () => {
    seed(TURN);
    await save();
    expect(state.conversations[CH].savedOutputId).toBe('out-1');

    await save();
    expect(saveTranscript.mock.calls[1][0].outputId).toBe('out-1');
  });

  it('does not save a channel that has no conversation yet', async () => {
    seed(TURN, { conversationId: null });
    expect(await save()).toEqual({ ok: false, reason: 'no_conversation_id' });
    expect(saveTranscript).not.toHaveBeenCalled();
  });

  it('does not create a row for a channel showing only its welcome message', async () => {
    seed([{ id: 'w', role: 'assistant', content: '' }]);
    expect(await save()).toEqual({ ok: false, reason: 'empty' });
    expect(saveTranscript).not.toHaveBeenCalled();
  });

  it('saves at the end of a turn — including a turn that errored', async () => {
    streamChat.mockRejectedValueOnce(new Error('backend died'));
    state.conversations[CH] = {
      messages: [], conversationId: CONV, suggestions: [], savedOutputId: null, lastUpdate: 0,
    };

    await chatUnified.actions.sendMessage(
      { commit, dispatch, state, rootState: { aiProvider: {} } },
      { channelKey: CH, chatType: 'orchestrator', content: 'hi' },
    );

    // An interrupted answer is still the user's conversation.
    expect(dispatch).toHaveBeenCalledWith('saveChannelTranscript', { channelKey: CH });
    expect(saveTranscript).toHaveBeenCalled();
  });
});

describe('a channel transcript belongs to its channel, not to the chat list', () => {
  it('saves the owning channel with the transcript', async () => {
    seed(TURN);
    await save();
    // The main chat sidebar lists every content_outputs row the user owns and
    // has no type filter, so a transcript that does not name its owner is
    // shown as one of their conversations.
    expect(saveTranscript.mock.calls[0][0].channelKey).toBe(CH);
  });

  it('names the right channel for every embedded surface', async () => {
    for (const channelKey of ['artifact:a-1', 'widget:w-1', 'workflow:f-1', 'tool:t-1']) {
      state.conversations[channelKey] = {
        messages: TURN, conversationId: `c-${channelKey}`, suggestions: [], savedOutputId: null, lastUpdate: 0,
      };
      await chatUnified.actions.saveChannelTranscript({ commit, state }, { channelKey });
      expect(saveTranscript.mock.calls.at(-1)[0].channelKey).toBe(channelKey);
    }
  });
});

describe('reclaimChannelScopes — repairing rows saved before scope existed', () => {
  const reclaim = () => chatUnified.actions.reclaimChannelScopes({ state });

  it('scopes every channel this device knows about', async () => {
    seed(TURN, { savedOutputId: 'out-ws' });
    state.conversations['widget:w-1'] = {
      messages: TURN, conversationId: 'c-w', savedOutputId: 'out-widget', suggestions: [], lastUpdate: 0,
    };

    const res = await reclaim();

    expect(res).toMatchObject({ ok: true, scoped: 2, total: 2 });
    expect(scopeTranscriptToChannel).toHaveBeenCalledWith('out-ws', CH);
    expect(scopeTranscriptToChannel).toHaveBeenCalledWith('out-widget', 'widget:w-1');
  });

  it('runs once, not on every launch', async () => {
    seed(TURN, { savedOutputId: 'out-ws' });
    await reclaim();
    scopeTranscriptToChannel.mockClear();

    expect(await reclaim()).toMatchObject({ reason: 'already_done' });
    expect(scopeTranscriptToChannel).not.toHaveBeenCalled();
  });

  it('retries next launch when a row could not be reached', async () => {
    // Offline at launch must not record a repair that never happened.
    seed(TURN, { savedOutputId: 'out-ws' });
    scopeTranscriptToChannel.mockResolvedValue(false);

    expect(await reclaim()).toMatchObject({ scoped: 0, total: 1 });

    scopeTranscriptToChannel.mockResolvedValue(true);
    expect(await reclaim()).toMatchObject({ scoped: 1, total: 1 });
  });

  it('skips channels with nothing saved yet', async () => {
    seed(TURN, { savedOutputId: null });
    expect(await reclaim()).toMatchObject({ reason: 'nothing_to_scope', scoped: 0 });
    expect(scopeTranscriptToChannel).not.toHaveBeenCalled();
  });
});

describe('hydration prefers the saved transcript', () => {
  it('restores exactly what was saved and never touches the provider log', async () => {
    seed([]);
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-7', title: 'T', messages: TURN });

    const res = await hydrate();

    expect(res).toMatchObject({ ok: true, reason: 'hydrated', source: 'transcript' });
    expect(fetchConversation).not.toHaveBeenCalled();
    const msgs = state.conversations[CH].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].contentParts.map((p) => p.type)).toEqual(['tool_call', 'text']);
    expect(state.conversations[CH].savedOutputId).toBe('out-7');
  });

  it('keeps a richer local transcript rather than overwriting it with a stale save', async () => {
    seed(TURN);
    loadTranscriptByConversationId.mockResolvedValue({
      outputId: 'out-7',
      messages: [{ id: 'u1', role: 'user', content: 'make the sim bigger' }],
    });

    expect(await hydrate()).toMatchObject({ ok: true, reason: 'local_newer_or_equal' });
    expect(state.conversations[CH].messages).toHaveLength(2);
  });

  it('adopts the saved row id even when it keeps the local copy', async () => {
    seed(TURN);
    loadTranscriptByConversationId.mockResolvedValue({ outputId: 'out-7', messages: [TURN[0]] });

    await hydrate();
    // Without this the next save would INSERT a second row for one conversation.
    expect(state.conversations[CH].savedOutputId).toBe('out-7');
  });
});

describe('the provider log is the fallback, and it heals itself', () => {
  it('rebuilds from the log only when nothing was ever saved', async () => {
    seed([]);
    loadTranscriptByConversationId.mockResolvedValue(null);
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: 'make the sim bigger' },
        { role: 'assistant', content: [{ type: 'text', text: 'Done — 9×8. 🛫' }] },
      ],
    });

    const res = await hydrate();
    expect(res).toMatchObject({ ok: true, reason: 'hydrated', source: 'provider_log' });
    expect(state.conversations[CH].messages).toHaveLength(2);
  });

  it('saves what it rebuilt, so that conversation is never reconstructed twice', async () => {
    seed([]);
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    });

    await hydrate();
    expect(dispatch).toHaveBeenCalledWith('saveChannelTranscript', { channelKey: CH });
    expect(saveTranscript).toHaveBeenCalled();
  });
});

describe('durability is not workspace-only', () => {
  it('hydrates any unified channel that has a conversation id', async () => {
    // Every one of these surfaces was localStorage-only. A widget-builder chat
    // is no less the user's conversation than a workspace chat is.
    for (const channelKey of ['artifact:a-1', 'widget:w-1', 'workflow:f-1', 'tool:t-1']) {
      state.conversations[channelKey] = {
        messages: [], conversationId: `c-${channelKey}`, suggestions: [], savedOutputId: null, lastUpdate: 0,
      };
      loadTranscriptByConversationId.mockResolvedValue({ outputId: `o-${channelKey}`, messages: TURN });

      const res = await chatUnified.actions.hydrateWorkspaceChannel(
        { commit, state, dispatch }, { channelKey },
      );
      expect(res).toMatchObject({ ok: true, source: 'transcript' });
      expect(state.conversations[channelKey].messages).toHaveLength(2);
    }
  });

  it('still refuses to hydrate a channel with no conversation at all', async () => {
    state.conversations['artifact:a-2'] = {
      messages: [], conversationId: null, suggestions: [], savedOutputId: null, lastUpdate: 0,
    };
    const res = await chatUnified.actions.hydrateWorkspaceChannel(
      { commit, state, dispatch }, { channelKey: 'artifact:a-2' },
    );
    expect(res).toEqual({ ok: false, reason: 'no_conversation_id' });
    expect(loadTranscriptByConversationId).not.toHaveBeenCalled();
  });
});
