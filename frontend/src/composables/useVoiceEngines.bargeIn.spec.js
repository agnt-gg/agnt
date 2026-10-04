/**
 * After a barge-in, the interrupting turn speaks ITS answer — never the
 * reply it interrupted.
 *
 * The realtime engine stops the old speech and runs the user's new words
 * through runAgntForVoice. That run watches `streamingAnswer`, and on the main
 * chat that is simply "the last message, if it is the assistant's". The
 * interrupted reply is still that message — it keeps streaming until the
 * steer drains — so the new run read it from the top and spoke it again.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';

let realtimeOptions;
vi.mock('./useVoiceSession.js', () => ({
  useVoiceSession: () => ({ isActive: ref(false), state: ref('idle'), error: ref(null), partialTranscript: ref(''), level: ref(0), stop() {}, toggle: async () => false, handleStreamEvent() {} }),
}));
vi.mock('./useRealtimeVoice.js', () => ({
  useRealtimeVoice: (options) => {
    realtimeOptions = options;
    return { state: ref('idle'), isActive: ref(true), error: ref(null), unavailable: ref(false), credentialSource: ref(null), assistantPartial: ref(''), isSupported: true, start: async () => true, stop() {} };
  },
}));
vi.mock('../voice/voiceFloor.js', () => ({ claimVoiceFloor: () => 1, releaseVoiceFloor: () => {} }));
vi.mock('../services/voiceTurn.js', () => ({ armVoiceTurn: () => {} }));

const { useVoiceEngines } = await import('./useVoiceEngines.js');

describe('barge-in', () => {
  it('the interrupting run never re-speaks the reply it interrupted', async () => {
    const messages = ref([{ role: 'user', content: 'Tell me a long story.' }]);
    const isStreaming = ref(false);
    const streamingAnswer = () => {
      const last = messages.value.at(-1);
      return last?.role === 'assistant' ? last.content : '';
    };
    useVoiceEngines({ submit: () => { isStreaming.value = true; }, streamingAnswer, isStreaming, epoch: ref(0) });

    // Turn 1 streams and is being spoken.
    const firstSpoken = [];
    void realtimeOptions.onRunAgnt('Tell me a long story.', (s) => firstSpoken.push(s));
    messages.value.push({ role: 'assistant', content: 'Once upon a time there was a fox. ' });
    await nextTick();

    // The user talks over it. The realtime engine runs the new words; the
    // main chat turns that submit into a pending steer, so turn 1 is still
    // the last message and is still streaming.
    const secondSpoken = [];
    void realtimeOptions.onRunAgnt('Change the story.', (s) => secondSpoken.push(s));
    messages.value[1].content += 'The fox ran through the forest. ';
    await nextTick();
    messages.value[1].content += 'It met a bear.';
    await nextTick();
    expect(secondSpoken.join(' ')).not.toMatch(/fox|bear/);

    // The steer lands: the interrupting turn's own answer is what it speaks.
    messages.value.push({ role: 'user', content: 'Change the story.', steered: true });
    messages.value.push({ role: 'assistant', content: 'Fine, a drier story. ' });
    await nextTick();
    expect(secondSpoken.join(' ')).toMatch(/drier story/);
  });

  it('a steer that missed every seam: the old turn ending does not end the interrupting run', async () => {
    const messages = ref([{ role: 'user', content: 'Tell me a story.' }, { role: 'assistant', content: 'A fox. ' }]);
    const isStreaming = ref(true);
    const streamingAnswer = () => (messages.value.at(-1)?.role === 'assistant' ? messages.value.at(-1).content : '');
    useVoiceEngines({ submit: () => {}, streamingAnswer, isStreaming, epoch: ref(0) });

    const spoken = [];
    let result = null;
    realtimeOptions.onRunAgnt('Change it.', (s) => spoken.push(s)).then((r) => { result = r; });

    // The old turn finishes and the store re-sends the steer IN THE SAME TICK
    // (handleScopedStreamEvent -> drainPendingSteer), as it does for real.
    isStreaming.value = false;
    messages.value.push({ role: 'user', content: 'Change it.', steered: true });
    isStreaming.value = true;
    await nextTick();
    messages.value.push({ role: 'assistant', content: 'A bear instead. ' });
    await nextTick();
    isStreaming.value = false;
    await nextTick();

    expect(spoken.join(' ')).toMatch(/bear/);
    expect(spoken.join(' ')).not.toMatch(/fox/);
    expect(result).toBe('');
  });

  it('an ordinary turn (nothing streaming) is spoken exactly as before', async () => {
    const messages = ref([{ role: 'user', content: 'Hi' }]);
    const isStreaming = ref(false);
    const streamingAnswer = () => (messages.value.at(-1)?.role === 'assistant' ? messages.value.at(-1).content : '');
    useVoiceEngines({ submit: () => { isStreaming.value = true; }, streamingAnswer, isStreaming, epoch: ref(0) });
    const spoken = [];
    const done = realtimeOptions.onRunAgnt('Hi', (s) => spoken.push(s));
    messages.value.push({ role: 'assistant', content: 'Hello there. ' });
    await nextTick();
    isStreaming.value = false;
    await nextTick();
    expect(await done).toBe('');
    expect(spoken.join(' ')).toMatch(/Hello there/);
  });
});
