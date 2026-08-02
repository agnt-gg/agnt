/**
 * Integration test for the voice runtime.
 *
 * The pure modules are each tested in isolation. What this file proves is the
 * thing none of them can: that WIRED TOGETHER they behave like a conversation.
 * Every assertion here corresponds to something a user would notice — being cut
 * off, being ignored, hearing code read aloud, the assistant defending a
 * sentence it never actually said.
 *
 * The microphone, the network and the speech synthesiser are all faked at the
 * module boundary, and a manual clock drives the gate, so these run in
 * milliseconds and are deterministic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- fakes -------------------------------------------------------------

const captureHandlers = {};
const fakeCapture = {
  startRecording: vi.fn(() => true),
  stopRecording: vi.fn(async () => new Blob(['x'.repeat(4000)])),
  start: vi.fn(async () => ({ ok: true })),
  stop: vi.fn(),
  setDucked: vi.fn(),
  on: vi.fn((event, fn) => {
    captureHandlers[event] = captureHandlers[event] || [];
    captureHandlers[event].push(fn);
    return () => {};
  }),
  silenceMs: 0,
  isSpeaking: false,
  isCalibrating: false,
  isRecording: false,
  isActive: true,
};

const spoken = [];
const fakeSpeech = {
  speak: vi.fn((t) => {
    if (t) spoken.push(t);
    return Promise.resolve();
  }),
  cancel: vi.fn(() => ({ spoken: 'The build is green.', discarded: 'rest', partial: '' })),
  // NOTE: `spoken` collects everything ever uttered across the test, it is not
  // a mirror of queue state. reset() must NOT clear it, or an assertion that
  // spans a turn boundary silently sees an empty array and "passes" for the
  // wrong reason.
  reset: vi.fn(),
  spokenPrefix: vi.fn(() => 'The build is green.'),
  configure: vi.fn(),
  on: vi.fn(() => () => {}),
  state: 'idle',
  isSpeaking: false,
  pending: [],
};

vi.mock('../voice/audioCapture.js', () => ({
  createAudioCapture: () => fakeCapture,
  default: {},
}));

vi.mock('../voice/speechOut.js', async () => {
  const actual = await vi.importActual('../voice/speechOut.js');
  return {
    ...actual,
    createSpeechOut: () => fakeSpeech,
    isWebSpeechAvailable: () => true,
  };
});

vi.mock('../../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));

const { useVoiceSession } = await import('./useVoiceSession.js');
const { VoiceState } = await import('../voice/turnGate.js');

function fire(event, payload) {
  for (const fn of captureHandlers[event] || []) fn(payload);
}

/**
 * Let the timer run for `ms` of fake time, then drain the microtask queue.
 *
 * The drain has to be generous: committing now AWAITS the in-flight
 * transcription (fetch -> json -> gate.send), which is several microtask hops
 * deep. A fixed three-tick flush asserts against a state one turn behind and
 * fails for a reason that has nothing to do with the behaviour under test.
 */
async function advance(ms) {
  vi.advanceTimersByTime(ms);
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

let transcriptToReturn = 'open the auth file';

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(captureHandlers)) delete captureHandlers[k];
  spoken.length = 0;
  fakeCapture.silenceMs = 0;
  fakeCapture.isSpeaking = false;
  transcriptToReturn = 'open the auth file';
  vi.clearAllMocks();

  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, transcript: transcriptToReturn }),
  }));
  globalThis.localStorage = { getItem: () => 'test-token', setItem: () => {} };
  globalThis.Blob = globalThis.Blob || class {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVoiceSession — starting and stopping', () => {
  it('opens the mic and begins listening', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    const ok = await s.start();
    expect(ok).toBe(true);
    expect(fakeCapture.start).toHaveBeenCalled();
    expect(s.state.value).toBe(VoiceState.LISTENING);
    expect(s.isActive.value).toBe(true);
  });

  it('surfaces a permission denial in plain language', async () => {
    fakeCapture.start.mockResolvedValueOnce({ ok: false, error: 'NotAllowedError' });
    const s = useVoiceSession({});
    const ok = await s.start();
    expect(ok).toBe(false);
    expect(s.error.value).toMatch(/permission denied/i);
    expect(s.isActive.value).toBe(false);
  });

  it('stop tears everything down', async () => {
    const s = useVoiceSession({});
    await s.start();
    s.stop();
    expect(s.state.value).toBe(VoiceState.IDLE);
    expect(fakeCapture.stop).toHaveBeenCalled();
    expect(fakeSpeech.cancel).toHaveBeenCalled();
  });
});

