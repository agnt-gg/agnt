/**
 * A STEER BELONGS TO ITS TURN, NOT TO WHATEVER IS ON SCREEN.
 *
 * THE BUG THIS FILE EXISTS FOR
 * ----------------------------
 * Reported as "one message fires off multiple runs", with the discriminator
 * that made it solvable: it happens IF YOU CLICK AWAY, and not if you stay.
 *
 * Submitting while a turn streams does not send — it parks a steer. The write
 * went to `state.activeConversationId` (the chat ON SCREEN) and the auto-fire
 * that drained it lived in Chat.vue reading the FLAT mirror, which also always
 * names the chat on screen. Identical ids, right up until you navigate:
 *
 *   1. the owning conversation's steer was never drained, because the view
 *      doing the draining was looking at a different conversation, and
 *   2. `syncMirror` republishes a conversation's parked steer into the flat
 *      mirror on every switch, so `watch(pendingSteer)` fired on HYDRATION and
 *      sent it again when the user came back.
 *
 * The production evidence was a prompt that contained the previous prompt
 * joined by a newline — the buffer appends, so an orphan accumulates:
 *
 *   run 1: "Um, tell me a little bit about yourself."
 *   run 2: "Um, tell me a little bit about yourself.\nWhat kind of things do
 *           you build?"        (started 92ms after run 1 ended)
 *
 * 92ms is not a human. That is a machine re-firing on stream completion.
 *
 * These tests drive the real mutations and the real action against two live
 * conversations, because a single-conversation test cannot see this class of
 * bug at all — the two ids are equal and every wrong lookup looks right.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
// The socket ack is controllable: `steerInFlight` AWAITS it before parking the
// steer, and that await is a real window in which the user can navigate.
let ackGate = null;
vi.mock('@/composables/useRealtimeSync.js', () => ({
  emitSteer: vi.fn(async () => (ackGate ? ackGate.then(() => ({ ok: true })) : { ok: true })),
  emitClearSteer: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const A = 'conv-A'; // the conversation the user steers, then leaves
const B = 'conv-B'; // the conversation they click away to

let chat;
let handleScopedStreamEvent;
let state;
let commit;
let dispatch;
let sent; // every startStreamingConversation call, in order

const conv = (id, over = {}) => ({
  conversationId: id,
  messages: [],
  pendingSteer: '',
  isStreaming: false,
  savedOutputId: null,
  floorQueue: [],
  floorTurnsUsed: 0,
  lastFloorAgentId: null,
  ...over,
});

const makeState = () => ({
  activeConversationId: A,
  currentConversationId: A,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  isStreaming: true,
  conversations: {
    [A]: conv(A, { isStreaming: true }),
    [B]: conv(B),
  },
});

/** Drive one SSE event through the real scoped handler for a given conv. */
const emit = (eventName, data, conversationId) =>
  handleScopedStreamEvent({ commit, state, dispatch }, eventName, data, conversationId);

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('./chat.js');
  chat = mod.default;
  handleScopedStreamEvent = mod.handleScopedStreamEvent;
  state = makeState();
  sent = [];

  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });

  // Real actions, real mutations. Only the outbound send is captured, and
  // it marks the conversation streaming exactly as the real one does — so a
  // second drain sees a busy conversation, like production.
  dispatch = vi.fn(async (type, payload) => {
    if (type === 'startStreamingConversation') {
      sent.push(payload);
      const c = state.conversations[payload.conversationId];
      if (c) c.isStreaming = true;
      return true;
    }
    const fn = chat.actions[type];
    if (fn) return fn({ commit, state, dispatch, rootState: { aiProvider: {} } }, payload);
    return undefined;
  });
});

/** The user submits `text` while conversation `id` is mid-turn. */
const steerInto = async (id, text) => {
  state.currentConversationId = id;
  await chat.actions.steerInFlight({ commit, state }, { content: text });
};

/** The user navigates to conversation `id`. */
const switchTo = (id) => {
  commit('SET_ACTIVE_CONVERSATION', id);
};

