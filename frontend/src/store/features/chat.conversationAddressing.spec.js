// A WRITE MUST CARRY ITS ADDRESS.
//
// WHY THIS FILE EXISTS
// --------------------
// Orchestrator turns were appearing inside agent chats. Not one bug — one
// shared variable, `state.activeConversationId`, used as an address book by
// three different paths that each already KNEW which conversation they meant:
//
//   1. handleRealtimeChatEvent re-addressed an event that NAMED a conversation
//      this client had no slot for onto `activeConversationId`. A socket event
//      for conversation X, arriving while the user looked at agent chat Y, was
//      committed into Y. Deltas, tool cards, async-tool results — all of it.
//
//   2. startAgentStreamingConversation had no conversationId parameter at all.
//      It resolved `activeConversationId` at dispatch time, so once that id had
//      drifted the agent's turn was written to the MAIN conversation — and,
//      because the outbound history is built from the target slot, the
//      orchestrator's transcript was handed to the agent as its own context.
//      That is real context bleed, not a display artifact.
//
//   3. SAVE_AGENT_CONVERSATION read the flat mirror (which follows the active
//      conversation), so it could cache some other chat's messages under an
//      agent's key and serve them back as that agent's history.
//
// chat.js already documents this exact defect class, in this exact file, from
// the floor-dispatch fix: "resolving the ACTIVE conversation at dispatch time
// is the cross-conversation bleed bug ... a write must carry its address, not
// look it up when it executes." That lesson was applied to one parameter and
// nowhere else. These tests hold every path to it.
//
// Each rule below has a NEGATIVE CONTROL: an assertion that the event did not
// land on the conversation that happened to be active. Without it a test that
// merely checks "the right slot got the write" still passes while the wrong
// slot gets a copy too.
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
vi.mock('@/services/voiceTurn.js', () => ({ consumeVoiceTurn: () => false }));

/** The orchestrator conversation — on screen, and therefore the bleed target. */
const MAIN = 'conv-main-uuid';
/** An agent conversation, after the server renamed it off `agent-<id>`. */
const AGENT_CONV = 'conv-agent-uuid';
const AGENT_ID = 'agent-42';
/** A conversation this client has no slot for. */
const UNKNOWN = 'conv-somewhere-else';

let chat;
let resolveRealtimeTarget;
let findAgentConversationId;
let state;
let commit;
let dispatch;

const makeState = () => ({
  activeConversationId: null,
  currentConversationId: null,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {},
  agentConversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
  streamEventCallbacks: [],
  autosaveEnabled: true,
  currentAgentId: null,
  currentAgentName: null,
  currentAgentAvatar: null,
  savedMainConversationId: null,
});

const realtime = (event) => chat.actions.handleRealtimeChatEvent({ commit, state, dispatch }, event);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  global.fetch = vi.fn();

  const mod = await import('./chat.js');
  chat = mod.default;
  resolveRealtimeTarget = mod.resolveRealtimeTarget;
  findAgentConversationId = mod.findAgentConversationId;

  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());
});

// ---------------------------------------------------------------------------

