/**
 * The first word survives the handshake.
 *
 * The property under test: audio spoken between the button click and
 * session.created is (a) recorded into the pre-roll ring, (b) handed to the
 * model as a conversation item BEFORE the live track opens, and (c) if the
 * whole utterance predates the wire, the turn is closed by the stranded-turn
 * timer — once, with the session's own tools, and never when the server VAD
 * claims the floor first.
 *
 * WebRTC, the mic and the pre-roll are all faked at their seams; the ring
 * itself is proven against real frames in prerollBuffer.spec.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));

const { useRealtimeVoice, RealtimeState } = await import('./useRealtimeVoice.js');
const { AGNT_TOOL_NAME } = await import('../voice/realtimeBridge.js');

/** Interleaved record of outgoing frames and track attachment, in order. */
let log = [];
let sent = [];

class FakeSender {
  replaceTrack(track) {
    log.push(['replaceTrack', track]);
    return Promise.resolve();
  }
}
class FakePC {
  addEventListener() {}
  addTransceiver() {
    return { sender: new FakeSender() };
  }
  createDataChannel() {
    return { addEventListener() {}, close() {} };
  }
  async createOffer() {
    return { sdp: 'v=0 offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
}

const fakeTrack = { stop: vi.fn() };
const fakeStream = { getTracks: () => [fakeTrack], getAudioTracks: () => [fakeTrack] };

const clip = (overrides = {}) => ({
  base64: 'UFJFUk9MTA==',
  ms: 1400,
  hadSpeech: true,
  endedInSilence: true,
  ...overrides,
});

function harness(clipValue, options = {}) {
  const preroll = { harvest: vi.fn(() => clipValue), close: vi.fn() };
  const session = useRealtimeVoice({
    ...options,
    sendFrame: (e) => {
      sent.push(e);
      log.push(['frame', e]);
    },
    createPreroll: () => preroll,
  });
  return { session, preroll };
}

async function connect(session) {
  const ok = await session.start();
  expect(ok).toBe(true);
  session._handleMessage(JSON.stringify({ type: 'session.created' }));
  await vi.advanceTimersByTimeAsync(1); // flush goLive's awaits
}

/** The stranded closer is the only BARE response.create (no overrides). */
const bareResponses = () => sent.filter((e) => e.type === 'response.create' && !('response' in e));
const injectedItems = () =>
  sent.filter((e) => e.type === 'conversation.item.create' && e.item?.role === 'user');

const speechStarted = (session) =>
  session._handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));

const toolCallFrame = JSON.stringify({
  type: 'response.done',
  response: {
    output: [
      {
        type: 'function_call',
        name: AGNT_TOOL_NAME,
        call_id: 'call_recovered',
        arguments: JSON.stringify({ user_message: 'what is the weather' }),
      },
    ],
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  sent = [];
  globalThis.localStorage = { getItem: () => 'test-token' };
  globalThis.RTCPeerConnection = FakePC;
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/speech/realtime/call')) {
      return { ok: true, headers: { get: () => 'application/sdp' }, text: async () => 'v=0 answer' };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => fakeStream) },
    configurable: true,
  });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn(async () => ({ state: 'granted' })) },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.RTCPeerConnection;
});

describe('the pre-roll handover', () => {
  it('delivers the buffered audio BEFORE the live track opens', async () => {
    const { session, preroll } = harness(clip());
    await connect(session);

    const itemIdx = log.findIndex(
      ([kind, e]) => kind === 'frame' && e?.type === 'conversation.item.create' && e.item?.role === 'user'
    );
    const trackIdx = log.findIndex(([kind]) => kind === 'replaceTrack');

    expect(itemIdx, 'the pre-roll item was never sent').toBeGreaterThan(-1);
    expect(trackIdx, 'the live track was never attached').toBeGreaterThan(-1);
    // THE ordering that makes ring + track one continuous timeline.
    expect(itemIdx).toBeLessThan(trackIdx);

    expect(injectedItems()[0].item.content).toEqual([
      { type: 'input_audio', audio: 'UFJFUk9MTA==' },
    ]);
    expect(preroll.close).not.toHaveBeenCalled(); // detector stays alive until recovery settles
    expect(session.state.value).toBe(RealtimeState.LISTENING);
  });

  it('a silent handshake injects nothing — but still goes live', async () => {
    const { session } = harness(clip({ hadSpeech: false, base64: '' }));
    await connect(session);

    expect(injectedItems()).toHaveLength(0);
    expect(log.some(([kind]) => kind === 'replaceTrack')).toBe(true);
    expect(session.state.value).toBe(RealtimeState.LISTENING);
  });
});

