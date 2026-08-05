import { describe, it, expect } from 'vitest';
import {
  interpretEvent,
  buildFunctionOutput,
  buildResponseCreate,
  buildSpokenAside,
  BridgeAction,
  AGNT_TOOL_NAME,
} from './realtimeBridge.js';

const first = (event) => interpretEvent(event)[0];

describe('interpretEvent — the tool call that makes AGNT the brain', () => {
  const functionCall = (overrides = {}) => ({
    type: 'response.done',
    response: {
      output: [
        {
          type: 'function_call',
          name: AGNT_TOOL_NAME,
          call_id: 'call_abc',
          arguments: JSON.stringify({ user_message: 'open the auth file' }),
          ...overrides,
        },
      ],
    },
  });

  it('turns a run_agnt call into a RUN_AGNT action carrying the user\u2019s words', () => {
    const a = first(functionCall());
    expect(a.type).toBe(BridgeAction.RUN_AGNT);
    expect(a.callId).toBe('call_abc');
    expect(a.instruction).toBe('open the auth file');
    expect(a.parseError).toBeNull();
  });

  it('reads the verbatim field, `user_message`', () => {
    // Named as a quote rather than `instruction`, which invited the model to
    // author one. See realtimeVoiceService.buildTools.
    const a = first(functionCall({ arguments: JSON.stringify({ user_message: 'hey, what all can you do?' }) }));
    expect(a.instruction).toBe('hey, what all can you do?');
  });

  it('still reads a legacy `instruction` field, for a stale browser bundle', () => {
    // The tool schema is server-authored and sent at connect time, so a page
    // loaded before the rename would otherwise find nothing and report every
    // turn as unreadable.
    const a = first(functionCall({ arguments: JSON.stringify({ instruction: 'from an older bundle' }) }));
    expect(a.instruction).toBe('from an older bundle');
  });

  it('prefers user_message when both are present', () => {
    const a = first(
      functionCall({ arguments: JSON.stringify({ user_message: 'the real words', instruction: 'a rewrite' }) })
    );
    expect(a.instruction).toBe('the real words');
  });

  it('survives malformed argument JSON rather than throwing', () => {
    // A model under load can emit broken JSON. Throwing here would kill the
    // whole session for what should cost one turn.
    const a = first(functionCall({ arguments: '{"instruction": "unterminated' }));
    expect(a.type).toBe(BridgeAction.RUN_AGNT);
    expect(a.callId).toBe('call_abc');
    expect(a.parseError).toBeTruthy();
    expect(a.instruction).toBe('');
  });

  it('reports an unknown tool INSTEAD of ignoring it (an ignored call hangs)', () => {
    // The session declares exactly one tool. If anything else appears the
    // config has drifted — and silently dropping it leaves the model waiting
    // on a function_call_output that will never come.
    const a = first(functionCall({ name: 'delete_everything' }));
    expect(a.type).toBe(BridgeAction.ERROR);
    expect(a.callId).toBe('call_abc'); // so the runtime can still answer it
    expect(a.message).toMatch(/unknown tool/i);
  });

  it('handles several tool calls in one response', () => {
    const actions = interpretEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'a', arguments: '{"instruction":"one"}' },
          { type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'b', arguments: '{"instruction":"two"}' },
        ],
      },
    });
    // Both calls, then the turn marker. EVERY call must be present: a dropped
    // one is never answered, and the session blocks on it for ever.
    const runs = actions.filter((a) => a.type === BridgeAction.RUN_AGNT);
    expect(runs.map((a) => a.callId)).toEqual(['a', 'b']);
    expect(actions.at(-1)).toEqual({ type: BridgeAction.TURN_COMPLETE, hadToolCall: true });
  });

  it('a plain spoken response yields only the turn marker, no tool action', () => {
    const actions = interpretEvent({
      type: 'response.done',
      response: { output: [{ type: 'message' }] },
    });
    expect(actions).toEqual([{ type: BridgeAction.TURN_COMPLETE, hadToolCall: false }]);
  });

  it('tolerates a response with no output array at all', () => {
    expect(interpretEvent({ type: 'response.done', response: {} })).toEqual([
      { type: BridgeAction.TURN_COMPLETE, hadToolCall: false },
    ]);
    expect(interpretEvent({ type: 'response.done' })).toEqual([
      { type: BridgeAction.TURN_COMPLETE, hadToolCall: false },
    ]);
  });
});

