/**
 * Embedded chats: a channel's suggestions belong to the conversation it holds.
 *
 * A channel (a workspace chat, a forge panel) is a SEAT, and the conversation
 * in it can change: hydration adopts another device's thread, clear starts a
 * new one. Suggestions used to be keyed by the seat, so they survived every
 * such change — hydration even copied them onto the incoming conversation
 * explicitly — and a request in flight wrote to the seat, not the thread.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const loadTranscriptByConversationId = vi.fn(async () => null);
const saveTranscript = vi.fn(async () => ({ ok: true, outputId: 'out-1' }));

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(),
  toChatHistory: vi.fn(() => []),
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(() => ({ provider: 'p', model: 'm' })),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(() => []),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/services/conversationTranscript.js', () => ({
  loadTranscriptByConversationId: (...args) => loadTranscriptByConversationId(...args),
  saveTranscript: (...args) => saveTranscript(...args),
  scopeTranscriptToChannel: vi.fn(async () => true),
  deriveTitle: () => 'T',
}));

const CH = 'workspace:ws-1';
const ITEMS = [{ id: 1, text: 'Open the canvas' }, { id: 2, text: 'Add a widget' }];

let chatUnified;
let anchorSuggestions;
let WORKSPACES_STORAGE_KEY;
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

const user = (content) => ({ id: `u-${content}`, role: 'user', content });
const reply = (content) => ({ id: `a-${content}`, role: 'assistant', content });
const THREAD_A = [user('lay out my dashboard'), reply('done')];
const THREAD_B = [user('what is in this workspace'), reply('two widgets')];

const shown = () => chatUnified.getters.getSuggestions(state)(CH);
const fetchSuggestions = () =>
  chatUnified.actions.fetchSuggestions({ commit, dispatch, state, rootState: { aiProvider: {} } }, { channelKey: CH, chatType: 'orchestrator' });

function holdChannel(conversationId, messages, suggestions = null) {
  commit('SET_CONVERSATION', { channelKey: CH, conversation: { conversationId, messages, suggestions } });
}

function deferSuggestionsResponse() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  global.fetch = vi.fn(async () => {
    await gate;
    return { ok: true, json: async () => ({ suggestions: ITEMS }) };
  });
  return release;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  chatUnified = (await import('./chatUnified.js')).default;
  ({ anchorSuggestions } = await import('@/services/conversationSuggestions.js'));
  ({ STORAGE_KEY: WORKSPACES_STORAGE_KEY } = await import('@/views/Terminal/CenterPanel/screens/Workspace/workspaceStorage.js'));
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`Unknown mutation: ${type}`);
    fn(state, payload);
  };
  dispatch = vi.fn(() => Promise.resolve());
});

describe('hydration adopts the incoming conversation\'s suggestions, never the seat\'s', () => {
  it('does NOT copy the previous conversation\'s pills onto a different one (the reported bug)', async () => {
    // The seat holds an unsaved thread with its own pills; workspace sync
    // points it at ANOTHER device's conversation, which hydration adopts.
    holdChannel(null, THREAD_A, anchorSuggestions(ITEMS, THREAD_A));
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify({
      workspaces: [{ id: 'ws-1', channelConversations: { [CH]: 'conv-b' } }],
    }));
    loadTranscriptByConversationId.mockResolvedValueOnce({ outputId: 'out-b', messages: THREAD_B, suggestions: null });

    const result = await chatUnified.actions.hydrateWorkspaceChannel({ commit, state, dispatch }, { channelKey: CH });

    expect(result.reason).toBe('hydrated');
    expect(state.conversations[CH].messages).toEqual(THREAD_B);
    expect(state.conversations[CH].suggestions).toBeNull();
    expect(shown()).toEqual([]);
  });

  it('restores the conversation\'s own saved suggestions', async () => {
    holdChannel('conv-b', []);
    loadTranscriptByConversationId.mockResolvedValueOnce({
      outputId: 'out-b', messages: THREAD_B, suggestions: anchorSuggestions(ITEMS, THREAD_B),
    });

    await chatUnified.actions.hydrateWorkspaceChannel({ commit, state, dispatch }, { channelKey: CH });

    expect(shown()).toEqual(ITEMS);
  });
});

describe('a request in flight writes only to the conversation that asked', () => {
  it('drops the result when the channel was cleared meanwhile', async () => {
    holdChannel('conv-a', THREAD_A);
    const release = deferSuggestionsResponse();
    const pending = fetchSuggestions();

    commit('CLEAR_CONVERSATION', { channelKey: CH, welcomeMessage: reply('Welcome') });
    release();
    expect(await pending).toBe(false);

    expect(state.conversations[CH].suggestions).toBeNull();
    expect(state.loadingSuggestionsChannels[CH]).toBeUndefined();
  });

  it('drops the result when the channel now holds another conversation', async () => {
    holdChannel('conv-a', THREAD_A);
    const release = deferSuggestionsResponse();
    const pending = fetchSuggestions();

    holdChannel('conv-b', THREAD_B);
    release();
    expect(await pending).toBe(false);
    expect(shown()).toEqual([]); // NEGATIVE CONTROL
  });

  it('stores and saves the result when nothing moved', async () => {
    holdChannel('conv-a', THREAD_A);
    deferSuggestionsResponse()();
    expect(await fetchSuggestions()).toBe(true);

    expect(shown()).toEqual(ITEMS);
    expect(dispatch).toHaveBeenCalledWith('saveChannelTranscript', { channelKey: CH });
  });
});

describe('stored with the conversation', () => {
  it('saveChannelTranscript sends the conversation\'s suggestions with its transcript', async () => {
    const suggestions = anchorSuggestions(ITEMS, THREAD_A);
    holdChannel('conv-a', THREAD_A, suggestions);

    await chatUnified.actions.saveChannelTranscript({ commit, state }, { channelKey: CH });

    expect(saveTranscript.mock.calls[0][0].suggestions).toEqual(suggestions);
  });

  it('a set stops showing once the user takes another turn', () => {
    holdChannel('conv-a', THREAD_A, anchorSuggestions(ITEMS, THREAD_A));
    commit('ADD_MESSAGE', { channelKey: CH, message: user('and make it blue') });
    expect(shown()).toEqual([]);
  });

  it('ignores the old unanchored array shape from localStorage', () => {
    holdChannel('conv-a', THREAD_A, ITEMS);
    expect(state.conversations[CH].suggestions).toBeNull();
    expect(shown()).toEqual([]);
  });
});
