/**
 * Unit tests for the per-user "Async tool execution" toggle.
 *
 * Two surfaces are gated by the same flag:
 *   1. Tool schemas — getAvailableToolSchemas({ asyncEnabled }) decides
 *      whether to graft the universal _executeAsync / _interval / etc.
 *      properties onto async-capable tools. With the flag false the LLM never
 *      sees these params and can't request async execution.
 *   2. System prompt — buildUnifiedSystemPrompt only pushes the
 *      ASYNC_EXECUTION_GUIDANCE block when the flag is true and the current
 *      tool surface contains an async-capable tool. With either gate false the
 *      optional guidance block is absent.
 *
 * Both pieces are required; either one alone leaves a stale signal that
 * undermines the gate. These tests lock the contract down.
 *
 * Run: npm test  (vitest run)
 *   or: node --test tests/unit/asyncToolsToggle.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let getAvailableToolSchemas;
let buildUnifiedSystemPrompt;
let ASYNC_EXECUTION_GUIDANCE;
let processManager;
const importedIntervals = [];
const realSetInterval = globalThis.setInterval;

before(async () => {
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    importedIntervals.push(handle);
    return handle;
  };
  ({ getAvailableToolSchemas } = await import('../../backend/src/services/orchestrator/tools.js'));
  ({ buildUnifiedSystemPrompt } = await import('../../backend/src/services/orchestrator/system-prompts/buildUnifiedPrompt.js'));
  ({ ASYNC_EXECUTION_GUIDANCE } = await import('../../backend/src/services/orchestrator/system-prompts/async-execution.js'));
  ({ default: processManager } = await import('../../backend/src/workflow/ProcessManager.js'));
});

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

function asyncParamNames(schema) {
  const props = schema?.function?.parameters?.properties || {};
  return ASYNC_PARAM_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(props, k));
}

function schemaByName(schemas, name) {
  const schema = schemas.find((candidate) => candidate?.function?.name === name);
  assert.ok(schema, `expected schema ${name} to be available`);
  return schema;
}

describe('Async tools toggle — getAvailableToolSchemas', () => {
  it('selectively grafts async params by default (asyncEnabled defaults true)', async () => {
    const defaults = await getAvailableToolSchemas();
    const explicitOn = await getAvailableToolSchemas({ asyncEnabled: true });
    assert.ok(defaults.length > 0, 'expected at least one tool schema');

    const defaultEnabled = defaults.filter(schemaHasAsyncParams);
    const explicitEnabled = explicitOn.filter(schemaHasAsyncParams);
    assert.ok(defaultEnabled.length > 0, 'expected at least one async-capable schema');
    assert.ok(
      defaultEnabled.length < defaults.length,
      'selective injection must leave instant/unknown schemas without async params',
    );
    assert.deepEqual(
      defaultEnabled.map((schema) => schema.function.name),
      explicitEnabled.map((schema) => schema.function.name),
      'the default must match explicit asyncEnabled=true selection',
    );
    assert.deepEqual(
      asyncParamNames(schemaByName(defaults, 'execute_shell_command')),
      ASYNC_PARAM_KEYS,
      'a known long-running tool must receive the complete async parameter set',
    );
    assert.deepEqual(
      asyncParamNames(schemaByName(defaults, 'read_file')),
      [],
      'a known instant tool must not receive async parameters',
    );
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
  const asyncCapableContext = {
    toolSchemas: [{
      type: 'function',
      function: {
        name: 'execute_shell_command',
        parameters: { type: 'object', properties: {} },
      },
    }],
  };

  it('includes the async guidance when asyncToolsEnabled is true', async () => {
    const prompt = await buildUnifiedSystemPrompt(asyncCapableContext, { asyncToolsEnabled: true });
    assert.match(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('includes the async guidance by default (no option passed)', async () => {
    const prompt = await buildUnifiedSystemPrompt(asyncCapableContext, {});
    assert.match(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('omits the async guidance when asyncToolsEnabled is false', async () => {
    const prompt = await buildUnifiedSystemPrompt(asyncCapableContext, { asyncToolsEnabled: false });
    assert.doesNotMatch(prompt, new RegExp(ASYNC_BLOCK_MARKER));
  });

  it('still produces a non-empty prompt with the gate off', async () => {
    const prompt = await buildUnifiedSystemPrompt(asyncCapableContext, { asyncToolsEnabled: false });
    assert.ok(prompt && prompt.length > 100, 'prompt must still contain other guidance');
  });

  it('omits the complete optional async guidance block when off', async () => {
    const prompt = await buildUnifiedSystemPrompt(asyncCapableContext, { asyncToolsEnabled: false });
    assert.equal(
      prompt.includes(ASYNC_EXECUTION_GUIDANCE),
      false,
      'the gated async guidance block must not remain in the prompt when disabled',
    );
  });
});

after(async () => {
  // Release only resources created by this fixture's import graph. Some
  // imported singletons do not retain or expose their cleanup interval, so
  // the before hook records those handles without changing production code.
  globalThis.setInterval = realSetInterval;
  assert.ok(importedIntervals.length > 0, 'expected to capture at least one imported poller');
  for (const interval of importedIntervals) clearInterval(interval);
  processManager.EmailReceiver.stopPolling();
  processManager.WebhookReceiver.shutdown();
});
