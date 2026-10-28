import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule, { handleScopedStreamEvent } from './chat.js';

/**
 * NO TRANSCRIPT WRITES WHILE A REPLY STREAMS
 * ------------------------------------------
 * Every autosave POSTs the WHOLE transcript and the server rewrites the whole
 * saved row plus its search index (measured on a real 2 MB conversation:
 * ~9.8 MB written per save). A throttle that saved every 5 s while text
 * streamed made the disk cost of a turn proportional to how long it ran — a
 * 25-minute turn rewrote its conversation ~300 times.
 *
 * The client no longer needs those saves for durability: the server owns the
 * run (activeRuns.js) and journals it (runJournal.js), a reload reattaches and
 * replays it, and persistTurnTranscript writes the saved row when the turn
 * ends with no client involved. So the contract is:
 *
 *   content_delta  → NO autosave, however long the stream runs
 *   done           → one autosave (debounced, as before)
 *   run_ended      → one immediate autosave (as before)
 */
describe('stream persistence in the desktop chat store', () => {
  let store;
  let dispatch;
  let now;
  let convCounter = 0;
  let CONV;
  const MSG = 'm-stream';

  const commit = (type, payload) => store.commit(`chat/${type}`, payload);
  const emit = (name, data) =>
    handleScopedStreamEvent({ commit, state: store.state.chat, dispatch }, name, data, CONV);
  const autosaves = () => dispatch.mock.calls.filter(([action]) => action === 'autosaveConversation');

  beforeEach(() => {
    CONV = `conv-stream-${++convCounter}`;
    now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    localStorage.setItem('token', 't');
    dispatch = vi.fn();
    store = createStore({
      modules: {
        chat: chatModule,
        aiProvider: {
          namespaced: false,
          state: { selectedProvider: 'anthropic', selectedModel: 'claude', reasoningValue: 'default', reasoningEnabled: false },
        },
      },
    });
    commit('ENSURE_CONVERSATION', CONV);
    commit('SET_ACTIVE_CONVERSATION', CONV);
    emit('assistant_message', { id: MSG, role: 'assistant', content: '', toolCalls: [], timestamp: 1 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('a long stream of content deltas never autosaves the transcript', () => {
    // Ten minutes of streaming, one delta every 2 s — the old throttle fired
    // on the first delta and then every 5 s (120 saves).
    for (let i = 0; i < 300; i++) {
      emit('content_delta', { assistantMessageId: MSG, delta: `word${i} ` });
      now += 2000;
    }
    const message = store.state.chat.conversations[CONV].messages.find((m) => m.id === MSG);
    expect(message.content.startsWith('word0 word1 ')).toBe(true);
    expect(message.content.endsWith('word299 ')).toBe(true);
    expect(autosaves()).toEqual([]);
  });

  it('the end of the turn still saves exactly once, debounced as before', () => {
    emit('content_delta', { assistantMessageId: MSG, delta: 'final answer' });
    emit('done', {});
    expect(autosaves()).toEqual([['autosaveConversation', { debounce: true, conversationId: CONV }]]);
  });

  it('a reattached run that ends without done still saves immediately', () => {
    emit('content_delta', { assistantMessageId: MSG, delta: 'replayed answer' });
    emit('run_ended', {});
    expect(autosaves()).toEqual([['autosaveConversation', { debounce: false, conversationId: CONV }]]);
  });
});
