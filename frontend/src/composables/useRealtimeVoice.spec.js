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
          arguments: JSON.stringify({ user_message: 'check the build' }),
          ...overrides,
        },
      ],
    },
  });

/** Build a session whose outgoing frames land in `sent`. */
function harness(options = {}) {
  return useRealtimeVoice({ ...options, sendFrame: (e) => sent.push(e) });
}

/** A response.done frame, with or without a tool call. */
const turnDoneFrame = (hadToolCall) =>
  JSON.stringify({
    type: 'response.done',
    response: {
      output: hadToolCall
        ? [{ type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'c1', arguments: '{"user_message":"go"}' }]
        : [],
    },
  });

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

    // (instruction, emit) — emit is what lets the host stream sentences.
    expect(onRunAgnt).toHaveBeenCalledWith('check the build', expect.any(Function));
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

    s._handleMessage(toolCallFrame({ arguments: JSON.stringify({ user_message: '   ' }) }));
    await vi.advanceTimersByTimeAsync(10);

    expect(onRunAgnt).not.toHaveBeenCalled();
    expect(expectAnswered('call_1')).toMatch(/could not read/i);
  });

  it('malformed arguments are answered, not dropped', async () => {
    const onRunAgnt = vi.fn();
    const s = harness({ onRunAgnt });

    s._handleMessage(toolCallFrame({ arguments: '{"user_message": broken' }));
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

describe('useRealtimeVoice — speaks as the answer arrives, not after it lands', () => {
  /**
   * Waiting for the whole turn before speaking a word means silence for as
   * long as the turn takes — a minute on a tool-heavy run. The answer streams,
   * so it is spoken as it streams.
   */
  const asides = () => sent.filter((e) => e.type === 'response.create' && e.response);

  it('THE FIRST SENTENCE answers the call, before the run has finished', async () => {
    let finish;
    const s = harness({
      onRunAgnt: (instruction, emit) =>
        new Promise((resolve) => {
          emit('The build is green.');
          finish = () => resolve('');
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    // Answered while the orchestrator is still working — that is what starts
    // the voice immediately instead of after the turn.
    expect(expectAnswered('call_1')).toBe('The build is green.');
    finish();
    await vi.advanceTimersByTimeAsync(10);
  });

  it('later sentences are spoken ONE AT A TIME, not fired all at once', async () => {
    // The session allows one active response; a second create while the first
    // is still speaking is an error.
    let emitFn;
    const s = harness({
      onRunAgnt: (instruction, emit) =>
        new Promise((resolve) => {
          emitFn = emit;
          emit('First sentence.');
          resolve('');
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    emitFn('Second sentence.');
    emitFn('Third sentence.');
    await vi.advanceTimersByTimeAsync(10);

    // The first response is still active, so exactly one aside has gone out.
    expect(asides()).toHaveLength(1);
    expect(asides()[0].response.instructions).toContain('Second sentence.');

    // That response completes -> the next one is released.
    s._handleMessage(turnDoneFrame(false));
    await vi.advanceTimersByTimeAsync(10);
    expect(asides()).toHaveLength(2);
    expect(asides()[1].response.instructions).toContain('Third sentence.');
  });

  it('a run that streams NOTHING is still answered (deadlock guard holds)', async () => {
    const s = harness({ onRunAgnt: async () => '' });
    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);
    expect(expectAnswered('call_1')).toBeTruthy();
  });

  it('a host that ignores `emit` entirely still works', async () => {
    // The old contract returned the whole answer; that path must not break.
    const s = harness({ onRunAgnt: async () => 'the whole answer at once' });
    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);
    expect(expectAnswered('call_1')).toBe('the whole answer at once');
  });

  it('empty or whitespace emits are ignored rather than spoken', async () => {
    const s = harness({
      onRunAgnt: async (instruction, emit) => {
        emit('   ');
        emit('');
        emit('Real sentence.');
        return '';
      },
    });
    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);
    expect(expectAnswered('call_1')).toBe('Real sentence.');
  });

  it('emits after the session stops are dropped', async () => {
    let emitFn;
    const s = harness({
      onRunAgnt: (instruction, emit) =>
        new Promise(() => {
          emitFn = emit;
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(1);
    s.stop();

    emitFn('should never be spoken');
    await vi.advanceTimersByTimeAsync(10);
    expect(answersFor('call_1')).toHaveLength(0);
  });
});

describe('useRealtimeVoice — an interrupt stops ALL of the speech', () => {
  /**
   * REPORTED: "if I interrupt then the old speech still comes back".
   *
   * Barge-in is server-side, and the server truncates the audio it is
   * currently playing — that is all it knows about. Everything else waiting to
   * be spoken lives on the client: sentences already queued, and an
   * orchestrator run still streaming more. The cancelled response's
   * `response.done` then drained the queue and the old answer resumed, which
   * is precisely what the user interrupted to stop.
   */
  const interrupt = () => JSON.stringify({ type: 'input_audio_buffer.speech_started' });
  const asides = () => sent.filter((e) => e.type === 'response.create' && e.response);

  /**
   * Drive three streamed sentences and stop just short of the interrupt.
   * Shared by the interrupt test and its control below, so both are provably
   * looking at the same situation.
   */
  async function streamThreeSentences() {
    let emitFn;
    const s = harness({
      onRunAgnt: (instruction, emit) =>
        new Promise((resolve) => {
          emitFn = emit;
          emit('First sentence.');
          resolve('');
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);
    emitFn('Second sentence.');
    emitFn('Third sentence.');
    await vi.advanceTimersByTimeAsync(10);
    return { s, emitFn };
  }

  it('THE BUG: queued sentences are dropped, not resumed after the cancel', async () => {
    const { s } = await streamThreeSentences();

    // Some sentences WILL already have been spoken — that is the streaming
    // design working. The property under test is that the count stops growing
    // once the user takes the floor.
    const spokenBeforeInterrupt = asides().length;

    s._handleMessage(interrupt());
    // The server cancels the in-flight response and reports it done. THIS is
    // the frame that used to resume the old answer.
    s._handleMessage(turnDoneFrame(false));
    await vi.advanceTimersByTimeAsync(50);

    expect(asides(), 'a queued sentence was spoken after the interrupt').toHaveLength(
      spokenBeforeInterrupt
    );
  });

  it('CONTROL: without the interrupt, that same queue does drain', async () => {
    // Without this, the test above would pass on an empty queue and prove
    // nothing at all.
    const { s } = await streamThreeSentences();
    const spokenBefore = asides().length;

    s._handleMessage(turnDoneFrame(false));
    await vi.advanceTimersByTimeAsync(50);

    expect(asides().length, 'nothing was pending, so the interrupt test is vacuous').toBeGreaterThan(
      spokenBefore
    );
  });

  it('a run still streaming when interrupted says nothing more', async () => {
    let emitFn;
    const s = harness({
      onRunAgnt: (instruction, emit) =>
        new Promise((resolve) => {
          emitFn = emit;
          emit('First sentence.');
          // deliberately never resolves during the interrupt
          setTimeout(() => resolve(''), 5000);
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    s._handleMessage(interrupt());
    await vi.advanceTimersByTimeAsync(10);

    const before = sent.length;
    emitFn('This must never be spoken.');
    s._handleMessage(turnDoneFrame(false));
    await vi.advanceTimersByTimeAsync(50);

    expect(asides()).toHaveLength(0);
    expect(sent.length, 'frames were emitted after the interrupt').toBe(before);
  });

  it('a run interrupted BEFORE it answered still answers — but silently', async () => {
    // The session blocks for ever on an unanswered call, so it must be
    // answered. It must NOT be spoken: the user moved on.
    let finish;
    const s = harness({
      onRunAgnt: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    s._handleMessage(interrupt());
    await vi.advanceTimersByTimeAsync(10);

    finish('the answer nobody is waiting for any more');
    await vi.advanceTimersByTimeAsync(50);

    expect(answersFor('call_1'), 'the call was left unanswered — the session hangs').toHaveLength(1);
    expect(asides(), 'the abandoned answer was spoken').toHaveLength(0);
    expect(sent.some((e) => e.type === 'response.create' && !e.response)).toBe(false);
  });

  it('the interrupted turn is not recorded as an off-script turn', async () => {
    const onUserSaid = vi.fn();
    const onAssistantSaid = vi.fn();
    const s = harness({ onUserSaid, onAssistantSaid, onRunAgnt: async () => 'x' });

    s._handleMessage(
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'what is the build status',
      })
    );
    s._handleMessage(
      JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'The build is' })
    );
    s._handleMessage(interrupt());
    s._handleMessage(turnDoneFrame(false));
    await vi.advanceTimersByTimeAsync(20);

    expect(onUserSaid).not.toHaveBeenCalled();
    expect(onAssistantSaid).not.toHaveBeenCalled();
  });

  it('speech works normally again after an interrupt', async () => {
    const s = harness({ onRunAgnt: async () => 'the fresh answer' });

    s._handleMessage(interrupt());
    await vi.advanceTimersByTimeAsync(10);

    s._handleMessage(toolCallFrame());
    await vi.advanceTimersByTimeAsync(10);

    expect(expectAnswered('call_1')).toBe('the fresh answer');
  });
});

describe('useRealtimeVoice — every exchange leaves a trace, exactly once', () => {
  /**
   * The user reported watching a voice conversation happen with nothing
   * appearing in the chat. Two rules have to hold together:
   *   - a delegated turn is written ONCE, by the run_agnt path
   *   - a turn the model somehow answered alone is still written, not lost
   */
  const userSpeech = (text) =>
    JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: text });
  const assistantSpeech = (text) =>
    JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: text });
  const turnDone = (hadToolCall) =>
    JSON.stringify({
      type: 'response.done',
      response: {
        output: hadToolCall
          ? [{ type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'c1', arguments: '{"user_message":"go"}' }]
          : [],
      },
    });

  it('a DELEGATED turn is not echoed — run_agnt already wrote it', async () => {
    const onUserSaid = vi.fn();
    const onAssistantSaid = vi.fn();
    const s = harness({ onUserSaid, onAssistantSaid, onRunAgnt: async () => 'the build is green' });

    s._handleMessage(userSpeech('what is the build status'));
    s._handleMessage(assistantSpeech('let me look'));
    s._handleMessage(turnDone(true));
    await vi.advanceTimersByTimeAsync(10);

    expect(onUserSaid).not.toHaveBeenCalled();
    expect(onAssistantSaid).not.toHaveBeenCalled();
  });

  it('the narration of her answer is not echoed either — it is already verbatim in the chat', async () => {
    const onAssistantSaid = vi.fn();
    const s = harness({ onAssistantSaid, onRunAgnt: async () => 'the build is green' });

    // Turn 1: delegates.
    s._handleMessage(userSpeech('what is the build status'));
    s._handleMessage(turnDone(true));
    await vi.advanceTimersByTimeAsync(10);

    // Turn 2: speaks the result that run_agnt already put in the chat.
    s._handleMessage(assistantSpeech('the build is green'));
    s._handleMessage(turnDone(false));
    await vi.advanceTimersByTimeAsync(10);

    expect(onAssistantSaid).not.toHaveBeenCalled();
  });

  it('REGRESSION: an OFF-SCRIPT turn is recorded rather than vanishing', async () => {
    // The instructions forbid answering alone, but if the model does it anyway
    // the exchange must not disappear: a visible wrong turn can be corrected,
    // an invisible one cannot.
    const onUserSaid = vi.fn();
    const onAssistantSaid = vi.fn();
    const s = harness({ onUserSaid, onAssistantSaid });

    s._handleMessage(userSpeech('hello'));
    s._handleMessage(assistantSpeech('Hi there.'));
    s._handleMessage(turnDone(false));
    await vi.advanceTimersByTimeAsync(10);

    expect(onUserSaid).toHaveBeenCalledWith('hello');
    expect(onAssistantSaid).toHaveBeenCalledWith('Hi there.');
  });

  it('REGRESSION: a multi-sentence narration is not recorded as off-script', async () => {
    // The answer now streams across several responses. Clearing the narration
    // flag on the first one would make sentences two onward look like turns
    // the model invented, and they would be written to the chat a second time.
    const onAssistantSaid = vi.fn();
    let emitFn;
    const s = harness({
      onAssistantSaid,
      onRunAgnt: (instruction, emit) =>
        new Promise((resolve) => {
          emitFn = emit;
          emit('First sentence.');
          resolve('');
        }),
    });

    s._handleMessage(turnDone(true)); // delegated
    await vi.advanceTimersByTimeAsync(10);
    emitFn('Second sentence.');

    // Sentence one finishes speaking...
    s._handleMessage(assistantSpeech('First sentence.'));
    s._handleMessage(turnDone(false));
    await vi.advanceTimersByTimeAsync(10);

    // ...and sentence two.
    s._handleMessage(assistantSpeech('Second sentence.'));
    s._handleMessage(turnDone(false));
    await vi.advanceTimersByTimeAsync(10);

    expect(onAssistantSaid).not.toHaveBeenCalled();
  });

  it('records an off-script turn only ONCE', async () => {
    const onUserSaid = vi.fn();
    const s = harness({ onUserSaid });

    s._handleMessage(userSpeech('hello'));
    s._handleMessage(assistantSpeech('Hi.'));
    s._handleMessage(turnDone(false));
    s._handleMessage(turnDone(false)); // a second marker must not re-record
    await vi.advanceTimersByTimeAsync(10);

    expect(onUserSaid).toHaveBeenCalledTimes(1);
  });

  it('streams the assistant partial for the live status strip', async () => {
    const s = harness({});

    s._handleMessage(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'All ' }));
    s._handleMessage(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'good.' }));
    expect(s.assistantPartial.value).toBe('All good.');

    s._handleMessage(assistantSpeech('All good.'));
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
