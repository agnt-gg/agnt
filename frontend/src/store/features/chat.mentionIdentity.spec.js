// A TAGGED SEND MUST ADOPT THE SERVER'S CONVERSATION ID.
//
// WHY THIS FILE EXISTS
// --------------------
// Tagging an agent (@Fable ...) in a new chat produced a sidebar full of
// duplicates. The cause was one read-after-write in startStreamingConversation:
//
//   const existingConv = state.conversations[convId];      // same object ...
//   commit('SCOPED_SET_STREAMING', { ..., value: true });   // ... set here ...
//   const skipMigration = mentionedAgent && existingConv.isStreaming; // ... read here
//
// so EVERY tagged send — including the very first one in an idle, brand-new
// chat — decided it was a "concurrent" stream and skipped the temp-id ->
// server-id migration on `conversation_started`. The browser stayed on
// `temp-…`, which the wire encodes as "no conversationId", so each later turn
// (the next tag, the floor pass, the user's follow-up) was minted by the server
// as a NEW conversation. Any other signed-in client heard `run:started` for
// each of them and saved each one as its own chat.
//
// The concurrent-mention mode the flag served no longer exists: mentioned
// agents are sent sequentially, floor passes and steers dispatch only into an
// idle slot, and a submit during a live turn is a steer. These tests pin the
// invariant that replaced it: one stream owns a conversation, and that stream
// adopts the id the server minted for it.
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

/** The id a brand-new chat carries until the server names it. */
const TEMP = 'temp-1700000000000';
/** The id the server mints on the first turn. */
const SERVER = 'conv-server-uuid';
const FABLE = { id: 'agent-fable', name: 'Fable' };
const SOL = { id: 'agent-sol', name: 'Sol' };

let chat;
let state;
let commit;
let dispatch;
/** Parsed JSON bodies of every /orchestrator request, in send order. */
let requests;

const makeState = () => ({
  activeConversationId: TEMP,
  currentConversationId: TEMP,
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

/**
 * A minimal SSE turn: the server names the conversation, then finishes.
 * `onStart` runs when the first frame is read — i.e. while the turn is live —
 * so a test can act "mid-stream".
 */
function sseTurn(conversationId, onStart = () => {}) {
  const frames =
    `event: conversation_started\ndata: ${JSON.stringify({ conversationId })}\n\n` +
    `event: done\ndata: {}\n\n`;
  let delivered = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        cancel: vi.fn(),
        read: async () => {
          if (delivered) return { done: true, value: undefined };
          delivered = true;
          onStart();
          return { done: false, value: new TextEncoder().encode(frames) };
        },
      }),
    },
  };
}

const send = (conversationId, extra = {}) =>
  chat.actions.startStreamingConversation(
    { state, commit, dispatch, rootState: { aiProvider: {} } },
    { userInput: 'hello', provider: 'p', model: 'm', mentionedAgent: FABLE, conversationId, ...extra },
  );

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');

  requests = [];
  global.fetch = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    // The server keeps the id it is given and mints one otherwise.
    return sseTurn(body.conversationId || SERVER);
  });

  const mod = await import('./chat.js');
  chat = mod.default;

  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());

  chat.mutations.ENSURE_CONVERSATION(state, TEMP);
});

// ---------------------------------------------------------------------------

describe('a tagged send in a new chat', () => {
  it('adopts the server id — the slot is renamed, nothing is left under the temp id', async () => {
    const wroteTo = await send(TEMP);

    expect(wroteTo).toBe(SERVER);
    expect(state.conversations[TEMP]).toBeUndefined();
    expect(state.conversations[SERVER]).toBeDefined();
    expect(state.conversations[SERVER].conversationId).toBe(SERVER);
    expect(state.activeConversationId).toBe(SERVER);
    expect(commit).toHaveBeenCalledWith('MIGRATE_CONVERSATION_ID', { oldId: TEMP, newId: SERVER });
  });

  it('is saved under the server id, so every client dedupes onto one row', async () => {
    await send(TEMP);

    expect(dispatch).toHaveBeenCalledWith(
      'autosaveConversation',
      expect.objectContaining({ conversationId: SERVER }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      'autosaveConversation',
      expect.objectContaining({ conversationId: TEMP }),
    );
  });
});

describe('every later turn carries the server id on the wire', () => {
  it('threads one id through a second tag and a floor pass', async () => {
    let id = await send(TEMP);
    id = await send(id, { mentionedAgent: SOL });
    id = await send(id, { mentionedAgent: SOL, isFloorDispatch: true });

    expect(id).toBe(SERVER);
    // First send has no id to give; each one after it names the conversation.
    // The pre-fix wire was [undefined, undefined, undefined] — three conversations.
    expect(requests.map((r) => r.conversationId)).toEqual([undefined, SERVER, SERVER]);
    expect(Object.keys(state.conversations)).toEqual([SERVER]);
  });

  it('a follow-up without a tag continues the same conversation', async () => {
    const id = await send(TEMP);
    await send(id, { mentionedAgent: null });

    expect(requests.map((r) => r.conversationId)).toEqual([undefined, SERVER]);
  });
});

describe('the migration is addressed to the originating slot', () => {
  it('renames the slot that sent, not the chat the user switched to mid-stream', async () => {
    const OTHER = 'conv-other';
    global.fetch.mockImplementationOnce(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return sseTurn(SERVER, () => {
        chat.mutations.ENSURE_CONVERSATION(state, OTHER);
        chat.mutations.SET_ACTIVE_CONVERSATION(state, OTHER);
      });
    });

    expect(await send(TEMP)).toBe(SERVER);

    // Negative control: the selected chat is untouched.
    expect(state.activeConversationId).toBe(OTHER);
    expect(state.conversations[OTHER].conversationId).toBe(OTHER);
    // The sender's slot is the one that was renamed.
    expect(state.conversations[TEMP]).toBeUndefined();
    expect(state.conversations[SERVER].conversationId).toBe(SERVER);
  });
});

describe('one stream owns a conversation', () => {
  it('refuses a tagged send into a slot that is already streaming, without a request', async () => {
    state.conversations[TEMP].isStreaming = true;

    expect(await send(TEMP)).toBe(TEMP);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps a canonical id that already exists', async () => {
    chat.mutations.ENSURE_CONVERSATION(state, SERVER);

    expect(await send(SERVER)).toBe(SERVER);
    expect(requests[0].conversationId).toBe(SERVER);
    expect(commit).not.toHaveBeenCalledWith('MIGRATE_CONVERSATION_ID', expect.anything());
  });
});
