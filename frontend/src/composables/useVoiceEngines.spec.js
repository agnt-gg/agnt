/**
 * A session that failed says why — after it is gone.
 *
 * The hosts render the status strip only while `voiceActive || voiceError`.
 * A realtime session that failed to connect is not active any more, so its
 * message reached the strip only through the second half of that condition —
 * which is what this file pins. Before it, the strip read "Connecting…" and
 * then vanished, and a vanished strip is indistinguishable from a hang.
 *
 * Both engines are faked at their seams; their own behaviour is proven in
 * their own suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, nextTick } from 'vue';

let realtime;
let cascade;

vi.mock('./useVoiceSession.js', () => ({ useVoiceSession: () => cascade }));
vi.mock('./useRealtimeVoice.js', () => ({ useRealtimeVoice: () => realtime }));
vi.mock('../voice/voiceFloor.js', () => ({
  claimVoiceFloor: () => 1,
  releaseVoiceFloor: () => {},
}));
vi.mock('../services/voiceTurn.js', () => ({ armVoiceTurn: () => {} }));

const { useVoiceEngines } = await import('./useVoiceEngines.js');

function fakeRealtime() {
  const state = ref('idle');
  return {
    state,
    isActive: computed(() => state.value !== 'idle'),
    error: ref(null),
    unavailable: ref(false),
    credentialSource: ref(null),
    assistantPartial: ref(''),
    isSupported: true,
    start: vi.fn(async () => true),
    stop: vi.fn(() => {
      state.value = 'idle';
    }),
  };
}

function fakeCascade() {
  const state = ref('idle');
  return {
    state,
    isActive: computed(() => state.value !== 'idle'),
    error: ref(null),
    partialTranscript: ref(''),
    level: ref(0),
    isSupported: true,
    toggle: vi.fn(async () => false),
    stop: vi.fn(),
    handleStreamEvent: vi.fn(),
  };
}

function host() {
  return useVoiceEngines({
    submit: () => {},
    streamingAnswer: () => '',
    isStreaming: ref(false),
    epoch: ref(0),
  });
}

/** What the realtime engine does when a connect fails: message, then idle. */
async function failConnect(message) {
  realtime.state.value = 'connecting';
  await nextTick();
  realtime.error.value = message;
  realtime.state.value = 'idle';
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
  realtime = fakeRealtime();
  cascade = fakeCascade();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the failure message outlives the session', () => {
  it('is shown after the engine has gone idle, and clears itself', async () => {
    const h = host();
    await failConnect('Voice took too long to connect — try again');

    expect(h.voiceActive.value).toBe(false);
    expect(h.voiceError.value).toBe('Voice took too long to connect — try again');

    await vi.advanceTimersByTimeAsync(8000);
    expect(h.voiceError.value).toBe('');
  });

  it('a live session\'s error is shown live, not held', async () => {
    const h = host();
    realtime.state.value = 'listening';
    await nextTick();
    realtime.error.value = 'That tool is not available.';
    await nextTick();

    expect(h.voiceError.value).toBe('That tool is not available.');
    realtime.error.value = null;
    await nextTick();
    expect(h.voiceError.value).toBeNull();
  });

  it('a new session clears the old message for good', async () => {
    const h = host();
    await failConnect('Could not reach the voice service');
    expect(h.voiceError.value).toBeTruthy();

    // What start() does: clear the error, go connecting.
    realtime.error.value = null;
    realtime.state.value = 'connecting';
    await nextTick();
    expect(h.voiceError.value).toBeNull();

    // A clean stop must not resurrect the old message from under it.
    realtime.state.value = 'idle';
    await nextTick();
    expect(h.voiceError.value).toBe('');
  });

  it('"unavailable" is not a failure — the cascade takes over silently', async () => {
    const h = host();
    realtime.unavailable.value = true;
    await failConnect('Natural voice needs OpenAI credit on this account.');

    expect(h.voiceError.value).toBe('');
  });
});

describe('the credential badge', () => {
  it('flags a session on the metered key, and only while it is live', async () => {
    const h = host();
    realtime.state.value = 'listening';
    realtime.credentialSource.value = 'openai';
    await nextTick();
    expect(h.voiceMetered.value).toBe(true);

    realtime.state.value = 'idle';
    await nextTick();
    expect(h.voiceMetered.value).toBe(false);
  });

  it('a subscription session is not flagged', async () => {
    const h = host();
    realtime.state.value = 'listening';
    realtime.credentialSource.value = 'openai-codex';
    await nextTick();
    expect(h.voiceMetered.value).toBe(false);
  });
});
