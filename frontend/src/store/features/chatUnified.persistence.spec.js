// PRD-058: debounced persistence for the unified chat store.
//
// persistConversations used to synchronously JSON.stringify the ENTIRE
// multi-channel conversations object on every mutation (14 call sites) —
// multi-MB serializations per tool event during streaming. These tests pin
// the debounce contract:
//   1. a burst of mutations produces exactly ONE localStorage write,
//   2. the end of a stream (SET_STREAMING → false) flushes immediately,
//   3. a continuous mutation stream cannot postpone durability past the
//      max-latency cap,
//   4. the explicit PERSIST_CONVERSATIONS mutation writes through,
//   5. what lands in localStorage is the filtered, up-to-date state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({ streamChat: vi.fn(), toChatHistory: vi.fn() }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

const STORAGE_KEY = 'unifiedChatConversations';

let chatUnified;
let setItemSpy;
let state;

const makeState = () => ({
  conversations: {},
  streamingChannels: {},
  loadingSuggestionsChannels: {},
  expandedToolCalls: {},
  runningToolCalls: {},
  messageStates: {},
  abortControllers: {},
  pendingSteers: {},
  _migrated: {},
});

const addMessage = (i) =>
  chatUnified.mutations.ADD_MESSAGE(state, {
    channelKey: 'agent:test',
    message: { id: `m${i}`, role: 'user', content: `msg ${i}` },
  });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
  chatUnified = (await import('./chatUnified.js')).default;
  setItemSpy.mockClear(); // ignore any import-time writes
  state = makeState();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  setItemSpy.mockRestore();
});

describe('chatUnified debounced persistence (PRD-058)', () => {
  it('collapses a burst of mutations into a single localStorage write', () => {
    for (let i = 0; i < 14; i++) addMessage(i);

    expect(setItemSpy).not.toHaveBeenCalled(); // nothing during the burst

    vi.advanceTimersByTime(600);
    const writes = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
    expect(writes).toHaveLength(1);
  });

  it('flushes immediately when a stream ends (SET_STREAMING → false)', () => {
    addMessage(1);
    expect(setItemSpy).not.toHaveBeenCalled();

    chatUnified.mutations.SET_STREAMING(state, { channelKey: 'agent:test', isStreaming: false });

    const writes = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
    expect(writes).toHaveLength(1);
  });

  it('caps persistence latency under a continuous mutation stream', () => {
    // Mutate every 100ms for 6s — each mutation resets the trailing debounce,
    // so without the cap nothing would ever be written.
    for (let i = 0; i < 60; i++) {
      addMessage(i);
      vi.advanceTimersByTime(100);
    }
    const writes = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
    expect(writes.length).toBeGreaterThanOrEqual(1);
  });

  it('writes through immediately on the explicit PERSIST_CONVERSATIONS mutation', () => {
    addMessage(1);
    chatUnified.mutations.PERSIST_CONVERSATIONS(state);

    const writes = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY);
    expect(writes).toHaveLength(1);

    // The pending debounce was consumed — no duplicate write later.
    vi.advanceTimersByTime(1000);
    expect(setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY)).toHaveLength(1);
  });

  it('persists the latest state, filtered to non-empty conversations', () => {
    addMessage(1);
    addMessage(2);
    state.conversations['agent:empty'] = { messages: [], conversationId: null, lastUpdate: 0, suggestions: [] };

    vi.advanceTimersByTime(600);

    const [, payload] = setItemSpy.mock.calls.filter(([k]) => k === STORAGE_KEY).at(-1);
    const parsed = JSON.parse(payload);
    expect(parsed['agent:test'].messages).toHaveLength(2);
    expect(parsed['agent:test'].messages[1].content).toBe('msg 2');
    expect(parsed['agent:empty']).toBeUndefined(); // empty channels filtered out
  });

  it('streaming APPEND_MESSAGE_CONTENT hot path never schedules a write', () => {
    addMessage(1);
    vi.advanceTimersByTime(600);
    setItemSpy.mockClear();

    for (let i = 0; i < 50; i++) {
      chatUnified.mutations.APPEND_MESSAGE_CONTENT(state, {
        channelKey: 'agent:test',
        messageId: 'm1',
        delta: 'x',
      });
    }
    vi.advanceTimersByTime(5000);
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