describe('resolveRealtimeTarget — the routing rule itself', () => {
  const withSlots = (ids, active = null) => ({
    conversations: Object.fromEntries(ids.map((id) => [id, { messages: [] }])),
    activeConversationId: active,
  });

  it('delivers a named event to the conversation it names', () => {
    const s = withSlots([MAIN, AGENT_CONV], AGENT_CONV);
    expect(resolveRealtimeTarget(s, { type: 'content_delta', conversationId: MAIN }))
      .toEqual({ conversationId: MAIN, create: false });
  });

  it('DROPS a mid-turn event for a conversation it has no slot for', () => {
    // THE BUG. This used to return the active conversation, which is how the
    // orchestrator's deltas got written into whatever chat was on screen.
    const s = withSlots([AGENT_CONV], AGENT_CONV);
    expect(resolveRealtimeTarget(s, { type: 'content_delta', conversationId: UNKNOWN })).toBeNull();
  });

  it('NEGATIVE CONTROL: an unknown conversation never resolves to the active one', () => {
    const s = withSlots([AGENT_CONV], AGENT_CONV);
    for (const type of ['content_delta', 'tool_end', 'async_tool_completed', 'autonomous_content_delta', 'message_end']) {
      const target = resolveRealtimeTarget(s, { type, conversationId: UNKNOWN });
      expect(target?.conversationId).not.toBe(AGENT_CONV);
      expect(target).toBeNull();
    }
  });

  it('creates a slot for a turn STARTING elsewhere — that is how another tab arrives', () => {
    const s = withSlots([AGENT_CONV], AGENT_CONV);
    for (const type of ['message_start', 'user_message', 'autonomous_message_start']) {
      expect(resolveRealtimeTarget(s, { type, conversationId: UNKNOWN }))
        .toEqual({ conversationId: UNKNOWN, create: true });
    }
  });

  it('an unnamed event may only touch the conversation on screen', () => {
    const s = withSlots([MAIN], MAIN);
    expect(resolveRealtimeTarget(s, { type: 'content_delta' }))
      .toEqual({ conversationId: MAIN, create: false });
  });

  it('drops an unnamed event when there is no active slot to apply it to', () => {
    expect(resolveRealtimeTarget(withSlots([]), { type: 'content_delta' })).toBeNull();
    expect(resolveRealtimeTarget(withSlots([], MAIN), { type: 'content_delta' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('an agent chat on screen is not a mailbox for other conversations', () => {
  beforeEach(() => {
    // The user is looking at an agent chat. Nothing here is streaming, so the
    // SSE-ownership guard cannot be what saves us.
    chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
    chat.mutations.SCOPED_SET_AGENT(state, {
      conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
    });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, AGENT_CONV);
    chat.mutations.SET_CURRENT_AGENT(state, { agentId: AGENT_ID, agentName: 'Scout' });

    // The agent's transcript already holds a message whose id COLLIDES with the
    // stray turn's. Assistant message ids are minted per turn, so this is what a
    // reattach or a replayed run looks like — and it is what makes these tests
    // discriminating: appending to a message id that does not exist is a no-op,
    // so without a live target the old behaviour would have looked correct.
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'a1', role: 'assistant', content: 'agent answer', timestamp: 1 },
    });
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'auto-1', role: 'assistant', content: 'agent follow-up', timestamp: 2 },
    });
  });

  const agentMessage = (id) => state.conversations[AGENT_CONV].messages.find((m) => m.id === id);

  it('does not receive an orchestrator content delta for an unknown conversation', async () => {
    await realtime({ type: 'content_delta', conversationId: UNKNOWN, assistantMessageId: 'a1', delta: ' NOT YOURS' });

    expect(agentMessage('a1').content).toBe('agent answer');
    expect(state.conversations[UNKNOWN]).toBeUndefined();
  });

  it('does not receive an orchestrator tool card for an unknown conversation', async () => {
    await realtime({
      type: 'tool_start', conversationId: UNKNOWN, assistantMessageId: 'a1',
      toolCall: { id: 'tc-9', name: 'execute_shell_command', args: {} },
    });

    expect(agentMessage('a1').toolCalls || []).toHaveLength(0);
  });

  it('does not receive an async tool card for an unknown conversation', async () => {
    // Async tool events carry no SSE counterpart and outlive the request that
    // started them, so they arrive here on a single tab, silently, every time.
    await realtime({
      type: 'async_tool_queued', conversationId: UNKNOWN, assistantMessageId: 'a1',
      executionId: 'exec-1', functionName: 'web_search', toolCallId: 'tc-1',
    });

    expect(state.conversations[AGENT_CONV].activeAsyncTools.size).toBe(0);
  });

  it('does not receive an autonomous follow-up for an unknown conversation', async () => {
    await realtime({
      type: 'autonomous_content_delta', conversationId: UNKNOWN,
      assistantMessageId: 'auto-1', delta: ' BACKGROUND WORK',
    });

    expect(agentMessage('auto-1').content).toBe('agent follow-up');
  });

  it('still applies events that genuinely name this conversation', async () => {
    // The guard must not be a blanket "ignore everything".
    await realtime({ type: 'content_delta', conversationId: AGENT_CONV, assistantMessageId: 'a1', delta: ' continues' });

    expect(agentMessage('a1').content).toBe('agent answer continues');
  });

  it('still adopts a turn STARTING in another conversation, without disturbing this one', async () => {
    await realtime({ type: 'message_start', conversationId: MAIN, assistantMessageId: 'm1' });
    await realtime({ type: 'content_delta', conversationId: MAIN, assistantMessageId: 'm1', delta: 'elsewhere' });

    expect(state.conversations[MAIN].messages[0].content).toBe('elsewhere');
    expect(state.conversations[AGENT_CONV].messages).toHaveLength(2);
    expect(agentMessage('a1').content).toBe('agent answer');
  });
});

