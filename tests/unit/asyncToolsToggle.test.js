/**
 * Unit tests for the per-user "Async tool execution" toggle.
 *
 * Two surfaces are gated by the same flag:
 *   1. Tool schemas — getAvailableToolSchemas({ asyncEnabled }) decides
 *      whether to graft the universal _executeAsync / _interval / etc.
 *      properties onto each tool. With the flag false the LLM never sees
 *      these params and can't request async execution.
 *   2. System prompt — buildUnifiedSystemPrompt only pushes the
 *      ASYNC_EXECUTION_GUIDANCE block when the flag is true. With it false
 *      the prompt has no async guidance.
 *
 * Both pieces are required; either one alone leaves a stale signal that
 * undermines the gate. These tests lock the contract down.
 *
 * Run: npm test  (vitest run)
 *   or: node --test tests/unit/asyncToolsToggle.test.js
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getAvailableToolSchemas } from '../../backend/src/services/orchestrator/tools.js';
import { isAsyncCapableSchema } from '../../backend/src/services/orchestrator/asyncToolParams.js';
import { buildUnifiedSystemPrompt } from '../../backend/src/services/orchestrator/system-prompts/buildUnifiedPrompt.js';

const ASYNC_CAPABLE_SURFACE = {
  toolSchemas: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: {} } } }],
};

const ASYNC_PARAM_KEYS = [
  '_executeAsync',
  '_interval',
  '_stopAfter',
  '_duration',
  '_delayFirst',
  '_estimatedMinutes',
];

function schemaHasAsyncParams(schema) {
  const props = schema?.function?.parameters?.properties || {};
  return ASYNC_PARAM_KEYS.some((k) => Object.prototype.hasOwnProperty.call(props, k));
}

describe('Async tools toggle — getAvailableToolSchemas', () => {
  it('grafts async params on exactly the async-capable schemas by default', async () => {
    const schemas = await getAvailableToolSchemas();
    const capable = schemas.filter(isAsyncCapableSchema);
    assert.ok(capable.length > 0, 'expected at least one async-capable tool schema');
    const capableWithout = capable.filter((s) => !schemaHasAsyncParams(s)).map((s) => s.function?.name);
    const instantWith = schemas.filter((s) => !isAsyncCapableSchema(s) && schemaHasAsyncParams(s)).map((s) => s.function?.name);
    assert.deepEqual(capableWithout, [], 'async-capable schemas missing async params');
    assert.deepEqual(instantWith, [], 'instant schemas carrying async params');
  });

  it('grafts async params when asyncEnabled is explicitly true', async () => {
    const schemas = await getAvailableToolSchemas({ asyncEnabled: true });
    const withParams = schemas.filter(schemaHasAsyncParams).length;
    assert.ok(withParams > 0, 'expected at least one schema to have async params');
  });

  it('omits async params from every schema when asyncEnabled is false', async () => {
    const schemas = await getAvailableToolSchemas({ asyncEnabled: false });
    const offenders = schemas.filter(schemaHasAsyncParams);
    assert.equal(
      offenders.length,
      0,
      `expected zero schemas with async params, got ${offenders.length}: ${offenders.slice(0, 3).map((s) => s.function?.name).join(', ')}`,
    );
  });

  it('still returns the same number of schemas in both modes', async () => {
    const on = await getAvailableToolSchemas({ asyncEnabled: true });
    const off = await getAvailableToolSchemas({ asyncEnabled: false });
    assert.equal(on.length, off.length, 'tool count must not change with the toggle');
  });
});

describe('Async tools toggle — buildUnifiedSystemPrompt', () => {
  // Marker text from async-execution.js. If the file's first heading ever
  // changes, update this constant — it's the canonical signal that the
  // async-guidance block is present in the prompt.
  const ASYNC_BLOCK_MARKER = '# Async & Periodic Tool Execution';

  it('includes the async guidance when asyncToolsEnabled is true', async () => {
    const prompt = await buildUnifiedSystemPrompt(ASYNC_CAPABLE_SURFACE, { asyncToolsEnabled: true });
    assert.match(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('includes the async guidance by default (no option passed)', async () => {
    const prompt = await buildUnifiedSystemPrompt(ASYNC_CAPABLE_SURFACE, {});
    assert.match(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('omits the async guidance when asyncToolsEnabled is false', async () => {
    const prompt = await buildUnifiedSystemPrompt(ASYNC_CAPABLE_SURFACE, { asyncToolsEnabled: false });
    assert.doesNotMatch(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('still produces a non-empty prompt with the gate off', async () => {
    const prompt = await buildUnifiedSystemPrompt({}, { asyncToolsEnabled: false });
    assert.ok(prompt && prompt.length > 100, 'prompt must still contain other guidance');
  });

  it('leaks zero async control-param mentions into the prompt when off', async () => {
    // Belt-and-suspenders: confirm none of the 6 underscore async params
    // appear anywhere in the prompt when the gate is off, not just the top
    // marker. If a future prompt section starts mentioning these, the
    // toggle's "the LLM has no idea async exists" guarantee would silently
    // break — this test catches that.
    const prompt = await buildUnifiedSystemPrompt(ASYNC_CAPABLE_SURFACE, { asyncToolsEnabled: false });
    for (const param of ASYNC_PARAM_KEYS) {
      assert.doesNotMatch(
        prompt,
        new RegExp(param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `Async control param "${param}" should not appear in the prompt when async is disabled`,
      );
    }
  });
});

after(() => {
  // Tools.js transitively imports modules that boot the database and the
  // EmailReceiver / LocalWebhookReceiver pollers. Force exit so node --test
  // returns promptly after assertions finish; vitest already force-exits.
  setImmediate(() => process.exit(0));
});
