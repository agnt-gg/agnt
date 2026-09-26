// SUGGESTIONS BELONG TO THEIR CONVERSATION.
//
// WHY THIS FILE EXISTS
// --------------------
// The main chat kept its quick-reply pills in ONE ref on the chat screen.
// Conversations switched underneath it and the pills stayed put, so every
// chat showed whatever the previous one had last generated. And the request
// that produced them wrote into that same ref when it landed, so a switch
// during the request put conversation A's answer on conversation B.
//
// The fix stores suggestions in each conversation's slot and has the request
// carry its own address. Every test here has a NEGATIVE CONTROL: the
// conversation that happened to be on screen must NOT receive the write.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
vi.mock('@/services/chatService.js', () => ({ reattachRun: vi.fn(), cancelRun: vi.fn(), fetchConversation: vi.fn() }));
vi.mock('@/services/voiceTurn.js', () => ({ consumeVoiceTurn: () => false }));

const A = 'conv-a';
const B = 'conv-b';
const ITEMS_A = [{ id: 1, text: 'Deploy the page', prompt: 'Deploy the page' }];

let chat;
let state;
let commit;
let dispatch;

const makeState = () => ({
  activeConversationId: null,
  currentConversationId: null,
  pendingSteer: '',
  messages: [],
  conversations: {},
  agentConversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
  routingModeByConv: {},
  streamEventCallbacks: [],
  autosaveEnabled: true,
  currentAgentId: null,
});

const user = (content) => ({ id: `u-${content}`, role: 'user', content, timestamp: 1 });
const reply = (content) => ({ id: `a-${content}`, role: 'assistant', content, timestamp: 2 });

function seed(conversationId, messages) {
  commit('ENSURE_CONVERSATION', conversationId);
  commit('SCOPED_SET_MESSAGES', { conversationId, messages });
}

/** A suggestions request the test resolves by hand, to open the race window. */
function deferSuggestionsResponse(items = ITEMS_A) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  global.fetch = vi.fn(async () => {
    await gate;
    return { ok: true, json: async () => ({ suggestions: items }) };
  });
  return release;
}

const fetchFor = (conversationId, extra = {}) =>
  chat.actions.fetchConversationSuggestions({ commit, state, dispatch }, { conversationId, provider: 'p', model: 'm', ...extra });
const shown = (conversationId) => chat.getters.conversationSuggestions(state)(conversationId);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  chat = (await import('./chat.js')).default;
  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (!fn) throw new Error(`Unknown mutation: ${type}`);
    fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());
  seed(A, [user('build the page'), reply('built')]);
  seed(B, [user('what is the weather'), reply('sunny')]);
});

describe('each conversation shows only its own suggestions', () => {
  it('switching conversations does not carry the pills along (the reported bug)', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ suggestions: ITEMS_A }) }));
    commit('SET_ACTIVE_CONVERSATION', A);
    await fetchFor(A);
    expect(shown(A)).toEqual(ITEMS_A);

    commit('SET_ACTIVE_CONVERSATION', B);
    expect(shown(B)).toEqual([]); // NEGATIVE CONTROL
    commit('SET_ACTIVE_CONVERSATION', A);
    expect(shown(A)).toEqual(ITEMS_A); // and A still has its own
  });

  it('a request that lands after a switch writes to the conversation that asked', async () => {
    const release = deferSuggestionsResponse();
    commit('SET_ACTIVE_CONVERSATION', A);
    const pending = fetchFor(A);

    commit('SET_ACTIVE_CONVERSATION', B); // user switches while it is out
    release();
    expect(await pending).toBe(true);

    expect(shown(A)).toEqual(ITEMS_A);
    expect(shown(B)).toEqual([]); // NEGATIVE CONTROL: the screen's conversation
  });

  it('drops a result the conversation has moved past (a newer user turn)', async () => {
    const release = deferSuggestionsResponse();
    const pending = fetchFor(A);

    commit('SCOPED_ADD_MESSAGE', { conversationId: A, message: user('now deploy it') });
    release();
    expect(await pending).toBe(false);

    expect(state.conversations[A].suggestions).toBeNull();
    expect(state.conversations[A].isLoadingSuggestions).toBe(false);
  });

  it('follows the slot through the temp-id → server-id rename mid-request', async () => {
    const TEMP = 'temp-123';
    const SERVER = 'conv-server-uuid';
    seed(TEMP, [user('hello'), reply('hi')]);
    const release = deferSuggestionsResponse();
    const pending = fetchFor(TEMP);

    commit('MIGRATE_CONVERSATION_ID', { oldId: TEMP, newId: SERVER });
    release();
    expect(await pending).toBe(true);

    expect(shown(SERVER)).toEqual(ITEMS_A);
    // Loading must clear on the RENAMED slot, or the pills spin forever.
    expect(state.conversations[SERVER].isLoadingSuggestions).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('autosaveConversation', { debounce: true, conversationId: SERVER });
  });

  it('does not refetch when the conversation already has a valid set, unless forced', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ suggestions: ITEMS_A }) }));
    await fetchFor(A);
    expect(await fetchFor(A)).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await fetchFor(A, { force: true })).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('a new conversation has no suggestions of its own (the screen shows its starters)', () => {
    seed('temp-new', []);
    expect(shown('temp-new')).toEqual([]);
  });
});

describe('saved with the conversation', () => {
  it('autosave writes the conversation\'s own suggestions into the transcript', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ suggestions: ITEMS_A }) }));
    await fetchFor(A);

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'out-a' }) }));
    await chat.actions.autosaveConversation({ commit, state, dispatch, rootState: {} }, { debounce: false, conversationId: A });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const content = JSON.parse(body.content);
    expect(content.suggestions.items).toEqual(ITEMS_A);
  });

  it('NEGATIVE CONTROL: saving B does not carry A\'s suggestions', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ suggestions: ITEMS_A }) }));
    await fetchFor(A);

    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'out-b' }) }));
    await chat.actions.autosaveConversation({ commit, state, dispatch, rootState: {} }, { debounce: false, conversationId: B });

    const content = JSON.parse(JSON.parse(global.fetch.mock.calls[0][1].body).content);
    expect(content).not.toHaveProperty('suggestions');
  });
});