describe('the stranded turn', () => {
  it('does not answer during a short pause after connecting', async () => {
    const { session } = harness(clip({ endedInSilence: true }));
    await connect(session);
    await vi.advanceTimersByTimeAsync(3000);
    expect(bareResponses()).toHaveLength(0);
    session.stop();
  });
  it('local continued speech prevents an answer even without a remote VAD event', async () => {
    const { session, preroll } = harness(clip({ endedInSilence: true }));
    preroll.hasSpeechSinceHarvest = () => true;
    await connect(session);
    await vi.advanceTimersByTimeAsync(30000);
    expect(bareResponses()).toHaveLength(0);
    expect(preroll.close).toHaveBeenCalled();
    session.stop();
  });
  it('closes itself exactly once, and the recovered words fund a run', async () => {
    const onRunAgnt = vi.fn(async () => 'sunny');
    const { session } = harness(clip({ endedInSilence: true }), { onRunAgnt });
    await connect(session);
    expect(bareResponses()).toHaveLength(0); // not before the timer

    await vi.advanceTimersByTimeAsync(4100);
    expect(bareResponses()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(bareResponses()).toHaveLength(1); // once means once

    // The closer granted utterance credit, so the model's resulting tool
    // call actually runs instead of being refused as freelancing.
    session._handleMessage(toolCallFrame);
    await vi.advanceTimersByTimeAsync(10);
    expect(onRunAgnt).toHaveBeenCalledWith('what is the weather', expect.any(Function));
  });

  it('live speech cancels the closer — the server VAD owns the turn', async () => {
    const { session } = harness(clip({ endedInSilence: true }));
    await connect(session);

    speechStarted(session);
    await vi.advanceTimersByTimeAsync(5000);
    expect(bareResponses()).toHaveLength(0);
  });

  it('a tail still in speech defers to the server VAD from the start', async () => {
    const { session } = harness(clip({ endedInSilence: false }));
    await connect(session);

    await vi.advanceTimersByTimeAsync(5000);
    expect(bareResponses()).toHaveLength(0);
  });

  it('stopping the session disarms the closer', async () => {
    const { session } = harness(clip({ endedInSilence: true }));
    await connect(session);

    session.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(bareResponses()).toHaveLength(0);
  });
});

describe('recovery lifetime and duplicate readiness', () => {
  it('keeps CONNECTING on duplicate readiness until the microphone resolves', async () => {
    let openMic;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise((resolve) => { openMic = resolve; }));
    const { session, preroll } = harness(clip());
    try {
      expect(await session.start()).toBe(true);
      session._handleMessage(JSON.stringify({ type: 'session.created' }));
      session._handleMessage(JSON.stringify({ type: 'session.updated' }));
      await vi.advanceTimersByTimeAsync(1);
      expect(session.state.value).toBe(RealtimeState.CONNECTING);
      expect(injectedItems()).toHaveLength(0);
      openMic(fakeStream);
      await vi.advanceTimersByTimeAsync(1);
      expect(session.state.value).toBe(RealtimeState.LISTENING);
      expect(injectedItems()).toHaveLength(1);
      expect(preroll.harvest).toHaveBeenCalledTimes(1);
      expect(log.filter(([kind]) => kind === 'replaceTrack')).toHaveLength(1);
    } finally { session.stop(); }
  });

  it('closes the local detector exactly once when live VAD takes ownership', async () => {
    const { session, preroll } = harness(clip());
    await connect(session);
    expect(preroll.close).not.toHaveBeenCalled();
    speechStarted(session);
    expect(preroll.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(bareResponses()).toHaveLength(0);
    session.stop();
    expect(preroll.close).toHaveBeenCalledTimes(1);
  });

  it('stopping before recovery cannot answer or close a replacement detector', async () => {
    const detectors = [
      { harvest: vi.fn(() => clip()), close: vi.fn(), hasSpeechSinceHarvest: () => false },
      { harvest: vi.fn(() => clip()), close: vi.fn(), hasSpeechSinceHarvest: () => false },
    ];
    let index = 0;
    const session = useRealtimeVoice({ sendFrame: (frame) => sent.push(frame), createPreroll: () => detectors[index++] });
    try {
      await connect(session);
      await vi.advanceTimersByTimeAsync(2500);
      session.stop();
      expect(detectors[0].close).toHaveBeenCalledTimes(1);
      await connect(session);
      await vi.advanceTimersByTimeAsync(1800);
      expect(bareResponses()).toHaveLength(0);
      expect(detectors[1].close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2300);
      expect(bareResponses()).toHaveLength(1);
      expect(detectors[1].close).toHaveBeenCalledTimes(1);
    } finally { session.stop(); }
  });
});

describe('mic failure still fails cleanly', () => {
  it('a denied microphone reports the denial and goes idle', async () => {
    navigator.permissions.query = vi.fn(async () => ({ state: 'prompt' }));
    navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      const err = new Error('denied');
      err.name = 'NotAllowedError';
      throw err;
    });

    const { session } = harness(clip());
    const ok = await session.start();

    expect(ok).toBe(false);
    expect(session.error.value).toBe('Microphone permission denied');
    expect(session.state.value).toBe(RealtimeState.IDLE);
  });
});
