// A per-tool cost guard.
//
// This block is stamped onto every schema in the surface, so any growth here
// is multiplied by the tool count. It reached 193 tokens/tool = 62,849 tokens
// across a 325-tool registry before anyone measured it, purely by each
// description being individually reasonable. Nothing structural prevented
// that, so this test is the thing that prevents it.
import { describe, it, expect } from 'vitest';
import { ASYNC_TOOL_PARAMS, ASYNC_TOOL_PARAMS_MAX_CHARS } from './asyncToolParams.js';

const serialized = JSON.stringify(ASYNC_TOOL_PARAMS);

describe('async tool params stay cheap', () => {
  it('serializes under the per-tool budget', () => {
    expect(serialized.length).toBeLessThanOrEqual(ASYNC_TOOL_PARAMS_MAX_CHARS);
  });

  it('no single description reads like prose', () => {
    for (const [name, spec] of Object.entries(ASYNC_TOOL_PARAMS)) {
      expect(spec.description, `${name} has no description`).toBeTruthy();
      expect(spec.description.length, `${name} description is too long for a per-tool field`).toBeLessThan(130);
    }
  });

  it('still declares every parameter the orchestrator acts on', () => {
    // Shrinking the descriptions must never shrink the SURFACE — a parameter
    // absent from the schema is one a strict validator will reject.
    expect(Object.keys(ASYNC_TOOL_PARAMS).sort()).toEqual([
      '_delayFirst', '_duration', '_estimatedMinutes', '_executeAsync', '_interval', '_stopAfter',
    ]);
    for (const spec of Object.values(ASYNC_TOOL_PARAMS)) {
      expect(['boolean', 'number', 'integer']).toContain(spec.type);
    }
  });

  it('keeps the dependency between _interval and the periodic flags legible', () => {
    // The terse form must still say which flags require which — the prompt
    // explains WHY, but the schema has to disambiguate the units and pairing.
    expect(ASYNC_TOOL_PARAMS._interval.description).toMatch(/seconds/i);
    expect(ASYNC_TOOL_PARAMS._interval.description).toMatch(/_executeAsync/);
    for (const key of ['_stopAfter', '_duration', '_delayFirst']) {
      expect(ASYNC_TOOL_PARAMS[key].description).toMatch(/_interval/);
    }
  });

  it('points at the single canonical explanation rather than inlining it', () => {
    expect(ASYNC_TOOL_PARAMS._executeAsync.description).toMatch(/system prompt/i);
  });
});
