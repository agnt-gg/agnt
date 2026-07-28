/**
 * Regression gate for the universal required-parameter guard.
 *
 * WHAT HAPPENED (measured 2026-07-28)
 * -----------------------------------
 * 73 of 3,519 production `edit_file` calls executed with `{}` — every required
 * parameter absent. 100% originated from Anthropic-family adapters, because
 * AJV validation was wired into `OpenAiLikeAdapter` alone; Anthropic, Gemini,
 * OpenAI-Responses and Codex never validated and never returned
 * `invalidToolCalls`, leaving the orchestrator's recovery pipeline dead.
 *
 * `edit_file` then resolved its missing `path` to the workspace ROOT DIRECTORY
 * and `fs.readFile` raised `EISDIR: illegal operation on a directory, read` —
 * an error describing the symptom and hiding the cause.
 *
 * This guard makes the class impossible: no tool executes without the
 * parameters its own schema declares required, on any provider.
 *
 * THE TESTS THAT MATTER MOST are the fail-open ones. A gate in front of every
 * tool call on every provider is far more dangerous when it rejects something
 * valid than when it misses something invalid.
 */
import { describe, it, expect } from 'vitest';
import {
  findMissingRequiredParams,
  findBlockingMissingParams,
  formatMissingParamsError,
  stripControlParams,
  findToolSchema,
  ASYNC_CONTROL_PARAMS,
} from './toolArgGuard.js';

const schema = (name, required, properties = {}) => ({
  type: 'function',
  function: { name, description: name, parameters: { type: 'object', properties, required } },
});

const SCHEMAS = [
  schema('edit_file', ['path', 'edits', 'description']),
  schema('write_file', ['path', 'content']),
  schema('list_tools', []),
  { type: 'function', function: { name: 'no_params', description: 'x', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'no_schema_at_all', description: 'x' } },
];

describe('findMissingRequiredParams — catches the production failure', () => {
  it('flags every required param when the model sends {} (the exact EISDIR case)', () => {
    expect(findMissingRequiredParams('edit_file', {}, SCHEMAS)).toEqual(['path', 'edits', 'description']);
  });

  it('flags a partially-truncated argument object', () => {
    expect(findMissingRequiredParams('edit_file', { path: 'a.js' }, SCHEMAS)).toEqual(['edits', 'description']);
  });

  it('treats explicit undefined and null as missing', () => {
    const missing = findMissingRequiredParams(
      'edit_file',
      { path: undefined, edits: null, description: 'ok' },
      SCHEMAS,
    );
    expect(missing).toEqual(['path', 'edits']);
  });

  it('passes a fully-formed call', () => {
    const args = { path: 'a.js', edits: [{ search: 'x', replace: 'y' }], description: 'd' };
    expect(findMissingRequiredParams('edit_file', args, SCHEMAS)).toEqual([]);
  });
});

describe('findMissingRequiredParams — fails OPEN (no false rejections)', () => {
  it('never blocks a tool whose schema is not in the list (discover_tools / MCP / plugins)', () => {
    expect(findMissingRequiredParams('some_tool_loaded_mid_turn', {}, SCHEMAS)).toEqual([]);
  });

  it('never blocks when the schema declares no required array', () => {
    expect(findMissingRequiredParams('no_params', {}, SCHEMAS)).toEqual([]);
    expect(findMissingRequiredParams('no_schema_at_all', {}, SCHEMAS)).toEqual([]);
  });

  it('never blocks a no-parameter tool called with {} — that is legitimate', () => {
    // list_tools, get_canvas_state, list_pages et al. correctly send {}.
    // The DB showed 100% "empty" rates for these; they are not failures.
    expect(findMissingRequiredParams('list_tools', {}, SCHEMAS)).toEqual([]);
  });

  it('never blocks when the schema array is missing or malformed', () => {
    expect(findMissingRequiredParams('edit_file', {}, undefined)).toEqual([]);
    expect(findMissingRequiredParams('edit_file', {}, null)).toEqual([]);
    expect(findMissingRequiredParams('edit_file', {}, 'not-an-array')).toEqual([]);
    expect(findMissingRequiredParams('edit_file', {}, [null, undefined, {}])).toEqual([]);
  });

  it('does NOT treat an empty string as missing — "" is valid for some params', () => {
    // write_file creating an empty file must not be blocked here. Parameters
    // for which blank is meaningless reject it in their own implementation.
    expect(findMissingRequiredParams('write_file', { path: 'a.txt', content: '' }, SCHEMAS)).toEqual([]);
  });

  it('does NOT treat 0 or false as missing', () => {
    const s = [schema('t', ['count', 'flag'])];
    expect(findMissingRequiredParams('t', { count: 0, flag: false }, s)).toEqual([]);
  });

  it('tolerates non-object args without throwing', () => {
    for (const bad of [null, undefined, 'str', 42, []]) {
      expect(() => findMissingRequiredParams('edit_file', bad, SCHEMAS)).not.toThrow();
    }
  });
});

