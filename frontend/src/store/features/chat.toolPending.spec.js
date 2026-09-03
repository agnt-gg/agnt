import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule, { handleScopedStreamEvent } from './chat.js';

/**
 * THE "TOOLS FEEL HUNG" CONTRACT
 * ------------------------------
 * The backend announces a tool the moment the model names it (`tool_pending`,
 * from the Anthropic transport's content_block_start), BEFORE a single byte of
 * arguments has streamed. `tool_start` follows once the arguments are complete.
 * For a long write_file that gap is the whole file: tens of seconds during
 * which the desktop chat showed "Annie is thinking…" and nothing else, because
 * handleScopedStreamEvent had no case for tool_pending.
 *
 * Two facts, one id, one card:
 *   tool_pending → the card exists, name known, arguments not yet.
 *   tool_start   → the SAME card gains its arguments. Never a second card.
 *
 * And because cards now exist earlier, the settlement that fires when a
 * stream ends must cover them — a pending card that never got a tool_start
 * is exactly the #88 window on the client side.
 */
describe('tool_pending in the desktop chat store', () => {
  let store;
  let convCounter = 0;
  let CONV;
  const MSG = 'm-live';

  const commit = (type, payload) => store.commit(`chat/${type}`, payload);
  const emit = (name, data) =>
    handleScopedStreamEvent({ commit, state: store.state.chat, dispatch: null }, name, data, CONV);
  const message = () => store.state.chat.conversations[CONV].messages.find((m) => m.id === MSG);

  beforeEach(() => {
    CONV = `conv-pending-${++convCounter}`;
    localStorage.setItem('token', 't');
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

  it('draws the card as soon as the model names the tool', () => {
    emit('tool_pending', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'write_file' } });
    expect(message().toolCalls).toEqual([{ id: 'c1', name: 'write_file', status: 'pending' }]);
    expect(message().contentParts).toEqual([{ type: 'tool_call', toolCallId: 'c1' }]);
  });

  it('tool_start fills in the arguments on the SAME card — never a second one', () => {
    emit('tool_pending', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'write_file' } });
    emit('tool_start', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'write_file', args: { path: 'a.txt' } } });

    expect(message().toolCalls).toHaveLength(1);
    expect(message().toolCalls[0]).toMatchObject({ id: 'c1', name: 'write_file', args: { path: 'a.txt' } });
    // One card, one slot in the interleave.
    expect(message().contentParts.filter((p) => p.type === 'tool_call')).toHaveLength(1);
  });

  it('a tool_start with no prior tool_pending still works exactly as before', () => {
    // Chat-completions providers announce only at tool_start.
    emit('tool_start', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'web_search', args: { q: 'x' } } });
    expect(message().toolCalls).toEqual([{ id: 'c1', name: 'web_search', args: { q: 'x' } }]);
  });

  it('tool_end after tool_pending alone completes the card (arguments never arrived)', () => {
    // The backend emits tool_end without tool_start when argument parsing fails.
    emit('tool_pending', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'write_file' } });
    emit('tool_end', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'write_file', error: 'bad json' } });
    expect(message().toolCalls[0]).toMatchObject({ id: 'c1', error: 'bad json' });
  });

  it('a pending card is settled as interrupted when the stream ends', () => {
    // THE #88 WINDOW, CLIENT SIDE. Three announced, Stop pressed, no
    // tool_start ever arrives. Whether or not the server's settlement reaches
    // us, the cards must not spin.
    for (const id of ['c1', 'c2', 'c3']) {
      emit('tool_pending', { assistantMessageId: MSG, toolCall: { id, name: 'execute_shell_command' } });
    }
    commit('SCOPED_SET_STREAMING', { conversationId: CONV, value: true });
    commit('SCOPED_SET_STREAMING', { conversationId: CONV, value: false });

    const statuses = message().toolCalls.map((tc) => tc.status);
    expect(statuses).toEqual(['interrupted', 'interrupted', 'interrupted']);
  });

  it("the server's interrupted tool_end lands on a pending card", () => {
    emit('tool_pending', { assistantMessageId: MSG, toolCall: { id: 'c1', name: 'execute_shell_command' } });
    emit('tool_end', {
      assistantMessageId: MSG,
      toolCall: { id: 'c1', name: 'execute_shell_command', result: '{"interrupted":true}', error: 'interrupted', status: 'interrupted' },
    });
    expect(message().toolCalls[0].status).toBe('interrupted');
  });
});

describe('SCOPED_ADD_TOOL_CALL is an upsert by id', () => {
  let store;
  const CONV = 'conv-upsert';
  const MSG = 'm1';

  beforeEach(() => {
    localStorage.setItem('token', 't');
    store = createStore({ modules: { chat: chatModule } });
    store.commit('chat/ENSURE_CONVERSATION', CONV);
    store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: CONV, message: { id: MSG, role: 'assistant', content: '' } });
  });

  it('a second add for the same id merges fields and replaces the object', () => {
    const add = (toolCall) => store.commit('chat/SCOPED_ADD_TOOL_CALL', { conversationId: CONV, messageId: MSG, toolCall });
    add({ id: 'c1', name: 'write_file', status: 'pending' });
    const before = store.state.chat.conversations[CONV].messages[0].toolCalls[0];
    add({ id: 'c1', name: 'write_file', args: { path: 'x' } });
    const after = store.state.chat.conversations[CONV].messages[0].toolCalls[0];

    expect(after).toMatchObject({ id: 'c1', name: 'write_file', args: { path: 'x' } });
    // New identity: renderers that memoise on the object must see the change.
    expect(after).not.toBe(before);
    expect(store.state.chat.conversations[CONV].messages[0].contentParts).toHaveLength(1);
  });

  it('a merge never erases a field the update did not mention', () => {
    const add = (toolCall) => store.commit('chat/SCOPED_ADD_TOOL_CALL', { conversationId: CONV, messageId: MSG, toolCall });
    add({ id: 'c1', name: 'write_file', args: { path: 'x' } });
    add({ id: 'c1', name: 'write_file' });
    expect(store.state.chat.conversations[CONV].messages[0].toolCalls[0].args).toEqual({ path: 'x' });
  });
});
