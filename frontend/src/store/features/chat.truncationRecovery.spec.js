import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule from './chat.js';
import { serializeTranscript } from '@/services/conversationTranscript.js';

/**
 * The CLIENT half of the truncation fix.
 *
 * THE INCIDENT (measured, 2026-08-14): a 404-message conversation was replaced
 * on disk by a 4-message one. The surviving fragment's first message id ended
 * `-resumed-user`, which named the trigger exactly: the app was RESUMED after a
 * restart with only the current turn in memory, while still knowing its
 * conversationId. The server adopts a row by conversationId, so that fragment
 * was written straight over the full history.
 *
 * The server now refuses that write with a 409. This spec pins what the client
 * must do about it, which is the part the user actually feels:
 *
 *   a refusal is not an error, it is a correction — pull the stored transcript
 *   in and show it, so the history comes BACK on screen instead of the tab
 *   quietly carrying on with a fragment.
 */
describe('a refused truncating save restores the conversation', () => {
  let store;
  let fetchMock;

  const CONV = 'conv-1';
  const OUTPUT_ID = 'out-1';

  // What the server still holds: the real history.
  const STORED = [
    { id: 'm1', role: 'user', content: 'first question', timestamp: 1, metadata: [], toolCalls: [], contentParts: [] },
    { id: 'm2', role: 'assistant', content: 'first answer', timestamp: 2, metadata: [], toolCalls: [], contentParts: [] },
    { id: 'm3', role: 'user', content: 'second question', timestamp: 3, metadata: [], toolCalls: [], contentParts: [] },
    { id: 'm4', role: 'assistant', content: 'second answer', timestamp: 4, metadata: [], toolCalls: [], contentParts: [] },
  ];

  // What this tab woke up holding after a resume.
  const FRAGMENT = [
    { id: 'm9', role: 'user', content: 'the turn I just typed', timestamp: 9 },
    { id: 'm10', role: 'assistant', content: 'answering it', timestamp: 10 },
  ];

  const refusal = {
    error: 'transcript_truncation_refused',
    id: OUTPUT_ID,
    storedMessageCount: 4,
    incomingMessageCount: 2,
    output: { id: OUTPUT_ID, title: 'the real title' },
  };

  beforeEach(() => {
    localStorage.setItem('token', 'test-token');

    fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/content-outputs/save')) {
        return { ok: false, status: 409, json: async () => refusal };
      }
      if (String(url).includes(`/content-outputs/${OUTPUT_ID}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: OUTPUT_ID,
            title: 'the real title',
            content: serializeTranscript({ conversationId: CONV, title: 'the real title', messages: STORED }),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ id: OUTPUT_ID }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    store = createStore({
      modules: {
        chat: chatModule,
        contentOutputs: { namespaced: true, state: { outputs: [] }, actions: { applyOutputMeta: () => {} } },
      },
    });

    store.commit('chat/ENSURE_CONVERSATION', CONV);
    store.commit('chat/SET_ACTIVE_CONVERSATION', CONV);
    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: CONV, messages: [...FRAGMENT] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const flush = async () => {
    // The reconcile is dispatched without await so the save path can return.
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  it('puts the stored history back on screen', async () => {
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    const messages = store.state.chat.conversations[CONV].messages;
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm9', 'm10']);
  });

  it('keeps the turn this tab was in the middle of', async () => {
    // The whole point of merging rather than replacing. Dropping the live turn
    // to recover the history would be the same class of loss, just smaller.
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    const contents = store.state.chat.conversations[CONV].messages.map((m) => m.content);
    expect(contents).toContain('the turn I just typed');
    expect(contents).toContain('answering it');
  });

  it('adopts the row id, so the next save is no longer a blind write', async () => {
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    expect(store.state.chat.conversations[CONV].savedOutputId).toBe(OUTPUT_ID);
    expect(store.state.chat.conversations[CONV].savedOutputTitle).toBe('the real title');
  });

  it('does not leave the conversation stuck in an error state', async () => {
    // A permanent red "error" badge for a save the server was RIGHT to refuse
    // would train the user to ignore genuine save failures.
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    expect(store.state.chat.conversations[CONV].saveStatus).toBeNull();
    expect(store.state.chat.conversations[CONV].isSaving).toBe(false);
  });

  it('does not retry the destructive save', async () => {
    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    const saves = fetchMock.mock.calls.filter(([url]) => String(url).includes('/content-outputs/save'));
    expect(saves).toHaveLength(1);
  });

  it('is not vacuous: a 200 save leaves the transcript alone', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ id: OUTPUT_ID }) }));

    await store.dispatch('chat/autosaveConversation', { debounce: false, conversationId: CONV });
    await flush();

    expect(store.state.chat.conversations[CONV].messages.map((m) => m.id)).toEqual(['m9', 'm10']);
  });
});