describe('interpretEvent — a cancelled response does not re-run its tool call', () => {
  /**
   * THE REPEAT BUG. `response.done` fires for every response the server
   * finishes with, INCLUDING one it cancelled because the user started
   * speaking — and that frame still carries the function_call in `output[]`.
   * Dispatching on it re-ran a call that had already run, so the same words
   * were submitted again as a new user message, answered again, spoken again,
   * and any further interruption repeated the cycle.
   */
  const doneWithCall = (status) => ({
    type: 'response.done',
    response: {
      ...(status === undefined ? {} : { status }),
      output: [
        {
          type: 'function_call',
          name: AGNT_TOOL_NAME,
          call_id: 'call_1',
          arguments: JSON.stringify({ user_message: 'what is the build status' }),
        },
      ],
    },
  });

  const runs = (event) => interpretEvent(event).filter((a) => a.type === BridgeAction.RUN_AGNT);

  it('dispatches a COMPLETED response', () => {
    expect(runs(doneWithCall('completed'))).toHaveLength(1);
  });

  it.each(['cancelled', 'incomplete', 'failed'])('does NOT dispatch a %s response', (status) => {
    expect(runs(doneWithCall(status))).toHaveLength(0);
  });

  it('a cancelled response is not reported as having had a tool call', () => {
    // Otherwise the runtime treats the turn as already written to the chat
    // when in fact nothing was ever sent.
    const actions = interpretEvent(doneWithCall('cancelled'));
    expect(actions.at(-1)).toEqual({ type: BridgeAction.TURN_COMPLETE, hadToolCall: false });
  });

  it('STILL emits TURN_COMPLETE when cancelled — or the speak queue stalls', () => {
    // The runtime clears `responseActive` on this marker. Dropping it for
    // cancelled responses would leave the session permanently unable to speak
    // again: a deadlock traded for a repeat.
    const actions = interpretEvent(doneWithCall('cancelled'));
    expect(actions.some((a) => a.type === BridgeAction.TURN_COMPLETE)).toBe(true);
  });

  it('FAILS OPEN: a missing status still dispatches', () => {
    // `status` is a GA-interface field. Treating its absence as "cancelled"
    // would stop dispatching every call on any shape that omits it — a session
    // that silently never acts, which is worse than the bug being fixed.
    expect(runs(doneWithCall(undefined))).toHaveLength(1);
  });
});

describe('interpretEvent — TURN_COMPLETE tells the runtime what to record', () => {
  /**
   * The runtime cannot know whether a turn is already in the chat until it
   * knows whether the turn delegated. A delegated turn is written by the
   * run_agnt path; a turn the model answered alone exists only as audio. So
   * every response ends with a marker carrying that one fact.
   */
  it('marks a delegated turn', () => {
    const actions = interpretEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'c', arguments: '{"instruction":"x"}' },
        ],
      },
    });
    expect(actions.at(-1)).toEqual({ type: BridgeAction.TURN_COMPLETE, hadToolCall: true });
  });

  it('marks a turn the model answered by itself', () => {
    const actions = interpretEvent({ type: 'response.done', response: { output: [] } });
    expect(actions.at(-1)).toEqual({ type: BridgeAction.TURN_COMPLETE, hadToolCall: false });
  });

  it('comes LAST, so the runtime sees the tool calls before it decides', () => {
    const actions = interpretEvent({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', name: AGNT_TOOL_NAME, call_id: 'c', arguments: '{"instruction":"x"}' },
        ],
      },
    });
    expect(actions[0].type).toBe(BridgeAction.RUN_AGNT);
    expect(actions.at(-1).type).toBe(BridgeAction.TURN_COMPLETE);
  });

  it('an unknown tool still counts as a delegated turn', () => {
    // It tried to delegate; the chat write is handled by the error path. What
    // matters here is that we do not ALSO record its transcript.
    const actions = interpretEvent({
      type: 'response.done',
      response: { output: [{ type: 'function_call', name: 'nope', call_id: 'c', arguments: '{}' }] },
    });
    expect(actions.at(-1)).toEqual({ type: BridgeAction.TURN_COMPLETE, hadToolCall: true });
  });
});

