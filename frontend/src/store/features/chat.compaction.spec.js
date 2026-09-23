import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from 'vuex';
import chatModule, { buildChatHistory } from './chat.js';
import { WIRE_PREAMBLE, WIRE_ACK, createCompactionMessage } from '@/services/conversationCompaction.js';

/**
 * Context & Cost → Compress.
 *
 * The contract this pins: compressing NEVER deletes a message. It inserts one
 * fold marker; the wire history becomes summary + tail; undo removes the
 * marker and the wire history is byte-identical to what it was before.
 */

const CONV = 'conv-1';
const u = (id, content) => ({ id, role: 'user', content, timestamp: 1 });
const a = (id, content, toolCalls) => ({ id, role: 'assistant', content, timestamp: 2, ...(toolCalls ? { toolCalls } : {}) });

const HISTORY = [
  u('m1', 'Read config.json and tell me the port'),
  a('m2', 'It is 3333.', [{ id: 'tc1', name: 'read_file', args: { path: 'config.json' }, result: '{"port":3333}' }]),
  u('m3', 'Now the db path'),
  a('m4', 'data/app.sqlite'),
  u('m5', 'Change the port to 4444'),
  a('m6', 'Done, port is now 4444.'),
  u('m7', 'And restart'),
  a('m8', 'Restarted.'),
];

describe('buildChatHistory folds at the marker', () => {
  it('emits summary + ack + tail, dropping folded tool rows too', () => {
    const marker = createCompactionMessage({ summary: 'SUMMARY', foldedCount: 4, tokensBefore: 100, tokensAfter: 20 });
    const msgs = [...HISTORY.slice(0, 4), marker, ...HISTORY.slice(4)];
    const wire = buildChatHistory(msgs, 'anthropic');
    expect(wire[0]).toEqual({ role: 'user', content: `${WIRE_PREAMBLE}\n\nSUMMARY` });
    expect(wire[1]).toEqual({ role: 'assistant', content: WIRE_ACK });
    expect(wire.slice(2).map((m) => m.content)).toEqual([
      'Change the port to 4444', 'Done, port is now 4444.', 'And restart', 'Restarted.',
    ]);
    // The folded tool round-trip is gone from the wire.
    expect(wire.some((m) => m.role === 'tool')).toBe(false);
  });
});

