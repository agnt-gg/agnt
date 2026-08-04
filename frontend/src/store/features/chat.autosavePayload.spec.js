import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule from './chat.js';
import contentOutputsModule from './contentOutputs.js';

/**
 * Pins the conversation-blob size fix: autosave must persist {{IMAGE_REF:id}}
 * tokens AS-IS instead of inlining cached base64 data URIs. Inlining made
 * image-heavy blobs ~6x larger (measured: 85% of a typical 5.5MB saved
 * conversation was duplicated base64 that already exists on disk server-side
 * and is served from /api/images/:id with immutable cache headers).
 */
describe('chat/autosaveConversation payload', () => {
  let store;
  let fetchMock;

  const IMAGE_REF = '{{IMAGE_REF:img-test-123}}';
  const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  beforeEach(() => {
    localStorage.setItem('token', 'test-token');

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'output-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    store = createStore({
      modules: {
        chat: chatModule,
        contentOutputs: { namespaced: true, state: { outputs: [] } },
      },
    });

    const convId = 'conv-1';
    store.commit('chat/ENSURE_CONVERSATION', convId);
    store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
    store.commit('chat/SCOPED_SET_MESSAGES', {
      conversationId: convId,
      messages: [
        { id: 'm1', role: 'user', content: 'draw me a cat', timestamp: 1 },
        {
          id: 'm2',
          role: 'assistant',
          content: `Here you go: <img src="${IMAGE_REF}" alt="">`,
          timestamp: 2,
        },
      ],
    });
    // Populate the image cache the way a generation tool result would —
    // the old code resolved refs against exactly this cache at save time.
    const conv = store.state.chat.conversations[convId];
    conv.imageCache.set('img-test-123', { data: DATA_URI });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('persists IMAGE_REF tokens unresolved (no base64 inlining)', async () => {
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });

    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/content-outputs/save'));
    expect(saveCall).toBeTruthy();

    const body = JSON.parse(saveCall[1].body);
    const conversationData = JSON.parse(body.content);
    const assistantMsg = conversationData.messages.find((m) => m.id === 'm2');

    expect(assistantMsg.content).toContain(IMAGE_REF);
    expect(body.content).not.toContain('data:image/');
  });

  it('still saves full message shape (toolCalls, metadata, timestamps)', async () => {
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });

    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/content-outputs/save'));
    const body = JSON.parse(saveCall[1].body);
    const conversationData = JSON.parse(body.content);

    expect(conversationData.messages).toHaveLength(2);
    expect(conversationData.messages[0]).toMatchObject({ id: 'm1', role: 'user', content: 'draw me a cat', timestamp: 1 });
    expect(body.contentType).toBe('conversation');
  });
});

/**
 * The viewing flag + event-carried save metadata.
 *
 * viewing:true tells the server "the user is looking at this conversation",
 * so the read watermark is stamped ATOMICALLY with the save — no unread
 * window between change and stamp, hence no rail flicker and no chime for
 * the conversation being read (the save-then-markRead pair this replaces
 * reopened that window on every ~5s stream autosave).
 */
describe('chat/autosaveConversation viewing + save-meta merge', () => {
  let store;
  let fetchMock;

  function savedBody() {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/content-outputs/save'));
    expect(call).toBeTruthy();
    return JSON.parse(call[1].body);
  }

  function setupConversation(convId, { active = true, savedOutputId = null } = {}) {
    store.commit('chat/ENSURE_CONVERSATION', convId);
    if (active) store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
    store.commit('chat/SCOPED_SET_MESSAGES', {
      conversationId: convId,
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
    });
    if (savedOutputId) {
      store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: convId, id: savedOutputId });
    }
  }

  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'output-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    // The REAL contentOutputs module: the merge path is part of the contract.
    store = createStore({ modules: { chat: chatModule, contentOutputs: contentOutputsModule } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('saving the ACTIVE conversation sends viewing: true', async () => {
    setupConversation('conv-1');
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });
    expect(savedBody().viewing).toBe(true);
  });

  it('saving a BACKGROUND conversation sends viewing: false', async () => {
    // A background agent's autosave must not stamp the watermark — that
    // conversation SHOULD go unread; it changed while the user was elsewhere.
    setupConversation('conv-bg', { active: false, savedOutputId: 'out-bg' });
    setupConversation('conv-active');
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-bg' });
    expect(savedBody().viewing).toBe(false);
  });

  it('a manual Mark-as-Unread overrides viewing — the save must not clear it', async () => {
    // REGRESSION GUARD for "it will not stay in the Needs-you group": the
    // user marks the OPEN conversation unread; the next ~5s autosave used to
    // re-stamp it read. Intent outlives autosaves; only re-opening clears it.
    setupConversation('conv-1', { savedOutputId: 'out-1' });
    store.commit('contentOutputs/SET_MANUAL_UNREAD', { id: 'out-1', on: true });

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });
    expect(savedBody().viewing).toBe(false);
  });

  it('merges result.output into the sidebar list — no full-list refetch', async () => {
    setupConversation('conv-1', { savedOutputId: 'out-1' });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 'out-1',
        output: {
          id: 'out-1',
          title: 'hello',
          updated_at: '2026-08-04 12:00:05',
          last_read_at: '2026-08-04 12:00:05',
          archived_at: null,
          created_at: '2026-08-04 11:00:00',
        },
      }),
    });

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });

    const outputs = store.getters['contentOutputs/outputs'];
    expect(outputs.map((o) => o.id)).toEqual(['out-1']);
    // Viewing save: watermark rode along, so the active conversation is READ.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);
    // And the ONLY network call was the save — no /content-outputs list GET.
    const listFetches = fetchMock.mock.calls.filter(([url]) =>
      /\/content-outputs(\?|$)/.test(String(url)));
    expect(listFetches).toHaveLength(0);
  });
});
