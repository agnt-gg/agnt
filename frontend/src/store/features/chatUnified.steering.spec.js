// Mid-run steering: transcript ordering contract.
//
// A turn used to stream into exactly ONE assistant bubble for its entire life.
// When a steer landed at a tool-round seam the frontend pushed the steer text
// as a new user message at the TAIL of the transcript -- but every subsequent
// content_delta still targeted the assistant bubble that already sat ABOVE it.
// Net effect: the agent's post-steer output rendered above the steer, so the
// steer appeared to land after the very work it caused.
//
// The fix splits the assistant turn at the seam: the backend seals the
// outgoing bubble (carrying its id on `steering_applied`) and mints a fresh
// `assistant_message` immediately after, so post-steer deltas land BELOW the
// steer. These tests pin that contract end to end through the real event
// handler and the real mutations.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({ streamChat: vi.fn(), toChatHistory: vi.fn() }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

const CHANNEL = 'agent:test';

let chatUnified;
let handleStreamEvent;
let state;
let commit;

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

/** Drive one SSE event through the real handler. */
const emit = (eventName, data) =>
  handleStreamEvent({ commit, channelKey: CHANNEL, eventName, data });

const messages = () => state.conversations[CHANNEL].messages;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('./chatUnified.js');
  chatUnified = mod.default;
  handleStreamEvent = mod.handleStreamEvent;
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`unknown mutation: ${type}`);
    fn(state, payload);
  };
  // Seed the turn: user asks, assistant bubble opens, agent talks, calls a tool.
  commit('ADD_MESSAGE', {
    channelKey: CHANNEL,
    message: { id: 'u1', role: 'user', content: 'do the thing' },
  });
  emit('assistant_message', { id: 'A1', role: 'assistant', content: '' });
  emit('content_delta', { assistantMessageId: 'A1', delta: 'PRE-STEER ' });
  emit('tool_start', { assistantMessageId: 'A1', toolCall: { id: 't1', name: 'web_search' } });
  emit('tool_end', { assistantMessageId: 'A1', toolCall: { id: 't1', name: 'web_search', result: 'ok' } });
});

describe('mid-run steer splits the assistant turn', () => {
  it('orders the transcript [user, pre-steer assistant, steer, post-steer assistant]', () => {
    emit('steering_applied', { content: 'actually use python', round: 1, assistantMessageId: 'A1' });
    emit('assistant_message', { id: 'A2', role: 'assistant', content: '', steerContinuation: true });
    emit('content_delta', { assistantMessageId: 'A2', delta: 'POST-STEER ' });

    expect(messages().map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    const [, pre, steer, post] = messages();
    expect(pre.id).toBe('A1');
    expect(steer.content).toBe('actually use python');
    expect(steer.steered).toBe(true);
    expect(post.id).toBe('A2');
  });

  it('routes post-steer content BELOW the steer, never back into the sealed bubble', () => {
    emit('steering_applied', { content: 'stop, pivot', round: 1, assistantMessageId: 'A1' });
    emit('assistant_message', { id: 'A2', role: 'assistant', content: '' });
    emit('content_delta', { assistantMessageId: 'A2', delta: 'POST-STEER answer' });

    const [, pre, steerMsg, post] = messages();

    // The regression: post-steer prose leaking into the bubble above the steer.
    expect(pre.content).toBe('PRE-STEER ');
    expect(pre.content).not.toContain('POST-STEER');
    expect(post.content).toBe('POST-STEER answer');

    // And the steer must sit strictly between them.
    expect(messages().indexOf(steerMsg)).toBeGreaterThan(messages().indexOf(pre));
    expect(messages().indexOf(steerMsg)).toBeLessThan(messages().indexOf(post));
  });

  it('routes post-steer tool calls into the continuation bubble', () => {
    emit('steering_applied', { content: 'use python instead', round: 1, assistantMessageId: 'A1' });
    emit('assistant_message', { id: 'A2', role: 'assistant', content: '' });
    emit('tool_start', { assistantMessageId: 'A2', toolCall: { id: 't2', name: 'execute_python' } });

    const [, pre, , post] = messages();
    expect(pre.toolCalls.map((t) => t.name)).toEqual(['web_search']);
    expect(post.toolCalls.map((t) => t.name)).toEqual(['execute_python']);
  });

  it('seals the outgoing bubble so it does not spin forever', () => {
    // Pre-condition: A1 is mid-flight with a live status.
    expect(state.messageStates[CHANNEL]?.A1).toBeTruthy();

    emit('steering_applied', { content: 'nudge', round: 1, assistantMessageId: 'A1' });
    emit('assistant_message', { id: 'A2', role: 'assistant', content: '' });
    // final_content only ever carries the LAST id; A1 must already be clear.
    emit('final_content', { assistantMessageId: 'A2', content: 'done' });

    expect(state.messageStates[CHANNEL]?.A1 ?? null).toBeNull();
  });

  it('clears the pending-steer chip when the steer drains', () => {
    commit('SET_PENDING_STEER', { channelKey: CHANNEL, content: 'nudge' });
    expect(state.pendingSteers[CHANNEL]).toBe('nudge');

    emit('steering_applied', { content: 'nudge', round: 1, assistantMessageId: 'A1' });

    expect(state.pendingSteers[CHANNEL]).toBeUndefined();
  });

  it('keeps working when the backend omits assistantMessageId (older server)', () => {
    emit('steering_applied', { content: 'legacy steer', round: 1 });

    const roles = messages().map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']);
    expect(messages()[2].steered).toBe(true);
  });
});