describe('the steer is parked on the conversation that owns the turn', () => {
  it('writes to the owning conversation, not to whatever is active', async () => {
    await steerInto(A, 'do another');
    switchTo(B);

    expect(state.conversations[A].pendingSteer).toBe('do another');
    expect(state.conversations[B].pendingSteer).toBe('');
  });

  it('lands on the right conversation even if the user navigates mid-ack', async () => {
    /**
     * A NEGATIVE CONTROL FOUND THIS TEST MISSING. Parking by
     * `activeConversationId` passed everything, because at submit time the
     * user IS looking at the conversation they are steering - the two ids are
     * equal and a wrong lookup reads correct.
     *
     * They are not equal across the `await emitSteer(...)` in steerInFlight.
     * Navigate during that round trip and an active-id write parks A's steer
     * on B: the wrong chat later fires a message its user never sent there.
     * Addressing the buffer with the id the socket call was sent to closes it
     * by construction.
     */
    let release;
    ackGate = new Promise((r) => { release = r; });

    const inFlight = steerInto(A, 'do another');
    switchTo(B); // the ack has not come back yet
    release();
    await inFlight;
    ackGate = null;

    expect(state.conversations[A].pendingSteer).toBe('do another');
    expect(state.conversations[B].pendingSteer, 'the steer landed on the wrong chat').toBe('');
  });

  it('does not show another conversation its neighbour\u2019s chip', async () => {
    await steerInto(A, 'do another');
    switchTo(B);

    // The flat mirror drives the "Steer pending" chip. Standing in B, there
    // is nothing pending for B.
    expect(state.pendingSteer).toBe('');
  });
});

describe('the turn ending drains the steer \u2014 once, into its own conversation', () => {
  it('sends the steer to the conversation it was aimed at, not the visible one', async () => {
    await steerInto(A, 'do another');
    switchTo(B); // the user clicks away, exactly as reported

    state.conversations[A].isStreaming = false;
    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0].userInput).toBe('do another');
    expect(sent[0].conversationId, 'the steer was sent to the wrong chat').toBe(A);
  });

  it('THE REPORTED BUG: coming back does not send it a second time', async () => {
    await steerInto(A, 'do another');
    switchTo(B);

    state.conversations[A].isStreaming = false;
    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    // Navigating back re-hydrates the flat mirror from A's slot. Hydration is
    // not a user action and must not send anything.
    state.conversations[A].isStreaming = false;
    switchTo(A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent, 'the steer was replayed on return').toHaveLength(1);
    expect(state.conversations[A].pendingSteer).toBe('');
    expect(state.pendingSteer).toBe('');
  });

  it('two terminators for one run still send once', async () => {
    await steerInto(A, 'do another');
    state.conversations[A].isStreaming = false;

    emit('done', {}, A);
    emit('run_ended', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(1);
  });

  it('a steer the backend already applied is never re-sent', async () => {
    await steerInto(A, 'do another');

    // The backend drained it at a tool-round seam and put it in the transcript.
    emit('steering_applied', { content: 'do another', round: 1, assistantMessageId: 'A1' }, A);
    expect(state.conversations[A].pendingSteer).toBe('');

    state.conversations[A].isStreaming = false;
    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(0);
  });

  it('a stale buffer can no longer accumulate across turns', async () => {
    // The production signature: the second prompt CONTAINED the first, joined
    // by a newline, because an undrained buffer is appended to.
    await steerInto(A, 'Um, tell me a little bit about yourself.');
    switchTo(B);

    state.conversations[A].isStreaming = false;
    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    switchTo(A);
    state.conversations[A].isStreaming = true;
    await steerInto(A, 'What kind of things do you build?');

    expect(state.conversations[A].pendingSteer).toBe('What kind of things do you build?');
    expect(state.conversations[A].pendingSteer).not.toContain('yourself');
  });
});

describe('anti-vacuity \u2014 the feature still works', () => {
  it('a steer whose turn ends without a seam IS sent as a fresh user turn', async () => {
    await steerInto(A, 'actually, use the other file');
    state.conversations[A].isStreaming = false;

    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0].userInput).toBe('actually, use the other file');
    expect(sent[0].conversationId).toBe(A);
  });

  it('a reattached run ending without a normal done still drains', async () => {
    await steerInto(A, 'stop and summarise');
    state.conversations[A].isStreaming = false;

    emit('run_ended', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(sent[0].conversationId).toBe(A);
  });

  it('does not fire while the conversation is still streaming', async () => {
    await steerInto(A, 'do another');
    // isStreaming left true: another run took the conversation.
    await chat.actions.drainPendingSteer(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { conversationId: A }
    );

    expect(sent).toHaveLength(0);
    expect(state.conversations[A].pendingSteer).toBe('do another');
  });

  it('cancelling the chip stops it firing at all', async () => {
    await steerInto(A, 'never mind');
    await chat.actions.cancelSteer({ commit, state }, undefined);

    state.conversations[A].isStreaming = false;
    emit('done', {}, A);
    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toHaveLength(0);
  });
});
