// The Main chat on a phone that slept through a sub-chat handing work back.
//
// Measured on charlie (2026-10-09): the report turns and Main's replies ran and
// were saved while the phone's screen was off; the phone kept showing the copy
// it held when it slept, and its next save, naming the row by id, could have
// written that older copy over them. These tests pin the three fixes on the
// store the Main chat actually runs on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({ resolveChannelProviderModel: vi.fn(), resolveChannelEnabledTools: vi.fn() }));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
const pendingCatchUp = vi.hoisted(() => vi.fn(() => null));
vi.mock('@/services/runResume.js', () => ({ pendingCatchUp: (...a) => pendingCatchUp(...a) }));

const CONV = 'conv-main';
const OUT = 'out-main';
const REPORT = '[System: Sub-chat finished]\n\nSub-chat: "Landing page rebuild" (conversation id c9)\nStatus: completed\n\nIts final answer:\nBuilt it.';

const PHONE = [
  { id: 'p1', role: 'user', content: 'build a landing page' },
  { id: 'p2', role: 'assistant', content: 'Started a sub-chat for the build.' },
];
const SERVER = [
  { id: 'srv-0', role: 'user', content: 'build a landing page' },
  { id: 'srv-1', role: 'assistant', content: 'Started a sub-chat for the build.' },
  { id: 'srv-2', role: 'user', content: REPORT },
  { id: 'srv-3', role: 'assistant', content: 'Built and checked: Bramble & Bloom Coffee.' },
];

let store;
let serializeTranscript;
let routes;

const conv = (id = CONV) => store.state.chat.conversations[id];
const contents = (id = CONV) => conv(id).messages.map((m) => m.content);
const savesSent = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/content-outputs/save')).map(([, init]) => JSON.parse(init.body));

/** Answer by URL; each value is a list of responses consumed in order (last one repeats). */
const serve = (table) => {
  routes = table;
  global.fetch = vi.fn(async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: true, status: 200, json: async () => ({}) };
    const list = routes[key];
    const res = list.length > 1 ? list.shift() : list[0];
    return { ok: res.status < 400, status: res.status, json: async () => res.body, body: res.stream };
  });
};
const storedRow = (messages, contentHash) => ({
  status: 200,
  body: { id: OUT, content: serializeTranscript({ conversationId: CONV, messages }), content_hash: contentHash, title: 'Main chat' },
});

const seed = (messages = PHONE, extra = {}, id = CONV, outputId = OUT) => {
  store.commit('chat/ENSURE_CONVERSATION', id);
  store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: id, messages: messages.map((m) => ({ ...m })) });
  store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: id, id: outputId });
  store.commit('chat/SCOPED_SET_SAVED_CONTENT_HASH', { conversationId: id, contentHash: 'h-phone' });
  Object.assign(conv(id), extra);
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  pendingCatchUp.mockReturnValue(null);
  localStorage.clear();
  localStorage.setItem('token', 't');
  const chatModule = (await import('./chat.js')).default;
  ({ serializeTranscript } = await import('@/services/conversationTranscript.js'));
  store = createStore({
    modules: {
      chat: chatModule,
      contentOutputs: { namespaced: true, state: { outputs: [] }, actions: { applyOutputMeta: () => {} } },
    },
  });
});

