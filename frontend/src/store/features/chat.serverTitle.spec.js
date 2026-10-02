import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule from './chat.js';

/**
 * The chat header shows chat.savedOutputTitle — a CLIENT cache. The server
 * now ranks titles (an auto-title or a rename beats the first-message title an
 * autosave sends), so the cache must follow what the server STORED, or the
 * sidebar shows "React useEffect Loop" while the header still shows "hey can
 * you help me debug my react useEffect loop".
 */
describe('chat header title follows the server', () => {
  let store;
  let fetchMock;
  // Fresh id per test: the chat module's state object is shared across store
  // instances, so a reused id would inherit the previous test's cached title.
  let CONV;
  let seq = 0;

  function respondWith(output) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id: 'out-1', output }) });
  }

  beforeEach(() => {
    CONV = `conv-title-${++seq}`;
    localStorage.setItem('token', 'test-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    store = createStore({
      modules: {
        chat: chatModule,
        contentOutputs: { namespaced: true, state: { outputs: [] }, actions: { applyOutputMeta() {} } },
      },
    });
    store.commit('chat/ENSURE_CONVERSATION', CONV);
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
    store.commit('chat/SCOPED_SET_MESSAGES', {
      conversationId: CONV,
      messages: [
        { id: 'm1', role: 'user', content: 'hey can you help me debug my react useEffect loop', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'Sure.', timestamp: 2 },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('an autosave caches the STORED title, not the one it sent', async () => {
    respondWith({ id: 'out-1', title: 'React useEffect Loop' });
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    expect(store.state.chat.conversations[CONV].savedOutputTitle).toBe('React useEffect Loop');
    expect(store.state.chat.savedOutputTitle).toBe('React useEffect Loop');
  });

  it('falls back to the sent title against an older server that returns no row', async () => {
    respondWith(undefined);
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    expect(store.state.chat.conversations[CONV].savedOutputTitle).toMatch(/^hey can you help me/);
  });

  it('a broadcast for the open row updates the header; one for another row does not', () => {
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: CONV, id: 'out-1' });
    store.commit('chat/SYNC_SAVED_OUTPUT_TITLE', { outputId: 'out-other', title: 'Somebody Else' });
    expect(store.state.chat.savedOutputTitle).not.toBe('Somebody Else');
    store.commit('chat/SYNC_SAVED_OUTPUT_TITLE', { outputId: 'out-1', title: 'React useEffect Loop' });
    expect(store.state.chat.savedOutputTitle).toBe('React useEffect Loop');
    expect(store.state.chat.conversations[CONV].savedOutputTitle).toBe('React useEffect Loop');
  });

  it('ignores an empty title', () => {
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: CONV, id: 'out-1' });
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_TITLE', { conversationId: CONV, title: 'Kept' });
    store.commit('chat/SYNC_SAVED_OUTPUT_TITLE', { outputId: 'out-1', title: '' });
    expect(store.state.chat.conversations[CONV].savedOutputTitle).toBe('Kept');
  });
});