describe('useVoiceSession — a complete turn', () => {
  it('transcribes, commits, and sends the text', async () => {
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60); // endpoint fires
    await advance(10);

    expect(s.state.value).toBe(VoiceState.REOPEN);

    await advance(700); // reopen window expires
    expect(onCommit).toHaveBeenCalledWith({ text: 'open the auth file', voice: true });
  });

  it('does not commit on room noise with an empty transcript', async () => {
    transcriptToReturn = '';
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 2000;
    await advance(100);
    await advance(900);

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('useVoiceSession — self-correction (the reopen window)', () => {
  it('a resumed sentence joins the SAME turn, and commits once', async () => {
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    // "open the auth file"
    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    expect(s.state.value).toBe(VoiceState.REOPEN);

    // ...user resumes 300ms into the reopen window
    transcriptToReturn = 'no wait the session one';
    fakeCapture.silenceMs = 0;
    fire('speech_start', {});
    await advance(10);
    expect(s.state.value).toBe(VoiceState.LISTENING);

    // ...and finishes for real
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].text).toBe('open the auth file no wait the session one');
  });
});

describe('useVoiceSession — speaking the reply', () => {
  async function toThinking(s) {
    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);
  }

  it('speaks the first sentence before the answer has finished generating', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toThinking(s);
    expect(s.state.value).toBe(VoiceState.THINKING);

    s.handleStreamEvent('content_delta', { accumulated: 'The build is green.' });
    await advance(10);

    expect(spoken).toContain('The build is green.');
    expect(s.state.value).toBe(VoiceState.SPEAKING);
  });

  it('never reads a code block aloud', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toThinking(s);

    s.handleStreamEvent('content_delta', {
      accumulated: 'Here is the fix.\n```js\nconst secret = require("x");\n```\nThat should do it.',
    });
    s.handleStreamEvent('done', {});
    await advance(10);

    const all = spoken.join(' ');
    expect(all).toContain('Here is the fix.');
    expect(all).toContain('That should do it.');
    expect(all).not.toContain('require');
    expect(all).not.toContain('```');
  });

  it('ducks the mic while speaking and unducks when done', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toThinking(s);

    s.handleStreamEvent('content_delta', { accumulated: 'Speaking now.' });
    await advance(10);
    expect(fakeCapture.setDucked).toHaveBeenCalledWith(true);

    s.handleStreamEvent('done', {});
    await advance(10);
    expect(fakeCapture.setDucked).toHaveBeenCalledWith(false);
  });

  it('returns to listening after the reply — continuous conversation', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toThinking(s);

    s.handleStreamEvent('content_delta', { accumulated: 'All done here.' });
    await advance(10);
    s.handleStreamEvent('done', {});
    await advance(20);

    expect(s.state.value).toBe(VoiceState.LISTENING);
  });
});

