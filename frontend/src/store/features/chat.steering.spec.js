// Mid-run steering: transcript ordering contract for the MAIN Annie chat.
//
// Sibling of chatUnified.steering.spec.js. That file pins the sidebar/unified
// surface; this one pins `chat.js`, which backs the primary orchestrator chat
// screen and is a completely separate event handler with its own mutations.
// The bug reproduced on BOTH surfaces, so both need the contract pinned or a
// future refactor can silently regress the one nobody tested.
//
// The contract: when a steer drains at a tool-round seam, the backend seals
// the outgoing assistant bubble and mints a fresh one. The transcript must
// therefore read in true chronological order:
//
//   [user] [assistant: pre-steer] [user: steer] [assistant: post-steer]
//
// and post-steer content must never flow back into the sealed bubble.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const CONV = 'conv-1';

let chat;
let handleScopedStreamEvent;
let state;
let commit;

const makeState = () => ({
  activeConversationId: CONV,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {
    [CONV]: {
      conversationId: CONV,
      messages: [],
      pendingSteer: '',
      isStreaming: true,
      savedOutputId: null,
    },
  },
});

/** Drive one SSE event through the real scoped handler. */
const emit = (eventName, data) =>
  handleScopedStreamEvent({ commit, state, dispatch: vi.fn() }, eventName, data, CONV);

const transcript = () =>
  state.conversations[CONV].messages.map((m) => `${m.role}:${m.content}`);

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('./chat.js');
  chat = mod.default;
  handleScopedStreamEvent = mod.handleScopedStreamEvent;
  state = makeState();
  // Real mutations, real state — only the commit indirection is stubbed.
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
});

/**
 * Replay the exact backend event sequence for a turn that gets steered at the
 * seam of tool round 1.
 */
const runSteeredTurn = () => {
  state.conversations[CONV].messages.push({
    id: 'u1', role: 'user', content: 'do the thing', timestamp: 1,
  });
  emit('assistant_message', { id: 'A1', role: 'assistant', content: '', toolCalls: [] });
  emit('content_delta', { assistantMessageId: 'A1', delta: 'working' });
  emit('steering_applied', { content: 'actually do it differently', round: 1, assistantMessageId: 'A1' });
  emit('assistant_message', { id: 'A2', role: 'assistant', content: '', toolCalls: [], steerContinuation: true });
  emit('content_delta', { assistantMessageId: 'A2', delta: 'rerouted' });
};

describe('mid-run steer splits the assistant turn (main chat / chat.js)', () => {
  it('orders the transcript [user, pre-steer assistant, steer, post-steer assistant]', () => {
    runSteeredTurn();

    expect(transcript()).toEqual([
      'user:do the thing',
      'assistant:working',
      'user:actually do it differently',
      'assistant:rerouted',
    ]);
  });

  it('routes post-steer content BELOW the steer, never back into the sealed bubble', () => {
    runSteeredTurn();
    const msgs = state.conversations[CONV].messages;

    const steerIdx = msgs.findIndex((m) => m.steered);
    const sealed = msgs.find((m) => m.id === 'A1');
    const continuation = msgs.find((m) => m.id === 'A2');

    // The sealed bubble froze at its pre-steer content.
    expect(sealed.content).toBe('working');
    expect(sealed.content).not.toContain('rerouted');
    // And the continuation sits strictly after the steer.
    expect(msgs.indexOf(sealed)).toBeLessThan(steerIdx);
    expect(msgs.indexOf(continuation)).toBeGreaterThan(steerIdx);
  });

  it('routes post-steer tool calls into the continuation bubble', () => {
    runSteeredTurn();
    emit('tool_start', { assistantMessageId: 'A2', toolCall: { id: 't9', name: 'web_search', args: {} } });

    const msgs = state.conversations[CONV].messages;
    expect(msgs.find((m) => m.id === 'A1').toolCalls ?? []).toHaveLength(0);
    expect(msgs.find((m) => m.id === 'A2').toolCalls).toHaveLength(1);
    expect(msgs.find((m) => m.id === 'A2').toolCalls[0].name).toBe('web_search');
  });

  it('marks the steer message so the UI can render the interruption seam', () => {
    runSteeredTurn();
    const steer = state.conversations[CONV].messages.find((m) => m.role === 'user' && m.steered);

    expect(steer).toBeDefined();
    expect(steer.content).toBe('actually do it differently');
  });

  it('clears the pending-steer chip on the owning conversation when the steer drains', () => {
    state.conversations[CONV].pendingSteer = 'actually do it differently';
    state.pendingSteer = 'actually do it differently';

    runSteeredTurn();

    expect(state.conversations[CONV].pendingSteer).toBe('');
    expect(state.pendingSteer).toBe('');
  });

  it('keeps working when the backend omits assistantMessageId (older server)', () => {
    state.conversations[CONV].messages.push({ id: 'u1', role: 'user', content: 'go', timestamp: 1 });
    emit('assistant_message', { id: 'A1', role: 'assistant', content: '', toolCalls: [] });
    emit('content_delta', { assistantMessageId: 'A1', delta: 'working' });

    expect(() => emit('steering_applied', { content: 'nudge', round: 1 })).not.toThrow();

    // Steer still lands in the transcript even without the seal hint.
    expect(transcript()).toEqual(['user:go', 'assistant:working', 'user:nudge']);
  });
});
