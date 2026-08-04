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
          arguments: JSON.stringify({ instruction: 'open the auth file' }),
          ...overrides,
        },
      ],
    },
  });

  it('turns a run_agnt call into a RUN_AGNT action carrying the instruction', () => {
    const a = first(functionCall());
    expect(a.type).toBe(BridgeAction.RUN_AGNT);
    expect(a.callId).toBe('call_abc');
    expect(a.instruction).toBe('open the auth file');
    expect(a.parseError).toBeNull();
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
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.callId)).toEqual(['a', 'b']);
  });

  it('ignores a plain spoken response with no tool call', () => {
    expect(
      interpretEvent({ type: 'response.done', response: { output: [{ type: 'message' }] } })
    ).toEqual([]);
  });

  it('tolerates a response with no output array at all', () => {
    expect(interpretEvent({ type: 'response.done', response: {} })).toEqual([]);
    expect(interpretEvent({ type: 'response.done' })).toEqual([]);
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

  it('response.create is the trigger to speak', () => {
    expect(buildResponseCreate()).toEqual({ type: 'response.create' });
  });

  it('an aside stays out of session history so it cannot confuse later turns', () => {
    const e = buildSpokenAside('still working on it');
    expect(e.response.conversation).toBe('none');
    expect(e.response.output_modalities).toEqual(['audio']);
    expect(e.response.instructions).toContain('still working on it');
  });
});