describe('catching the Main chat up after the phone slept', () => {
  it('adopts the report turn and reply the server ran meanwhile, and records what it synced', async () => {
    seed();
    serve({ [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')] });

    const result = await store.dispatch('chat/catchUpConversation', { conversationId: CONV });

    expect(result).toEqual({ adopted: true });
    expect(contents()).toEqual(SERVER.map((m) => m.content));
    expect(conv().savedContentHash).toBe('h-server');
  });

  it('keeps a message typed on the phone before the catch-up landed', async () => {
    seed([...PHONE, { id: 'p3', role: 'user', content: 'and add a gallery' }]);
    serve({ [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')] });

    await store.dispatch('chat/catchUpConversation', { conversationId: CONV });

    expect(contents()).toEqual([...SERVER.map((m) => m.content), 'and add a gallery']);
  });

  it('does nothing when the stored copy is the one this phone last synced', async () => {
    seed();
    serve({ [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-phone')] });

    expect(await store.dispatch('chat/catchUpConversation', { conversationId: CONV })).toEqual({ adopted: false, reason: 'current' });
    expect(contents()).toEqual(PHONE.map((m) => m.content));
  });

  it('leaves an up-to-date chat on screen untouched, but records the server copy as synced', async () => {
    seed([...PHONE, { id: 'p3', role: 'user', content: REPORT }, { id: 'p4', role: 'assistant', content: 'Built and checked: Bramble & Bloom Coffee.' }]);
    serve({ [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-reprojected')] });

    expect(await store.dispatch('chat/catchUpConversation', { conversationId: CONV })).toEqual({ adopted: false, reason: 'local_current' });
    expect(conv().messages.map((m) => m.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(conv().savedContentHash).toBe('h-reprojected');
  });

  it('never touches a conversation that is streaming', async () => {
    seed(PHONE, { isStreaming: true });
    serve({ [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')] });

    expect(await store.dispatch('chat/catchUpConversation', { conversationId: CONV })).toEqual({ adopted: false, reason: 'streaming' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not apply a catch-up to a slot that started a turn while the request was out', async () => {
    seed();
    let release;
    global.fetch = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const pending = store.dispatch('chat/catchUpConversation', { conversationId: CONV });
    conv().isStreaming = true;
    release({ ok: true, status: 200, json: async () => storedRow(SERVER, 'h-server').body });

    expect(await pending).toEqual({ adopted: false, reason: 'changed' });
    expect(contents()).toEqual(PHONE.map((m) => m.content));
  });

  it('checks the open conversation first, skips agent chats, and reports how many it updated', async () => {
    seed(PHONE, { lastSaveTimestamp: 1 }, 'conv-old', 'out-old');
    seed(PHONE, { agentId: 'agent-1', lastSaveTimestamp: 9 }, 'conv-agent', 'out-agent');
    seed(PHONE, { lastSaveTimestamp: 2 });
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
    serve({
      [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')],
      '/content-outputs/out-old': [storedRow(PHONE, 'h-phone')],
    });

    const result = await store.dispatch('chat/catchUpConversations');

    expect(result).toEqual({ checked: 2, updated: 1 });
    expect(global.fetch.mock.calls[0][0]).toContain(`/content-outputs/${OUT}`);
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('out-agent'))).toBe(false);
  });
});

describe('saving the Main chat against what this phone last synced', () => {
  it('sends the synced content hash and records the one the server returns', async () => {
    seed();
    serve({ '/content-outputs/save': [{ status: 200, body: { id: OUT, contentHash: 'h-saved', output: { id: OUT } } }] });

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });

    expect(savesSent()[0]).toMatchObject({ id: OUT, baseContentHash: 'h-phone' });
    expect(conv().savedContentHash).toBe('h-saved');
  });

  it('a refused stale save catches up, then saves once more on top of the report', async () => {
    seed([...PHONE, { id: 'p3', role: 'user', content: 'and add a gallery' }]);
    serve({
      '/content-outputs/save': [
        { status: 409, body: { error: 'transcript_stale', id: OUT, contentHash: 'h-server' } },
        { status: 200, body: { id: OUT, contentHash: 'h-merged', output: { id: OUT } } },
      ],
      [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')],
    });

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await vi.waitFor(() => expect(savesSent()).toHaveLength(2));

    const second = savesSent()[1];
    expect(second.baseContentHash).toBe('h-server');
    expect(JSON.parse(second.content).messages.map((m) => m.content)).toEqual([...SERVER.map((m) => m.content), 'and add a gallery']);
    await vi.waitFor(() => expect(conv().savedContentHash).toBe('h-merged'));
    expect(conv().saveStatus).toBe('saved');
  });

  it('a stale save refused mid-turn is retried once the turn settles', async () => {
    vi.useFakeTimers();
    seed();
    serve({
      '/content-outputs/save': [
        { status: 409, body: { error: 'transcript_stale', id: OUT, contentHash: 'h-server' } },
        { status: 409, body: { error: 'transcript_stale', id: OUT, contentHash: 'h-server' } },
        { status: 200, body: { id: OUT, contentHash: 'h-merged', output: { id: OUT } } },
      ],
      [`/content-outputs/${OUT}`]: [storedRow(SERVER, 'h-server')],
    });
    conv().isStreaming = true;

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    expect(savesSent()).toHaveLength(1);

    conv().isStreaming = false;
    await vi.advanceTimersByTimeAsync(3100);
    await vi.waitFor(() => expect(savesSent()).toHaveLength(3));

    expect(JSON.parse(savesSent()[2].content).messages.map((m) => m.content)).toEqual(SERVER.map((m) => m.content));
    vi.useRealTimers();
  });

  it('a refused stale save with nothing to adopt does not retry', async () => {
    seed();
    serve({
      '/content-outputs/save': [{ status: 409, body: { error: 'transcript_stale', id: OUT, contentHash: 'h-server' } }],
      [`/content-outputs/${OUT}`]: [storedRow(PHONE, 'h-server')],
    });

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(savesSent()).toHaveLength(1);
    expect(conv().isSaving).toBe(false);
  });
});

describe('a send right after the phone wakes', () => {
  it('waits for the catch-up, so the turn goes out with the report in its history', async () => {
    seed();
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
    let finish;
    pendingCatchUp.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    serve({ '/orchestrator/chat': [{ status: 200, body: {}, stream: { getReader: () => ({ read: async () => ({ done: true }) }) } }] });

    const sending = store.dispatch('chat/startStreamingConversation', { userInput: 'and add a gallery', conversationId: CONV });
    await Promise.resolve();
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/orchestrator/chat'))).toBe(false);

    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: CONV, messages: SERVER.map((m) => ({ ...m })) });
    finish();
    await sending;

    const [, init] = global.fetch.mock.calls.find(([url]) => String(url).includes('/orchestrator/chat'));
    expect(JSON.stringify(JSON.parse(init.body).history)).toContain('Bramble & Bloom');
  });
});