describe('interpretEvent — transcripts and turn edges', () => {
  it('reports what the USER said', () => {
    const a = first({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '  open the repo  ',
    });
    expect(a).toEqual({ type: BridgeAction.USER_SAID, text: 'open the repo' });
  });

  it('reports what the ASSISTANT said', () => {
    const a = first({ type: 'response.output_audio_transcript.done', transcript: 'All done.' });
    expect(a).toEqual({ type: BridgeAction.ASSISTANT_SAID, text: 'All done.' });
  });

  it('streams assistant partials', () => {
    const a = first({ type: 'response.output_audio_transcript.delta', delta: 'Hel' });
    expect(a).toEqual({ type: BridgeAction.ASSISTANT_PARTIAL, delta: 'Hel' });
  });

  it('drops empty transcripts instead of emitting blank turns', () => {
    expect(interpretEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' })).toEqual([]);
    expect(interpretEvent({ type: 'response.output_audio_transcript.done', transcript: '' })).toEqual([]);
    expect(interpretEvent({ type: 'response.output_audio_transcript.delta', delta: '' })).toEqual([]);
  });

  it('reports barge-in when the user starts talking', () => {
    expect(first({ type: 'input_audio_buffer.speech_started' })).toEqual({
      type: BridgeAction.USER_INTERRUPTED,
    });
  });

  it('reports session readiness', () => {
    expect(first({ type: 'session.created', session: { id: 's1' } }).type).toBe(BridgeAction.READY);
    expect(first({ type: 'session.updated', session: { id: 's1' } }).type).toBe(BridgeAction.READY);
  });

  it('surfaces session errors', () => {
    const a = first({ type: 'error', error: { message: 'rate limited', code: 'rate_limit' } });
    expect(a.type).toBe(BridgeAction.ERROR);
    expect(a.message).toBe('rate limited');
    expect(a.code).toBe('rate_limit');
  });
});

describe('interpretEvent — robustness', () => {
  it('ignores unknown event types', () => {
    expect(interpretEvent({ type: 'rate_limits.updated' })).toEqual([]);
    expect(interpretEvent({ type: 'response.created' })).toEqual([]);
  });

  it('never throws on garbage', () => {
    for (const junk of [null, undefined, 42, 'string', {}, { type: 7 }, []]) {
      expect(() => interpretEvent(junk)).not.toThrow();
      expect(interpretEvent(junk)).toEqual([]);
    }
  });
});

describe('client event builders', () => {
  it('answers a tool call with a STRING output (the API rejects objects)', () => {
    const e = buildFunctionOutput('call_1', 'the build is green');
    expect(e.type).toBe('conversation.item.create');
    expect(e.item.type).toBe('function_call_output');
    expect(e.item.call_id).toBe('call_1');
    expect(typeof e.item.output).toBe('string');
    expect(e.item.output).toBe('the build is green');
  });

  it('serialises a non-string result rather than sending an object', () => {
    expect(typeof buildFunctionOutput('c', { ok: true }).item.output).toBe('string');
    expect(typeof buildFunctionOutput('c', undefined).item.output).toBe('string');
  });

  it('response.create is the trigger to speak — and can NEVER act', () => {
    // tools: [] is load-bearing: a client-created response inherits the
    // session's tools by default, and a model instructed to send everything
    // to run_agnt will occasionally re-call it from the response meant to
    // read the answer aloud — re-posting the user's words as a new turn.
    expect(buildResponseCreate()).toEqual({ type: 'response.create', response: { tools: [] } });
  });

  it('an aside stays out of session history so it cannot confuse later turns', () => {
    const e = buildSpokenAside('still working on it');
    expect(e.response.conversation).toBe('none');
    expect(e.response.output_modalities).toEqual(['audio']);
    expect(e.response.instructions).toContain('still working on it');
    // An aside is a sentence to speak — it must not be able to call tools.
    expect(e.response.tools).toEqual([]);
  });
});
