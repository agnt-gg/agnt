/**
 * A connect attempt always ENDS — live, failed with a reason, or cancelled —
 * and only ever acts on itself.
 *
 * THE REPORT THIS SUITE EXISTS FOR
 * --------------------------------
 * "Sometimes it just says Connecting forever, and I have to end it and try
 * again, and sometimes that takes two or three tries." Read against the
 * source, that was three separate defects wearing one symptom:
 *
 *   1. Nothing bounded CONNECTING. A handshake that completed but never
 *      produced session.created sat there until the user gave up.
 *   2. Failures after the SDP exchange were not handled at all — a peer that
 *      went to 'failed', a channel that closed — and failures inside it
 *      (createOffer, setRemoteDescription) sat outside any try/catch. Each
 *      left the state on CONNECTING with no message.
 *   3. stop() did not abort the in-flight request. When that request failed
 *      a moment later it ran the OLD attempt's error path — which called
 *      stop() on the NEW session. That is "two or three tries".
 *
 * Every test here drives the real composable against a fake peer connection
 * whose failure modes are under the test's control, and checks the state
 * machine's end state, not its intentions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));

const { useRealtimeVoice, RealtimeState, CONNECT_DEADLINE_MS, CONNECT_ATTEMPTS, RETRY_DELAY_MS } =
  await import('./useRealtimeVoice.js');

/** Every peer connection the composable created, in order. */
let peers = [];
/** Every pending SDP request: settle them from the test to script the server. */
let calls = [];
/** Every timing report POSTed, so the diagnostics are proven, not assumed. */
let timings = [];

