// The sender must not hear its own echo — on the FIRST message too.
//
// WHY THIS FILE EXISTS
// --------------------
// Every turn is written to the sender twice by design: once down the SSE
// connection it opened, and once over the socket delta mirror that exists so a
// user's OTHER tabs stay in sync. The sender is in its own broadcast room, so
// it must recognise and drop the mirror copy.
//
// The guard that did that keyed on conversation id: "is the slot this event
// names already streaming here?". That question is unanswerable on the first
// message of a NEW conversation, and the reason is a race the codebase already
// documents in clientId.js:
//
//   - the sender's local slot is keyed by a TEMP id (`temp-<now>`, chat.js) and
//     is renamed by MIGRATE_CONVERSATION_ID only when `conversation_started`
//     arrives over SSE;
//   - the mirror events travel on the socket, a DIFFERENT transport, carrying
//     the server's REAL conversation id;
//   - the two are unordered, so the mirror can name an id this client has not
//     learned yet.
//
// `state.conversations[realId]` is then undefined, `targetConv` is null, the
// ownership guard cannot fire, and ten lines later ENSURE_CONVERSATION builds a
// SECOND slot and streams the same answer into it. Two assistant bubbles for
// one question, on the first message of every chat, and — because
// MIGRATE_CONVERSATION_ID later renames the temp slot onto the same id — one of
// the two live streams writing into a slot the UI has half-detached.
//
// From message two onward the ids match, the guard fires, and it is invisible.
// That is exactly why identity, not id, has to be the discriminator: the
// answer is already in the repo (clientId.js / isOwnAnnouncement) and was wired
// into `run:started` only. These tests hold the mirror to the same contract.
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

/** The id the server assigned. The sender does not know it yet. */
const REAL = 'conv-server-uuid';
/** What the sender's own slot is still called at this instant. */
const TEMP = 'temp-1700000000000';

let chat;
let state;
let commit;
let dispatch;
let getClientId;

const makeState = () => ({
  activeConversationId: TEMP,
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

/** A delta-mirror event exactly as useRealtimeSync forwards it. */
const mirror = (type, extra = {}) => chat.actions.handleRealtimeChatEvent(
  { commit, state, dispatch },
  { type, conversationId: REAL, assistantMessageId: 'a1', ...extra },
);

/** The same event, stamped by the server with who sent the request. */
const ownMirror = (type, extra = {}) => mirror(type, { originClientId: getClientId(), ...extra });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  global.fetch = vi.fn();

  ({ getClientId } = await import('@/services/clientId.js'));
  const mod = await import('./chat.js');
  chat = mod.default;

  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());

  // The sender's world at the moment the first mirror event lands: a slot it
  // opened under a temp id, already streaming over its own SSE connection.
  chat.mutations.ENSURE_CONVERSATION(state, TEMP);
  chat.mutations.SCOPED_SET_STREAMING(state, { conversationId: TEMP, value: true });
});

describe('the first message of a new conversation', () => {
  it('drops the mirror copy of a turn this client is already streaming', async () => {
    await ownMirror('message_start');
    await ownMirror('content_delta', { delta: 'The answer.' });

    // The defect: a second slot, holding a second copy of the same turn.
    expect(state.conversations[REAL]).toBeUndefined();
    expect(Object.keys(state.conversations)).toEqual([TEMP]);
  });

  it('leaves the SSE-owned slot untouched', async () => {
    await ownMirror('message_start');
    await ownMirror('content_delta', { delta: 'The answer.' });

    // The mirror must not write into the real slot either — the SSE stream is
    // the single writer for this turn, and these mutations are not idempotent.
    expect(state.conversations[TEMP].messages).toHaveLength(0);
  });

  it('drops the user-message echo as well', async () => {
    // Same race, same fix: the sender already rendered this locally.
    await ownMirror('user_message', { message: { role: 'user', content: 'hello' } });

    expect(state.conversations[REAL]).toBeUndefined();
    expect(state.conversations[TEMP].messages).toHaveLength(0);
  });

  it('still drops the echo once the slot HAS been renamed', async () => {
    // The race resolving the other way must not resurrect the bug: after
    // MIGRATE_CONVERSATION_ID the id guard would also have caught this, but
    // identity has to be sufficient on its own.
    chat.mutations.MIGRATE_CONVERSATION_ID(state, { oldId: TEMP, newId: REAL });

    await ownMirror('message_start');
    await ownMirror('content_delta', { delta: 'The answer.' });

    expect(state.conversations[REAL].messages).toHaveLength(0);
  });
});

describe('another tab is still served', () => {
  it('applies a turn started somewhere else', async () => {
    // The whole point of the mirror. A different client id is someone else's
    // turn, and it must stream in here exactly as before.
    await mirror('message_start', { originClientId: 'some-other-client' });
    await mirror('content_delta', { originClientId: 'some-other-client', delta: 'Not mine.' });

    expect(state.conversations[REAL].messages).toHaveLength(1);
    expect(state.conversations[REAL].messages[0].content).toBe('Not mine.');
  });

  it('applies an unstamped event, rather than swallowing it', async () => {
    // An event with no origin predates the header or came from a path that
    // does not send it. isOwnAnnouncement treats that as "not mine" — the same
    // deliberate asymmetry documented in clientId.js: a duplicate attach is
    // recoverable, never showing the turn at all is not.
    await mirror('message_start');
    await mirror('content_delta', { delta: 'Unstamped.' });

    expect(state.conversations[REAL].messages).toHaveLength(1);
    expect(state.conversations[REAL].messages[0].content).toBe('Unstamped.');
  });
});