describe('chat/compressConversation and chat/undoCompaction', () => {
  let store;
  let fetchMock;
  let compressBody;

  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    compressBody = null;
    fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes('/orchestrator/compress')) {
        compressBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            summary: '## Goal\nPort changed to 4444 in config.json; db at data/app.sqlite.',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            executionId: 'exec-1',
            estimatedCost: 0.0123,
            tokenUsage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'out-1', output: { id: 'out-1' } }) };
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
    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: CONV, messages: HISTORY.map((m) => ({ ...m })) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const messages = () => store.state.chat.conversations[CONV].messages;

  it('sends the FOLDED slice in wire format, inserts the marker at the fold, deletes nothing', async () => {
    const before = buildChatHistory(messages(), 'anthropic');
    const result = await store.dispatch('chat/compressConversation', {
      conversationId: CONV, provider: 'anthropic', model: 'claude-sonnet-4-5', tokensBefore: 143201,
    });
    expect(result.ok).toBe(true);

    // What went to the server: the four folded messages as wire history,
    // including the tool call + result the summariser needs.
    expect(compressBody.provider).toBe('anthropic');
    expect(compressBody.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant']);
    expect(compressBody.messages[1].tool_calls[0].function.name).toBe('read_file');

    // The store: 8 originals + 1 marker, marker sits before m5.
    const msgs = messages();
    expect(msgs.length).toBe(HISTORY.length + 1);
    const markerIdx = msgs.findIndex((m) => m.role === 'compaction');
    expect(markerIdx).toBe(4);
    expect(msgs[markerIdx + 1].id).toBe('m5');
    expect(msgs[markerIdx].compaction).toMatchObject({
      foldedCount: 4, tokensBefore: 143201, estimatedCost: 0.0123, model: 'claude-sonnet-4-5', executionId: 'exec-1',
    });
    expect(HISTORY.every((h) => msgs.some((m) => m.id === h.id))).toBe(true);

    // The wire: summary + ack + the 4-message tail; strictly shorter than before.
    const after = buildChatHistory(msgs, 'anthropic');
    expect(after[0].content.startsWith(WIRE_PREAMBLE)).toBe(true);
    expect(after.length).toBe(2 + 4);
    expect(after.length).toBeLessThan(before.length);
    expect(store.state.chat.conversations[CONV].isCompacting).toBe(false);
    expect(store.state.chat.conversations[CONV].compactionError).toBe(null);
  });

  it('undo restores a byte-identical wire history', async () => {
    const before = JSON.stringify(buildChatHistory(messages(), 'anthropic'));
    await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'anthropic', model: 'x' });
    expect(messages().some((m) => m.role === 'compaction')).toBe(true);
    const undone = await store.dispatch('chat/undoCompaction', { conversationId: CONV });
    expect(undone).toBe(true);
    expect(messages().some((m) => m.role === 'compaction')).toBe(false);
    expect(JSON.stringify(buildChatHistory(messages(), 'anthropic'))).toBe(before);
  });

  it('refuses while streaming, when too short, and records a failure without touching messages', async () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: CONV, value: true });
    expect((await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' })).reason).toBe('streaming');
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: CONV, value: false });

    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: CONV, messages: HISTORY.slice(0, 3).map((m) => ({ ...m })) });
    expect((await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' })).reason).toBe('too_short');

    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: CONV, messages: HISTORY.map((m) => ({ ...m })) });
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 502, json: async () => ({ success: false, error: 'provider down' }) }));
    const failed = await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe('provider down');
    expect(store.state.chat.conversations[CONV].compactionError).toBe('provider down');
    expect(store.state.chat.conversations[CONV].isCompacting).toBe(false);
    expect(messages().length).toBe(HISTORY.length);
  });

  it('does not apply a stale summary after the folded history changes', async () => {
    let release;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    store.commit('chat/SCOPED_SET_MESSAGE_CONTENT', { conversationId: CONV, messageId: 'm1', content: 'Corrected request' });
    release({ ok: true, json: async () => ({ success: true, summary: 'STALE' }) });
    expect((await pending).ok).toBe(false);
    expect(messages().some(m => m.role === 'compaction')).toBe(false);
    expect(messages()[0].content).toBe('Corrected request');
  });

  it('does not append a stale marker when its retained boundary disappears', async () => {
    let release;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    store.commit('chat/SCOPED_REMOVE_MESSAGE', { conversationId: CONV, messageId: 'm5' });
    release({ ok: true, json: async () => ({ success: true, summary: 'STALE' }) });
    expect((await pending).ok).toBe(false);
    expect(messages().some(m => m.role === 'compaction')).toBe(false);
  });

  it('the per-conversation model override wins over the global selection', async () => {
    store.commit('chat/SET_CONV_AI', { conversationId: CONV, ai: { provider: 'openai', model: 'gpt-5' } });
    await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'anthropic', model: 'claude' });
    expect(compressBody.provider).toBe('openai');
    expect(compressBody.model).toBe('gpt-5');
  });

  it('editing the summary changes what the model reads and nothing else', async () => {
    await store.dispatch('chat/compressConversation', { conversationId: CONV, provider: 'p', model: 'm' });
    const marker = messages().find((m) => m.role === 'compaction');
    await store.dispatch('chat/updateCompactionSummary', { conversationId: CONV, messageId: marker.id, content: 'EDITED' });
    const wire = buildChatHistory(messages(), 'anthropic');
    expect(wire[0].content).toBe(`${WIRE_PREAMBLE}\n\nEDITED`);
    expect(messages().length).toBe(HISTORY.length + 1);
  });
});