class FakeChannel {
  constructor() {
    this.listeners = {};
    this.closed = false;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  emit(name, event = {}) {
    this.listeners[name]?.(event);
  }
  close() {
    this.closed = true;
  }
}

class FakePC {
  constructor() {
    this.connectionState = 'new';
    this.listeners = {};
    this.closed = false;
    this.channel = new FakeChannel();
    this.rejectRemote = false;
    peers.push(this);
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  /** Drive the transport from the test. */
  transport(connectionState) {
    this.connectionState = connectionState;
    this.listeners.connectionstatechange?.();
  }
  addTransceiver() {
    return { sender: { replaceTrack: async () => {} } };
  }
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { sdp: 'v=0 offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    if (this.rejectRemote) throw new Error('Failed to set remote answer sdp');
  }
  close() {
    this.closed = true;
  }
}

const sdpAnswer = (headers = {}) => ({
  ok: true,
  status: 201,
  headers: { get: (name) => ({ 'content-type': 'application/sdp', ...headers })[name.toLowerCase()] ?? null },
  text: async () => 'v=0 answer',
});
const jsonFailure = (status, reason) => ({
  ok: false,
  status,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => ({ success: false, reason }),
});

const fakeTrack = { stop: vi.fn() };
const fakeStream = { getTracks: () => [fakeTrack], getAudioTracks: () => [fakeTrack] };

function harness() {
  return useRealtimeVoice({ sendFrame: () => {}, createPreroll: null });
}

/** Let the composable run up to its await on the SDP request. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Start, wait for the request, answer it. Returns the start() promise. */
async function startAndAnswer(session, response = sdpAnswer()) {
  const started = session.start();
  await settle();
  expect(calls).toHaveLength(1);
  calls[0].resolve(response);
  return started;
}

const sessionCreated = (session) => session._handleMessage(JSON.stringify({ type: 'session.created' }));

beforeEach(() => {
  vi.useFakeTimers();
  peers = [];
  calls = [];
  timings = [];
  globalThis.localStorage = { getItem: () => 'test-token' };
  globalThis.RTCPeerConnection = FakePC;
  globalThis.fetch = vi.fn((url, init) => {
    if (String(url).includes('/speech/realtime/call')) {
      return new Promise((resolve, reject) => {
        const call = { resolve, reject, aborted: false };
        init?.signal?.addEventListener('abort', () => {
          call.aborted = true;
          const err = new Error('The user aborted a request.');
          err.name = 'AbortError';
          reject(err);
        });
        calls.push(call);
      });
    }
    if (String(url).includes('/speech/realtime/timing')) {
      timings.push(JSON.parse(init.body));
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
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

describe('the happy path still works', () => {
  it('goes live on session.created and reports a connected timeline', async () => {
    const session = harness();
    expect(await startAndAnswer(session)).toBe(true);
    expect(session.state.value).toBe(RealtimeState.CONNECTING);

    sessionCreated(session);
    await settle();
    expect(session.state.value).toBe(RealtimeState.LISTENING);
    expect(session.error.value).toBeNull();

    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ outcome: 'connected', attempt: 1, surface: 'chat' });
    expect(timings[0].marks.map((m) => m.name)).toContain('remote_set');
  });

  it('remembers which credential paid for the session', async () => {
    const session = harness();
    await startAndAnswer(session, sdpAnswer({ 'x-voice-credential': 'openai-codex' }));
    expect(session.credentialSource.value).toBe('openai-codex');
  });

  it('says so, loudly, when the session is on the metered key', async () => {
    const session = harness();
    await startAndAnswer(session, sdpAnswer({ 'x-voice-credential': 'openai' }));
    expect(session.credentialSource.value).toBe('openai');
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/billed to the OpenAI API key/));
  });
});

describe('defect 1 — CONNECTING is bounded', () => {
  it('a handshake that never becomes a session fails at the deadline, with a message', async () => {
    const session = harness();
    await startAndAnswer(session);
    expect(session.state.value).toBe(RealtimeState.CONNECTING);

    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS - 1);
    expect(session.state.value).toBe(RealtimeState.CONNECTING); // not a moment early

    await vi.advanceTimersByTimeAsync(1);
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toMatch(/took too long/);
    expect(peers[0].closed).toBe(true);
    expect(fakeTrack.stop).toHaveBeenCalled();

    const failed = timings.find((t) => t.outcome === 'failed');
    expect(failed).toBeDefined();
    expect(failed.stage).toBe('deadline');
  });

  it('a session that DID go live is not touched by the deadline', async () => {
    const session = harness();
    await startAndAnswer(session);
    sessionCreated(session);
    await settle();
    expect(session.state.value).toBe(RealtimeState.LISTENING);

    await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS + 1000);
    expect(session.state.value).toBe(RealtimeState.LISTENING);
    expect(session.error.value).toBeNull();
  });
});

describe('defect 2 — every failure lands somewhere', () => {
  it('a peer that goes to "failed" ends the session with a message', async () => {
    const session = harness();
    await startAndAnswer(session);

    peers[0].transport('failed');
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBe('Voice connection failed');
    expect(timings.find((t) => t.outcome === 'failed')?.stage).toBe('transport_failed');
  });

  it('a live session whose data channel closes is a dead line, and says so', async () => {
    const session = harness();
    await startAndAnswer(session);
    sessionCreated(session);
    await settle();
    expect(session.state.value).toBe(RealtimeState.LISTENING);

    peers[0].channel.emit('close');
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBe('Voice connection closed');
  });

  it('a rejected answer SDP fails cleanly instead of sticking on CONNECTING', async () => {
    const session = harness();
    const started = session.start();
    await settle();
    peers[0].rejectRemote = true;
    calls[0].resolve(sdpAnswer());

    expect(await started).toBe(false);
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBe('Could not start the natural voice session.');
    expect(session.unavailable.value).toBe(false);
  });

  it('"disconnected" is left to recover on its own', async () => {
    const session = harness();
    await startAndAnswer(session);
    sessionCreated(session);
    await settle();

    peers[0].transport('disconnected');
    expect(session.state.value).toBe(RealtimeState.LISTENING);
  });

  it('our OWN close() is not mistaken for a failure', async () => {
    // Some runtimes fire connectionstatechange('closed') synchronously from
    // close(). The handle is detached before it is closed, so that event
    // finds nothing to fail.
    class ChattyPC extends FakePC {
      close() {
        super.close();
        this.transport('closed');
      }
    }
    globalThis.RTCPeerConnection = ChattyPC;

    const session = harness();
    await startAndAnswer(session);
    sessionCreated(session);
    await settle();
    session.stop();

    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBeNull();
  });
});

describe('defect 3 — a stopped attempt cannot touch its replacement', () => {
  it('stop() aborts the in-flight request', async () => {
    const session = harness();
    const started = session.start();
    await settle();
    expect(calls[0].aborted).toBe(false);

    session.stop();
    expect(calls[0].aborted).toBe(true);
    expect(await started).toBe(false);
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBeNull(); // the user stopped it; that is not an error
  });

  it('a cancelled attempt is reported with the stage it was stuck at', async () => {
    const session = harness();
    session.start();
    await settle();
    session.stop();

    const cancelled = timings.find((t) => t.outcome === 'cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled.stage).toBe('offer_ready');
  });

  it('THE RETRY BUG: attempt A fails after B has started — B survives', async () => {
    const session = harness();
    const first = session.start();
    await settle();
    session.stop(); // the user gave up on A
    const second = session.start();
    await settle();
    expect(calls).toHaveLength(2);
    expect(peers).toHaveLength(2);

    // A's request fails late. Under the old code this ran A's error path,
    // which stopped B.
    calls[0].reject(new Error('socket hang up'));
    expect(await first).toBe(false);

    expect(session.state.value).toBe(RealtimeState.CONNECTING);
    expect(peers[1].closed).toBe(false);
    expect(session.error.value).toBeNull();

    calls[1].resolve(sdpAnswer());
    expect(await second).toBe(true);
    sessionCreated(session);
    await settle();
    expect(session.state.value).toBe(RealtimeState.LISTENING);
  });

  it('a stale peer going to "failed" is ignored', async () => {
    const session = harness();
    session.start();
    await settle();
    session.stop();
    const second = session.start();
    await settle();

    peers[0].transport('failed'); // A's transport, long after A was abandoned
    expect(session.state.value).toBe(RealtimeState.CONNECTING);

    calls[1].resolve(sdpAnswer());
    expect(await second).toBe(true);
  });

  it('a stale data channel message is ignored', async () => {
    const session = harness();
    session.start();
    await settle();
    session.stop();
    session.start();
    await settle();

    peers[0].channel.emit('message', { data: JSON.stringify({ type: 'session.created' }) });
    await settle();
    expect(session.state.value).toBe(RealtimeState.CONNECTING); // B is still waiting
  });

  it('a stale channel closing is ignored', async () => {
    const session = harness();
    session.start();
    await settle();
    session.stop();
    session.start();
    await settle();

    peers[0].channel.emit('close');
    expect(session.state.value).toBe(RealtimeState.CONNECTING);
    expect(session.error.value).toBeNull();
  });
});

describe('one retry, and only for the provider\'s failures', () => {
  it('a stalled provider (504 timeout) is retried once, reusing the microphone', async () => {
    const session = harness();
    const started = session.start();
    await settle();
    calls[0].resolve(jsonFailure(504, 'timeout'));
    await settle();

    expect(session.state.value).toBe(RealtimeState.CONNECTING); // not given up
    expect(peers[0].closed).toBe(true);
    expect(fakeTrack.stop).not.toHaveBeenCalled(); // the mic outlives the attempt

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2 + 1);
    expect(calls).toHaveLength(2);
    expect(peers).toHaveLength(2);
    calls[1].resolve(sdpAnswer());
    expect(await started).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    expect(timings.map((t) => [t.outcome, t.attempt])).toEqual([['failed', 1]]);
  });

  it('an unreachable server is retried once, then reported', async () => {
    const session = harness();
    const started = session.start();
    await settle();
    calls[0].reject(new Error('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2 + 1);
    expect(calls).toHaveLength(CONNECT_ATTEMPTS);
    calls[1].reject(new Error('Failed to fetch'));

    expect(await started).toBe(false);
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBe('Could not reach the voice service');
    expect(session.unavailable.value).toBe(false);
    expect(timings.map((t) => [t.outcome, t.attempt])).toEqual([
      ['failed', 1],
      ['failed', 2],
    ]);
  });

  it.each([
    ['no-credentials', 200, 'Natural voice needs OpenAI credit on this account.', true],
    ['provider-401', 401, 'Could not start the natural voice session.', false],
    ['provider-400', 400, 'Could not start the natural voice session.', false],
  ])('%s is the account\'s problem and is NOT retried', async (reason, status, message, unavailable) => {
    const session = harness();
    const started = session.start();
    await settle();
    calls[0].resolve(jsonFailure(status, reason));

    expect(await started).toBe(false);
    expect(calls).toHaveLength(1);
    expect(session.state.value).toBe(RealtimeState.IDLE);
    expect(session.error.value).toBe(message);
    expect(session.unavailable.value).toBe(unavailable);
  });

  it('stop() during the retry pause cancels the retry', async () => {
    const session = harness();
    const started = session.start();
    await settle();
    calls[0].resolve(jsonFailure(502, 'network'));
    await settle();
    expect(session.state.value).toBe(RealtimeState.CONNECTING);

    session.stop();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2 + 1);
    expect(calls).toHaveLength(1);
    expect(await started).toBe(false);
    expect(session.state.value).toBe(RealtimeState.IDLE);
  });
});