describe('orchestrator control params are invisible to the schema', () => {
  it('strips every async control param', () => {
    const args = { path: 'a.js', _executeAsync: true, _interval: 60, _stopAfter: 1, _duration: 5, _delayFirst: true, _estimatedMinutes: 2 };
    expect(stripControlParams(args)).toEqual({ path: 'a.js' });
  });

  it('does not mutate the input', () => {
    const args = { path: 'a.js', _executeAsync: true };
    stripControlParams(args);
    expect(args._executeAsync).toBe(true);
  });

  it('an async-queued call with all real params passes', () => {
    const args = { path: 'a.js', edits: [], description: 'd', _executeAsync: true, _interval: 30 };
    expect(findMissingRequiredParams('edit_file', args, SCHEMAS)).toEqual([]);
  });

  it('control params alone do not satisfy a requirement', () => {
    expect(findMissingRequiredParams('edit_file', { _executeAsync: true }, SCHEMAS)).toEqual(['path', 'edits', 'description']);
  });

  it('the control-param list matches what the orchestrator strips', () => {
    // Guard against drift: if OrchestratorService gains a control param and
    // this list is not updated, schemas with additionalProperties:false could
    // start seeing it.
    expect([...ASYNC_CONTROL_PARAMS].sort()).toEqual(
      ['_delayFirst', '_duration', '_estimatedMinutes', '_executeAsync', '_interval', '_stopAfter'],
    );
  });
});

/**
 * THE BLOCKING DECISION.
 *
 * `findMissingRequiredParams` reports what is absent. `findBlockingMissingParams`
 * decides whether that is fatal. They are separate because conflating them is
 * exactly how the first version of this guard produced 248 false rejections
 * against production data.
 */
describe('findBlockingMissingParams — blocks only total argument loss', () => {
  it('blocks when the model sent {} (the exact EISDIR case)', () => {
    expect(findBlockingMissingParams('edit_file', {}, SCHEMAS)).toEqual(['path', 'edits', 'description']);
  });

  it('blocks when only orchestrator control params arrived', () => {
    expect(findBlockingMissingParams('edit_file', { _executeAsync: true }, SCHEMAS)).toHaveLength(3);
  });

  it('blocks when the object has keys but NONE the schema asked for', () => {
    // query_data in production: 25 calls arrived with unrelated keys and no
    // `operation`. Genuinely broken, and caught.
    const s = [schema('query_data', ['operation'])];
    expect(findBlockingMissingParams('query_data', { dataId: 'x', limit: 5 }, s)).toEqual(['operation']);
  });

  it('DOES NOT block a partial call — the critical narrowing', () => {
    // Some required params present => the arguments arrived; whether they are
    // sufficient is the tool's own business, not this choke point's.
    expect(findBlockingMissingParams('edit_file', { path: 'a.js' }, SCHEMAS)).toEqual([]);
    expect(findBlockingMissingParams('edit_file', { path: 'a.js', edits: [] }, SCHEMAS)).toEqual([]);
  });

  it('does not block a fully-formed call', () => {
    const args = { path: 'a.js', edits: [{ search: 'x', replace: 'y' }], description: 'd' };
    expect(findBlockingMissingParams('edit_file', args, SCHEMAS)).toEqual([]);
  });

  it('fails open exactly like the reporter (unknown tool, no requirements)', () => {
    expect(findBlockingMissingParams('tool_loaded_mid_turn', {}, SCHEMAS)).toEqual([]);
    expect(findBlockingMissingParams('list_tools', {}, SCHEMAS)).toEqual([]);
    expect(findBlockingMissingParams('no_schema_at_all', {}, SCHEMAS)).toEqual([]);
    expect(findBlockingMissingParams('edit_file', {}, undefined)).toEqual([]);
  });
});

