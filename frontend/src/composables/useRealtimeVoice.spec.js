/**
 * The one property that matters most here: A TOOL CALL IS ALWAYS ANSWERED.
 *
 * The realtime session BLOCKS on an unanswered function call. The model waits
 * silently, forever, and the user experiences a dead line with no error
 * anywhere — in the browser, in the server log, or in the chat. So every path
 * out of a run_agnt call, including the ugly ones, must end in a
 * function_call_output. These tests walk each of those paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));

const { useRealtimeVoice, RealtimeState } = await import('./useRealtimeVoice.js');
const { AGNT_TOOL_NAME } = await import('../voice/realtimeBridge.js');

/** Every frame the composable emits, in order. */
let sent = [];

const toolCallFrame = (overrides = {}) =>
  JSON.stringify({
    type: 'response.done',
    response: {
      output: [
        {
          type: 'function_call',
          name: AGNT_TOOL_NAME,
          call_id: 'call_1',
          arguments: JSON.stringify({ instruction: 'check the build' }),
          ...overrides,
        },
      ],
    },
  });

/** Build a session whose outgoing frames land in `sent`. */
function harness(options = {}) {
  return useRealtimeVoice({ ...options, sendFrame: (e) => sent.push(e) });
}

/** The function_call_output frames emitted for a given call id. */
const answersFor = (callId) =>
  sent.filter((e) => e.type === 'conversation.item.create' && e.item?.call_id === callId);

/** Did we both answer the call AND ask the model to speak the answer? */
function expectAnswered(callId) {
  const answers = answersFor(callId);
  expect(answers, `no function_call_output for ${callId} — the session would hang`).toHaveLength(1);
  expect(answers[0].item.type).toBe('function_call_output');
  expect(typeof answers[0].item.output).toBe('string');
  expect(answers[0].item.output.length).toBeGreaterThan(0);
  expect(
    sent.some((e) => e.type === 'response.create'),
    'no response.create — the model would never speak the result'
  ).toBe(true);
  return answers[0].item.output;
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  globalThis.localStorage = { getItem: () => 'test-token' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRealtimeVoice — AGNT is the brain', () => {
  it('routes a run_agnt call to the orchestrator and speaks its result', async () => {
    const onRunAgnt = vi.fn(async () => 'the build is green');
    const s = harness({ onRunAgnt });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    expect(onRunAgnt).toHaveBeenCalledWith('check the build');
    expect(expectAnswered('call_1')).toBe('the build is green');
  });

  it('ANTI-VACUITY: the harness really observes frames', async () => {
    // Without this, a regression that stops sending anything at all would make
    // every "is answered" test below pass by observing nothing.
    const s = harness({ onRunAgnt: async () => 'x' });
    expect(sent).toHaveLength(0);
    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('enters WORKING while AGNT runs', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const s = harness({ onRunAgnt: () => gate });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state.value).toBe(RealtimeState.WORKING);

    release('done');
    await vi.advanceTimersByTimeAsync(10);
    expect(s.state.value).toBe(RealtimeState.SPEAKING);
  });

  it('an AGNT error still answers the call, with something speakable', async () => {
    const onRunAgnt = vi.fn(async () => {
      throw new Error('orchestrator exploded');
    });
    const s = harness({ onRunAgnt });

    // Must not reject out of the handler, and must not leave the call open.
    s._handleMessage(toolCallFrame());
    await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow();
    expect(onRunAgnt).toHaveBeenCalled();
    expect(expectAnswered('call_1')).toMatch(/error/i);
    expect(s.state.value).toBe(RealtimeState.SPEAKING);
  });

  it('a hung AGNT run times out rather than hanging the session forever', async () => {
    // Never resolves: without the timeout race the model waits for ever.
    const s = harness({ onRunAgnt: () => new Promise(() => {}) });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state.value).toBe(RealtimeState.WORKING);

    await vi.advanceTimersByTimeAsync(180001);
    expect(expectAnswered('call_1')).toMatch(/still/i);
    expect(s.state.value).toBe(RealtimeState.SPEAKING);
  });

  it('an empty instruction is answered immediately, not sent to AGNT', async () => {
    const onRunAgnt = vi.fn();
    const s = harness({ onRunAgnt });

    s._handleMessage(toolCallFrame({ arguments: JSON.stringify({ instruction: '   ' }) }));
    await vi.advanceTimersByTimeAsync(10);

    expect(onRunAgnt).not.toHaveBeenCalled();
    expect(expectAnswered('call_1')).toMatch(/could not read/i);
  });

  it('malformed arguments are answered, not dropped', async () => {
    const onRunAgnt = vi.fn();
    const s = harness({ onRunAgnt });

    s._handleMessage(toolCallFrame({ arguments: '{"instruction": broken' }));
    await vi.advanceTimersByTimeAsync(10);

    expect(onRunAgnt).not.toHaveBeenCalled();
    expectAnswered('call_1'); // closed out rather than left pending
    expect(s.error.value).toBeNull();
  });

  it('an unknown tool is reported AND answered', async () => {
    const s = harness({ onRunAgnt: vi.fn() });
    s._handleMessage(toolCallFrame({ name: 'rm_rf' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(s.error.value).toMatch(/unknown tool/i);
    expect(expectAnswered('call_1')).toMatch(/not available/i);
  });

  it('stopping mid-run does not resume into a dead session', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const s = harness({ onRunAgnt: () => gate });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(1);
    s.stop();

    release('late result');
    await vi.advanceTimersByTimeAsync(10);

    expect(s.state.value).toBe(RealtimeState.IDLE);
    expect(answersFor('call_1'), 'answered a call on a stopped session').toHaveLength(0);
  });
});

describe('useRealtimeVoice — transcripts reach the chat', () => {
  it('reports the user turn', async () => {
    const onUserSaid = vi.fn();
    const s = harness({ onUserSaid });
    s._handleMessage(
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'what is the build status',
      })
    );
    expect(onUserSaid).toHaveBeenCalledWith('what is the build status');
  });

  it('reports the assistant turn and clears the partial', async () => {
    const onAssistantSaid = vi.fn();
    const s = harness({ onAssistantSaid });

    s._handleMessage(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'All ' }));
    s._handleMessage(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'good.' }));
    expect(s.assistantPartial.value).toBe('All good.');

    s._handleMessage(
      JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'All good.' })
    );
    expect(onAssistantSaid).toHaveBeenCalledWith('All good.');
    expect(s.assistantPartial.value).toBe('');
  });

  it('barge-in clears the partial and returns to listening', () => {
    const s = harness({});
    s._handleMessage(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'I was saying' }));
    expect(s.state.value).toBe(RealtimeState.SPEAKING);

    s._handleMessage(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
    expect(s.assistantPartial.value).toBe('');
    expect(s.state.value).toBe(RealtimeState.LISTENING);
  });
});

describe('useRealtimeVoice — robustness', () => {
  it('a malformed frame does not kill the session', () => {
    const s = harness({});
    expect(() => s._handleMessage('{not json')).not.toThrow();
    expect(() => s._handleMessage('')).not.toThrow();
  });

  it('surfaces session errors', () => {
    const s = harness({});
    s._handleMessage(JSON.stringify({ type: 'error', error: { message: 'rate limited' } }));
    expect(s.error.value).toBe('rate limited');
  });

  it('stop() is safe when never started', () => {
    const s = harness({});
    expect(() => s.stop()).not.toThrow();
    expect(s.isActive.value).toBe(false);
  });
});