// ---------------------------------------------------------------------------

describe('findAgentConversationId — the agent slot survives being renamed', () => {
  it('finds the slot by the agent that owns it', () => {
    const conversations = { [MAIN]: { agentId: null }, [AGENT_CONV]: { agentId: AGENT_ID } };
    expect(findAgentConversationId(conversations, AGENT_ID)).toBe(AGENT_CONV);
  });

  it('follows the slot through MIGRATE_CONVERSATION_ID', () => {
    // `agent-<id>` is only the slot's birth name: the server renames it on the
    // first turn. Reconstructing the birth name opened a fresh EMPTY chat on
    // every re-entry after turn one.
    chat.mutations.ENSURE_CONVERSATION(state, `agent-${AGENT_ID}`);
    chat.mutations.SCOPED_SET_AGENT(state, {
      conversationId: `agent-${AGENT_ID}`, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
    });
    chat.mutations.MIGRATE_CONVERSATION_ID(state, { oldId: `agent-${AGENT_ID}`, newId: AGENT_CONV });

    expect(findAgentConversationId(state.conversations, AGENT_ID)).toBe(AGENT_CONV);
    expect(state.conversations[`agent-${AGENT_ID}`]).toBeUndefined();
  });

  it('returns null rather than guessing', () => {
    expect(findAgentConversationId({}, AGENT_ID)).toBeNull();
    expect(findAgentConversationId({ [MAIN]: { agentId: null } }, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('an agent turn goes to the agent, wherever the user is looking', () => {
  beforeEach(() => {
    // The agent has an established conversation...
    chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
    chat.mutations.SCOPED_SET_AGENT(state, {
      conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
    });
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'a-old', role: 'assistant', content: 'agent history', timestamp: 1 },
    });

    // ...but the ACTIVE conversation has drifted to the orchestrator's, with a
    // transcript of its own. This is the state a reattach or a KeepAlive
    // remount can leave behind.
    chat.mutations.ENSURE_CONVERSATION(state, MAIN);
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: MAIN,
      message: { id: 'm-old', role: 'assistant', content: 'orchestrator history', timestamp: 2 },
    });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, MAIN);

    // Fail the request immediately: the error path commits to the SAME address
    // the turn was aimed at, which is exactly what is under test.
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  });

  it('writes to the explicit conversationId it was given', async () => {
    await chat.actions.startAgentStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { agentId: AGENT_ID, userInput: 'hi', conversationId: AGENT_CONV },
    );

    const agentMsgs = state.conversations[AGENT_CONV].messages;
    expect(agentMsgs.some((m) => m.metadata?.includes('Error'))).toBe(true);
    // NEGATIVE CONTROL: the drifted active conversation is untouched.
    expect(state.conversations[MAIN].messages).toHaveLength(1);
  });

  it('resolves the agent slot when no conversationId is passed', async () => {
    await chat.actions.startAgentStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { agentId: AGENT_ID, userInput: 'hi' },
    );

    expect(state.conversations[AGENT_CONV].messages.some((m) => m.metadata?.includes('Error'))).toBe(true);
    expect(state.conversations[MAIN].messages).toHaveLength(1);
  });

  it('sends the AGENT\'S history to the agent, never the orchestrator\'s', async () => {
    // The worst symptom of the old behaviour: buildChatHistory reads the target
    // slot, so a misaddressed turn fed the orchestrator's transcript to the
    // agent as its own context.
    global.fetch = vi.fn(async () => ({ ok: true, body: null }));

    await chat.actions.startAgentStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { agentId: AGENT_ID, userInput: 'hi' },
    );

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const sent = JSON.stringify(body.history);
    expect(sent).toContain('agent history');
    expect(sent).not.toContain('orchestrator history');
  });
});