describe('useVoiceSession — barge-in', () => {
  async function toSpeaking(s) {
    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);
    s.handleStreamEvent('content_delta', { accumulated: 'The build is green.' });
    await advance(10);
    expect(s.state.value).toBe('speaking');
  }

  it('cancels playback when the user talks over the reply', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toSpeaking(s);

    fire('speech_start', {});
    fire('frame', { speaking: true, speechMs: 200 });
    await advance(300);

    expect(fakeSpeech.cancel).toHaveBeenCalled();
    expect(s.state.value).toBe(VoiceState.LISTENING);
  });

  it('shapes the interruption as a steer, carrying what was actually heard', async () => {
    const onSteer = vi.fn();
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit, onSteer });
    await s.start();

    // Get to THINKING, then interrupt before any audio plays.
    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);
    expect(s.state.value).toBe(VoiceState.THINKING);

    transcriptToReturn = 'no not that one';
    fire('frame', { speaking: true, speechMs: 200 });
    await advance(100);

    // Now finish the interrupting utterance.
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onSteer).toHaveBeenCalled();
    expect(onSteer.mock.calls[0][0].text).toBe('no not that one');
  });

  it('REGRESSION: a barge-in does not trap the session in an interruption loop', async () => {
    /**
     * `speechMsDuringPlayback` was only ever RAISED (`if (f.speaking) ...`) and
     * never cleared. After one barge-in the stale value still cleared the
     * threshold, so the next tick in THINKING fired another barge-in, which
     * endpointed, committed, returned to THINKING, and barged in again — for
     * ever. The assistant could never complete another reply for the life of
     * the session.
     *
     * Unit tests could not see it: the latch only closes once the gate, the
     * capture events and the timer are wired together.
     */
    const onCommit = vi.fn();
    const onSteer = vi.fn();
    const s = useVoiceSession({ onCommit, onSteer });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);
    expect(s.state.value).toBe(VoiceState.THINKING);

    // One burst of speech, never repeated.
    fire('frame', { speaking: true, speechMs: 200 });
    await advance(100);

    // Let a long time pass with no further speech events at all.
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    // Exactly one interruption was registered, not a cascade.
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);

    // And the session settles instead of oscillating.
    await advance(2000);
    expect(onSteer).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a finished speech burst does not trigger a barge-in on a later turn', async () => {
    // The frame handler must MIRROR the VAD, not latch its high-water mark.
    // A stale figure that only ever rises keeps clearing the barge-in
    // threshold long after the user stopped talking, so the next reply is
    // interrupted before a word is even spoken.
    const onCommit = vi.fn();
    const onSteer = vi.fn();
    const s = useVoiceSession({ onCommit, onSteer });
    await s.start();

    // A burst of speech that then ENDS.
    fire('frame', { speaking: true, speechMs: 400 });
    fire('frame', { speaking: false, speechMs: 0 });

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    // Reply begins. Nothing further is said.
    s.handleStreamEvent('content_delta', { accumulated: 'Answering now.' });
    await advance(10);
    expect(s.state.value).toBe('speaking');

    // Silence must NOT be read as an interruption.
    await advance(1000);
    expect(fakeSpeech.cancel).not.toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();
  });

  it('waits for a slow transcription instead of committing an empty turn', async () => {
    // Whisper takes 300-1500ms; the reopen window is 600ms. Committing on the
    // timer rather than on the transcript drops the whole turn silently, which
    // the user experiences as "it randomly ignores me".
    let releaseTranscription;
    const gate = new Promise((r) => {
      releaseTranscription = r;
    });
    globalThis.fetch = vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => ({ success: true, transcript: 'the slow utterance' }) };
    });

    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);

    // The reopen window expires while transcription is still in flight.
    await advance(1500);
    expect(onCommit).not.toHaveBeenCalled();

    releaseTranscription();
    await advance(50);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].text).toBe('the slow utterance');
  });

  it('discards deltas from a turn the user already superseded', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    await toSpeaking(s);

    fire('speech_start', {});
    fire('frame', { speaking: true, speechMs: 200 });
    await advance(300);

    const before = spoken.length;
    // The old run is still streaming; none of it may be spoken.
    s.handleStreamEvent('content_delta', { accumulated: 'The build is green. And more text.' });
    await advance(10);
    expect(spoken.length).toBe(before);
  });
});

describe('useVoiceSession — stop phrases and wake routing', () => {
  it('"stop" ends the session and is never sent to the model', async () => {
    transcriptToReturn = 'stop';
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onCommit).not.toHaveBeenCalled();
    expect(s.state.value).toBe(VoiceState.IDLE);
  });

  it('"stop the docker container" IS sent to the model', async () => {
    transcriptToReturn = 'stop the docker container';
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onCommit).toHaveBeenCalled();
    expect(onCommit.mock.calls[0][0].text).toBe('stop the docker container');
    expect(s.state.value).not.toBe(VoiceState.IDLE);
  });

  it('routes "hey <agent>" to that agent', async () => {
    transcriptToReturn = 'hey researcher find the paper';
    const onWakeAgent = vi.fn();
    const onCommit = vi.fn();
    const s = useVoiceSession({
      onCommit,
      onWakeAgent,
      getAgents: () => [{ id: 'a1', name: 'Researcher' }],
    });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onWakeAgent).toHaveBeenCalledWith({
      agentId: 'a1',
      agentName: 'Researcher',
      text: 'find the paper',
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('strips "hey annie" before sending the command', async () => {
    transcriptToReturn = 'hey annie run the tests';
    const onCommit = vi.fn();
    const s = useVoiceSession({ onCommit });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(onCommit.mock.calls[0][0].text).toBe('run the tests');
  });
});

describe('useVoiceSession — resilience', () => {
  it('a transcription failure does not kill the session', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();

    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    expect(s.error.value).toMatch(/network down/i);
    expect(s.isActive.value).toBe(true);
  });

  it('ignores stream events when the session is not running', () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    expect(() => s.handleStreamEvent('content_delta', { accumulated: 'hello' })).not.toThrow();
    expect(spoken).toEqual([]);
  });

  it('a stream error unducks and returns to listening', async () => {
    const s = useVoiceSession({ onCommit: vi.fn() });
    await s.start();
    fire('speech_start', {});
    fakeCapture.silenceMs = 700;
    await advance(60);
    await advance(700);

    s.handleStreamEvent('error', { error: 'model exploded' });
    await advance(20);

    expect(s.error.value).toBe('model exploded');
    expect(fakeCapture.setDucked).toHaveBeenCalledWith(false);
  });
});
