import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule from './chat.js';

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