// ---------------------------------------------------------------------------

describe('switchToAgentChat re-points a drifted active conversation', () => {
  beforeEach(() => {
    chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
    chat.mutations.SCOPED_SET_AGENT(state, {
      conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
    });
    chat.mutations.ENSURE_CONVERSATION(state, MAIN);
  });

  it('points at the agent slot even when currentAgentId already names this agent', () => {
    // The old early-return checked the agent id alone, so a drifted active id
    // survived the switch and every later write followed it.
    chat.mutations.SET_CURRENT_AGENT(state, { agentId: AGENT_ID, agentName: 'Scout' });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, MAIN);

    chat.actions.switchToAgentChat({ commit, state, dispatch }, { agentId: AGENT_ID, agentName: 'Scout' });

    expect(state.activeConversationId).toBe(AGENT_CONV);
  });

  it('is still a no-op when already correctly pointed', () => {
    chat.mutations.SET_CURRENT_AGENT(state, { agentId: AGENT_ID, agentName: 'Scout' });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, AGENT_CONV);
    commit.mockClear();

    chat.actions.switchToAgentChat({ commit, state, dispatch }, { agentId: AGENT_ID, agentName: 'Scout' });

    expect(commit).not.toHaveBeenCalled();
  });

  it('reuses the renamed slot instead of opening an empty one', () => {
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'a-old', role: 'assistant', content: 'agent history', timestamp: 1 },
    });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, MAIN);

    chat.actions.switchToAgentChat({ commit, state, dispatch }, { agentId: AGENT_ID, agentName: 'Scout' });

    expect(state.activeConversationId).toBe(AGENT_CONV);
    expect(state.conversations[`agent-${AGENT_ID}`]).toBeUndefined();
    expect(state.conversations[AGENT_CONV].messages[0].content).toBe('agent history');
  });
});

// ---------------------------------------------------------------------------

describe('SAVE_AGENT_CONVERSATION caches the agent, not the screen', () => {
  it('reads the agent\'s own slot rather than the flat mirror', () => {
    chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
    chat.mutations.SCOPED_SET_AGENT(state, {
      conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
    });
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: AGENT_CONV,
      message: { id: 'a-1', role: 'assistant', content: 'agent history', timestamp: 1 },
    });

    // The mirror is pointed at the orchestrator's conversation.
    chat.mutations.ENSURE_CONVERSATION(state, MAIN);
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: MAIN,
      message: { id: 'm-1', role: 'assistant', content: 'orchestrator history', timestamp: 2 },
    });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, MAIN);

    chat.mutations.SAVE_AGENT_CONVERSATION(state, { agentId: AGENT_ID });

    const cached = state.agentConversations[AGENT_ID];
    expect(cached.messages).toHaveLength(1);
    expect(cached.messages[0].content).toBe('agent history');
    // NEGATIVE CONTROL: the mirror's contents never entered the agent's cache.
    expect(JSON.stringify(cached.messages)).not.toContain('orchestrator history');
  });

  it('does not cache anything for an agent with no conversation', () => {
    chat.mutations.ENSURE_CONVERSATION(state, MAIN);
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: MAIN,
      message: { id: 'm-1', role: 'assistant', content: 'orchestrator history', timestamp: 1 },
    });
    chat.mutations.SET_ACTIVE_CONVERSATION(state, MAIN);

    chat.mutations.SAVE_AGENT_CONVERSATION(state, { agentId: 'agent-with-no-chat' });

    expect(state.agentConversations['agent-with-no-chat']).toBeUndefined();
  });
});
