// A refresh mid-answer must show the question ONCE.
//
// THE BUG (reproduced against this store before the fix): refresh while the
// answer is streaming and the last question appears twice — once in place, and
// again BELOW the streaming answer.
//
// The sequence: the boot-time reattach (runResume.js) beats Chat.vue's
// transcript load into an empty slot, so `run_resumed` rebuilt the question
// under a MINTED id (`msg-<startedAt>-resumed-user`). The next autosave is
// refused (409, it would shrink the saved row), and
// reconcileTruncatedConversation rebuilds the slot as
// `[...stored, ...local messages whose id is not stored]`. The answer's id is
// server-assigned and stored, so it merged; the minted question id never
// matches anything, so it was kept as "unsaved" and appended after the answer.
//
// The fix gives the bubble ONE id end to end: the sender transmits the id it
// already gave the bubble, the server returns it on `run_resumed` and on the
// cross-tab mirror, and every rebuild uses it — so the id-keyed merges see one
// message, not two.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const CONV = 'conv-refresh';
const QUESTION = 'why does refresh duplicate my message?';
const BUBBLE_ID = 'msg-1700000000000-7';

let chatModule;
let handleScopedStreamEvent;
let serializeTranscript;
let store;

/** The stored row as the sender's own autosave left it: question under its real id. */
const STORED = [
  { id: 'm1', role: 'user', content: 'an earlier question', timestamp: 1 },
  { id: 'm2', role: 'assistant', content: 'an earlier answer', timestamp: 2 },
  { id: BUBBLE_ID, role: 'user', content: QUESTION, timestamp: 3 },
  { id: 'a1', role: 'assistant', content: 'partial ', timestamp: 4 },
];

const serveStoredRow = (messages) => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'out-1', content: serializeTranscript({ conversationId: CONV, messages }) }),
  }));
};

const conv = () => store.state.chat.conversations[CONV];
const rows = () => conv().messages.map((m) => `${m.role}:${m.id}:${m.content}`);
const event = (name, data) => handleScopedStreamEvent(
  { commit: (type, payload) => store.commit(`chat/${type}`, payload), state: store.state.chat, dispatch: () => {} },
  name,
  data,
  CONV,
);

/** The replay a reattaching tab receives: head frame, then the turn so far. */
const replay = (head) => {
  event('run_resumed', { userMessage: QUESTION, replayedMessageIds: ['a1'], startedAt: 3, ...head });
  event('assistant_message', { id: 'a1', role: 'assistant', content: '', timestamp: 4 });
  event('content_delta', { assistantMessageId: 'a1', delta: 'partial ' });
};

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('token', 't');
  const mod = await import('./chat.js');
  chatModule = mod.default;
  handleScopedStreamEvent = mod.handleScopedStreamEvent;
  ({ serializeTranscript } = await import('@/services/conversationTranscript.js'));
  store = createStore({
    modules: {
      chat: chatModule,
      contentOutputs: { namespaced: true, state: { outputs: [] }, actions: { applyOutputMeta: () => {} } },
    },
  });
  store.commit('chat/ENSURE_CONVERSATION', CONV);
});

describe('refresh mid-answer, then the refused-save reconcile', () => {
  it('shows the question once, before the still-streaming answer', async () => {
    serveStoredRow(STORED);
    replay({ userMessageId: BUBBLE_ID });

    await store.dispatch('chat/reconcileTruncatedConversation', { conversationId: CONV, outputId: 'out-1' });
    event('content_delta', { assistantMessageId: 'a1', delta: 'and more' });

    expect(rows()).toEqual([
      'user:m1:an earlier question',
      'assistant:m2:an earlier answer',
      `user:${BUBBLE_ID}:${QUESTION}`,
      'assistant:a1:partial and more',
    ]);
  });

  it('keeps the turn, in order, when the stored row never saw it', async () => {
    // Refresh before the first autosave: the row ends at the previous turn.
    serveStoredRow(STORED.slice(0, 2));
    replay({ userMessageId: BUBBLE_ID });

    await store.dispatch('chat/reconcileTruncatedConversation', { conversationId: CONV, outputId: 'out-1' });

    expect(rows()).toEqual([
      'user:m1:an earlier question',
      'assistant:m2:an earlier answer',
      `user:${BUBBLE_ID}:${QUESTION}`,
      'assistant:a1:partial ',
    ]);
  });
});