describe('immunity to schemas that over-declare `required`', () => {
  // THESE ARE REAL SCHEMAS AND REAL PAYLOADS. Replaying 87,843 production tool
  // calls found 248 that COMPLETED SUCCESSFULLY but would have been blocked by
  // an "any required param missing" predicate, all from these three plugins.
  //
  // Patching the three schemas would not have been a fix: 206 of the 304 tool
  // schemas on a live install come from third-party plugins and MCP servers,
  // whose authors reasonably use `required` to mean "the model should think
  // about this". A choke point in front of every tool call cannot depend on
  // the quality of schemas it does not control.
  //
  // If any of these starts blocking, the predicate has been wrongly tightened.
  const PLUGIN_SCHEMAS = [
    schema('seedance_api', [
      'prompt', 'firstFrameUrl', 'referenceImageUrls', 'referenceVideoUrls',
      'referenceAudioUrls', 'rawPassthroughJson', 'seed', 'filename',
    ]),
    schema('proofkit_counterexample', ['verificationId', 'action', 'counterexample']),
    schema('stripe_invoice', ['customerEmail', 'dueDate', 'amount', 'description', 'lineItems']),
  ];

  it('seedance_api: a prompt-only text-to-video call is not blocked (227 real calls)', () => {
    const args = { prompt: 'Slow dolly-in on a glowing neon cyan cube', filename: 'cube.mp4' };
    expect(findBlockingMissingParams('seedance_api', args, PLUGIN_SCHEMAS)).toEqual([]);
  });

  it('proofkit_counterexample: MARK_ADVERSARIAL_COMPLETE needs no counterexample (19 real calls)', () => {
    const args = { verificationId: 'pv_mruh7uir', action: 'MARK_ADVERSARIAL_COMPLETE', agent: 'ProofKit Adversary' };
    expect(findBlockingMissingParams('proofkit_counterexample', args, PLUGIN_SCHEMAS)).toEqual([]);
  });

  it('stripe_invoice: single-item mode does not supply lineItems (2 real calls)', () => {
    // `amount`+`description` and `lineItems` are mutually exclusive modes, yet
    // the schema marks all three required. Both modes must keep working.
    const args = { customerEmail: 'a@b.com', dueDate: '2026-01-17', amount: 5000, description: 'Consulting', currency: 'USD' };
    expect(findBlockingMissingParams('stripe_invoice', args, PLUGIN_SCHEMAS)).toEqual([]);
  });

  it('but a TOTALLY empty call to those same tools is still blocked', () => {
    // The narrowing must not have disarmed the guard.
    for (const name of ['seedance_api', 'proofkit_counterexample', 'stripe_invoice']) {
      expect(findBlockingMissingParams(name, {}, PLUGIN_SCHEMAS).length).toBeGreaterThan(0);
    }
  });
});

describe('findToolSchema', () => {
  it('finds by function name', () => {
    expect(findToolSchema('edit_file', SCHEMAS)?.function?.name).toBe('edit_file');
  });
  it('returns undefined for unknown tools and bad input', () => {
    expect(findToolSchema('nope', SCHEMAS)).toBeUndefined();
    expect(findToolSchema('edit_file', null)).toBeUndefined();
  });
});

describe('formatMissingParamsError — written for the model, not the log', () => {
  const err = formatMissingParamsError('edit_file', ['path', 'edits'], { description: 'd', _executeAsync: true });

  it('is a recoverable failure, not an exception', () => {
    expect(err.success).toBe(false);
    expect(err.recoverable).toBe(true);
  });

  it('names the tool and every missing parameter', () => {
    expect(err.tool).toBe('edit_file');
    expect(err.missingParameters).toEqual(['path', 'edits']);
    expect(err.error).toContain('path');
    expect(err.error).toContain('edits');
  });

  it('reports what actually arrived, with control params hidden', () => {
    expect(err.error).toContain('description');
    expect(err.error).not.toContain('_executeAsync');
  });

  it('says "no parameters at all" for the {} case rather than an empty list', () => {
    const e = formatMissingParamsError('edit_file', ['path'], {});
    expect(e.error).toContain('no parameters at all');
  });

  it('explains truncation and tells the model exactly what to do', () => {
    expect(err.suggestion).toMatch(/truncated/i);
    expect(err.suggestion).toMatch(/re-issue/i);
  });

  it('never mentions EISDIR or a directory — the old misleading symptom', () => {
    const blob = JSON.stringify(err);
    expect(blob).not.toMatch(/EISDIR/i);
    expect(blob).not.toMatch(/illegal operation on a directory/i);
  });
});
