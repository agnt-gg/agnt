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
 * The email model + event-carried save metadata.
 *
 * Saves NEVER claim the conversation was read. The `viewing` flag that used
 * to ride this payload let the client stamp the read watermark on every
 * autosave of the SELECTED conversation — so a run finishing in the selected
 * chat was born read (no dot, no chime) even when the user was on another
 * screen entirely. Selection is not attention. The read stamp now comes only
 * from the read PATCH sent when the user actually opens the conversation.
 */
describe('chat/autosaveConversation read-state + save-meta merge', () => {
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

  it('saving the ACTIVE conversation carries no viewing claim — the oven timer must ring', async () => {
    // REGRESSION GUARD: if a save of the selected conversation could mark
    // itself read again, a finished run would be born read — no dot, no
    // chime — whenever its row happened to be selected.
    setupConversation('conv-1');
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-1' });
    expect('viewing' in savedBody()).toBe(false);
  });

  it('a background save carries no viewing claim either', async () => {
    setupConversation('conv-bg', { active: false, savedOutputId: 'out-bg' });
    setupConversation('conv-active');
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: 'conv-bg' });
    expect('viewing' in savedBody()).toBe(false);
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
    // The fixture's watermark equals updated_at, so the merged row derives
    // read — the merge preserves server-derived state as-is.
    expect(store.getters['contentOutputs/unreadOutputIdSet'].has('out-1')).toBe(false);
    // And the ONLY network call was the save — no /content-outputs list GET.
    const listFetches = fetchMock.mock.calls.filter(([url]) =>
      /\/content-outputs(\?|$)/.test(String(url)));
    expect(listFetches).toHaveLength(0);
  });
});