describe('rebuilding the question on run_resumed', () => {
  it('leaves a bubble this tab still holds untouched, attachments and all', () => {
    const files = [{ name: 'shot.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }];
    store.commit('chat/SCOPED_ADD_MESSAGE', {
      conversationId: CONV,
      message: { id: BUBBLE_ID, role: 'user', content: QUESTION, timestamp: 3, files },
    });

    replay({ userMessageId: BUBBLE_ID });

    const users = conv().messages.filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0].files).toEqual(files);
  });

  it('restores a question that repeats an earlier one word for word', () => {
    // "yes" twice is two turns. Matching on text took the earlier one for this
    // turn's bubble and left the answer replying to a question not on screen.
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u-old', role: 'user', content: QUESTION } });
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'a-old', role: 'assistant', content: 'old answer' } });

    replay({ userMessageId: BUBBLE_ID });

    expect(conv().messages.map((m) => m.id)).toEqual(['u-old', 'a-old', BUBBLE_ID, 'a1']);
  });

  it('still rebuilds the question from a server that sends no id', () => {
    replay({});
    const users = conv().messages.filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('msg-3-resumed-user');
  });
});

describe('the send names its bubble', () => {
  const mockEmptyStream = () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    }));
  };

  const send = async (userInput, bubble) => {
    mockEmptyStream();
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
    if (bubble) {
      store.commit('chat/SCOPED_ADD_MESSAGE', {
        conversationId: CONV,
        message: { role: 'user', content: userInput, timestamp: 9, ...bubble },
      });
    }
    await store.dispatch('chat/startStreamingConversation', { userInput, conversationId: CONV });
    const call = global.fetch.mock.calls.find(([url]) => String(url).includes('/orchestrator/chat'));
    return JSON.parse(call[1].body);
  };

  it('sends the id of the bubble it is answering', async () => {
    const body = await send(QUESTION, { id: BUBBLE_ID });
    expect(body.userMessageId).toBe(BUBBLE_ID);
  });

  it('sends none for a turn with no bubble of its own (a floor pass)', async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u1', role: 'user', content: 'hi all' } });
    const body = await send('[Floor] @Bob, you have the floor.');
    expect(body).not.toHaveProperty('userMessageId');
  });

  it('never changes the prompt: the history is byte-identical whatever the id', async () => {
    // The id names a bubble for reattach and cross-tab sync only. If it ever
    // reached the history, every turn would carry fresh bytes and break the
    // provider prompt-cache prefix.
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'm1', role: 'user', content: 'first' } });
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'm2', role: 'assistant', content: 'one' } });
    const withId = await send(QUESTION, { id: 'msg-A' });
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: CONV, value: false });
    conv().messages.pop();
    conv()._activeStreams = 0;
    const withOtherId = await send(QUESTION, { id: 'msg-B' });

    expect(JSON.stringify(withId.history)).toBe(JSON.stringify(withOtherId.history));
    expect(JSON.stringify(withId.history)).not.toContain('msg-A');
  });
});

describe('the cross-tab mirror of a sent question', () => {
  const mirror = (extra) => store.dispatch('chat/handleRealtimeChatEvent', {
    type: 'user_message',
    conversationId: CONV,
    message: { role: 'user', content: QUESTION },
    ...extra,
  });

  it('copies the question under the sender\'s id, once', async () => {
    await mirror({ userMessageId: BUBBLE_ID });
    await mirror({ userMessageId: BUBBLE_ID });
    expect(conv().messages.map((m) => m.id)).toEqual([BUBBLE_ID]);
  });

  it('copies a repeated question, which matching on text silently dropped', async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u-old', role: 'user', content: QUESTION } });
    await mirror({ userMessageId: BUBBLE_ID });
    expect(conv().messages.map((m) => m.id)).toEqual(['u-old', BUBBLE_ID]);
  });

  it('still de-duplicates by text when the sender names no id', async () => {
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: 'u-old', role: 'user', content: QUESTION } });
    await mirror({});
    expect(conv().messages).toHaveLength(1);
  });
});
