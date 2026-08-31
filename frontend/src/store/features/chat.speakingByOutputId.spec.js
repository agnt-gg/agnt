/**
 * WHO IS TALKING RIGHT NOW, per sidebar row.
 *
 * The sidebar already shows THAT a conversation is running. In a group chat
 * with four agents on the floor, "something is happening over there" is much
 * less useful than "Sol is answering" — this is the derivation behind that
 * line, and behind the ring on the speaking avatar.
 *
 * The invariant worth protecting: this getter and `streamingOutputIds` walk
 * the same conversations under the same activity test, so a row can never be
 * marked streaming while claiming nobody is speaking, or vice versa.
 */
import { describe, it, expect } from 'vitest';
import chat, { currentSpeakerOfConversation } from './chat.js';
import { ANNIE_ID, ANNIE_NAME } from '@/utils/agentAvatar.js';

const getters = (state) => {
  const bag = {};
  for (const [name, fn] of Object.entries(chat.getters)) {
    Object.defineProperty(bag, name, { get: () => fn(state, bag, {}, {}), enumerable: true });
  }
  return bag;
};

const conversation = (over = {}) => ({
  messages: [],
  savedOutputId: 'out-1',
  isStreaming: false,
  activeAsyncTools: new Set(),
  ...over,
});

describe('currentSpeakerOfConversation', () => {
  it('names the agent whose message is being written', () => {
    expect(
      currentSpeakerOfConversation({
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: 'on it', agentId: 'a1', agentName: 'Sol' },
        ],
      }),
    ).toEqual({ id: 'a1', name: 'Sol' });
  });

  it('names Annie for an assistant message with no attribution', () => {
    expect(
      currentSpeakerOfConversation({
        messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'sure' }],
      }),
    ).toEqual({ id: ANNIE_ID, name: ANNIE_NAME });
  });

  it('reads the LAST speaker, not the first', () => {
    expect(
      currentSpeakerOfConversation({
        messages: [
          { role: 'assistant', agentId: 'a1', agentName: 'Sol' },
          { role: 'assistant', agentId: 'a2', agentName: 'Fable' },
        ],
      }),
    ).toEqual({ id: 'a2', name: 'Fable' });
  });

  it('does NOT credit the previous speaker while the user\'s turn is in flight', () => {
    // The user has just sent a message and nothing has come back. Walking
    // past it to the last assistant message would put a live "speaking" ring
    // on whoever happened to answer last time.
    expect(
      currentSpeakerOfConversation({
        messages: [
          { role: 'assistant', agentId: 'a1', agentName: 'Sol' },
          { role: 'user', content: 'actually, wait' },
        ],
      }),
    ).toEqual({ id: ANNIE_ID, name: ANNIE_NAME });
  });

  it('uses the floor queue when a turn has been handed on but not started', () => {
    expect(
      currentSpeakerOfConversation({
        messages: [{ role: 'user', content: 'ask Fable' }],
        floorQueue: [{ agentId: 'a2', agentName: 'Fable' }],
      }),
    ).toEqual({ id: 'a2', name: 'Fable' });
  });

  it('falls back to Annie for an empty or malformed conversation', () => {
    for (const conv of [{}, { messages: null }, { messages: [] }, null, undefined]) {
      expect(currentSpeakerOfConversation(conv)).toEqual({ id: ANNIE_ID, name: ANNIE_NAME });
    }
  });

  it('names an agent that has a name but no id', () => {
    expect(
      currentSpeakerOfConversation({ messages: [{ role: 'assistant', agentName: 'Sol' }] }),
    ).toEqual({ id: 'Sol', name: 'Sol' });
  });
});

describe('speakingByOutputId', () => {
  it('reports a speaker for a streaming conversation', () => {
    const state = {
      conversations: {
        c1: conversation({
          isStreaming: true,
          messages: [{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }],
        }),
      },
      activeGoalByConv: {},
    };
    expect(getters(state).speakingByOutputId).toEqual({ 'out-1': { id: 'a1', name: 'Sol' } });
  });

  it('reports nothing for an idle conversation', () => {
    const state = {
      conversations: {
        c1: conversation({ messages: [{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }] }),
      },
      activeGoalByConv: {},
    };
    expect(getters(state).speakingByOutputId).toEqual({});
  });

  it('counts a conversation with async tools still running as speaking', () => {
    // The LLM turn is over but work is still in flight — the row is still
    // busy, and the sidebar says so via the same activity test that drives
    // the streaming dot.
    const state = {
      conversations: {
        c1: conversation({
          activeAsyncTools: new Set(['tool-1']),
          messages: [{ role: 'assistant', agentId: 'a1', agentName: 'Sol' }],
        }),
      },
      activeGoalByConv: {},
    };
    expect(getters(state).speakingByOutputId['out-1']).toEqual({ id: 'a1', name: 'Sol' });
  });

  it('skips a conversation that has never been saved — there is no row to label', () => {
    const state = {
      conversations: { c1: conversation({ isStreaming: true, savedOutputId: null }) },
      activeGoalByConv: {},
    };
    expect(getters(state).speakingByOutputId).toEqual({});
  });

  it('agrees with streamingOutputIds on exactly which rows are busy', () => {
    // The invariant: these two getters must never disagree, or a row shows a
    // streaming dot with no speaker, or a speaker with no dot.
    const state = {
      conversations: {
        c1: conversation({ savedOutputId: 'out-1', isStreaming: true }),
        c2: conversation({ savedOutputId: 'out-2' }),
        c3: conversation({ savedOutputId: 'out-3', activeAsyncTools: new Set(['t']) }),
        c4: conversation({ savedOutputId: null, isStreaming: true }),
      },
      activeGoalByConv: {},
    };
    const bag = getters(state);
    expect(Object.keys(bag.speakingByOutputId).sort()).toEqual([...bag.streamingOutputIds].sort());
  });
});
