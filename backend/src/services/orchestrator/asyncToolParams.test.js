// Two guards, because this block's cost is (size x eligible tools) and a fix
// to either term alone is not enough.
//
// The first pass here only shrank the descriptions: 193 -> 132 tokens per
// tool. Measured on a live DRY turn (31 resident tools) that was still 4,108
// raw / 5,957 calibrated tokens — 38% of the entire tool surface — because it
// was still stamped on `read_file`, `glob_files`, `highlight_element` and
// every other instant tool. Gating eligibility took the same turn to 925 raw /
// 1,341 calibrated. Both terms need a test or the cost comes back.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ASYNC_TOOL_PARAMS,
  ASYNC_TOOL_PARAMS_MAX_CHARS,
  LONG_RUNNING_TOOL_NAMES,
  isAsyncCapableSchema,
  surfaceHasAsyncCapableTool,
} from './asyncToolParams.js';

const serialized = JSON.stringify(ASYNC_TOOL_PARAMS);
const schema = (name, extra = {}) => ({
  type: 'function',
  function: { name, parameters: { type: 'object', properties: {} } },
  ...extra,
});

describe('TERM 1 — the block stays small', () => {
  it('serializes under the per-tool budget', () => {
    expect(serialized.length).toBeLessThanOrEqual(ASYNC_TOOL_PARAMS_MAX_CHARS);
  });

  it('the budget is tight enough to catch real regrowth', () => {
    // A budget far above the actual size is not a guard, it is decoration.
    expect(ASYNC_TOOL_PARAMS_MAX_CHARS).toBeLessThan(serialized.length * 1.5);
  });

  it('no description reads like prose', () => {
    for (const [name, spec] of Object.entries(ASYNC_TOOL_PARAMS)) {
      expect(spec.description, `${name} has no description`).toBeTruthy();
      expect(spec.description.length, `${name} description is too long`).toBeLessThan(60);
    }
  });

  it('still declares every parameter the orchestrator acts on', () => {
    // Shrinking descriptions must never shrink the SURFACE.
    expect(Object.keys(ASYNC_TOOL_PARAMS).sort()).toEqual([
      '_delayFirst', '_duration', '_estimatedMinutes', '_executeAsync', '_interval', '_stopAfter',
    ]);
    for (const spec of Object.values(ASYNC_TOOL_PARAMS)) {
      expect(['boolean', 'number', 'integer']).toContain(spec.type);
    }
  });

  it('keeps the units, which are the one thing not inferable from the name', () => {
    // seconds-vs-minutes is a 60x error that produces a task running an hour
    // late rather than an obvious failure.
    expect(ASYNC_TOOL_PARAMS._interval.description).toMatch(/SECONDS/);
    expect(ASYNC_TOOL_PARAMS._duration.description).toMatch(/MINUTES/);
  });
});

describe('TERM 2 — only long-running tools carry it', () => {
  it('instant read-only tools are not eligible', () => {
    for (const name of ['read_file', 'list_files', 'glob_files', 'grep_files',
      'highlight_element', 'scan_page_elements', 'query_data', 'label', 'counter']) {
      expect(isAsyncCapableSchema(schema(name)), `${name} should be instant`).toBe(false);
    }
  });

  it('genuinely long-running tools are eligible', () => {
    for (const name of ['execute_shell_command', 'web_scrape', 'generate_image',
      'send_email', 'create_and_run_goal', 'run_agent']) {
      expect(isAsyncCapableSchema(schema(name)), `${name} should be async-capable`).toBe(true);
    }
  });

  it('plugins opt in via longRunning on either the schema or the function', () => {
    expect(isAsyncCapableSchema(schema('some_plugin_tool'))).toBe(false);
    expect(isAsyncCapableSchema(schema('some_plugin_tool', { longRunning: true }))).toBe(true);
    const fnFlag = schema('other_plugin_tool');
    fnFlag.function.longRunning = true;
    expect(isAsyncCapableSchema(fnFlag)).toBe(true);
  });

  it('defaults to OFF so a growing registry cannot re-inflate the cost', () => {
    // The expensive case must be declared, never assumed.
    expect(isAsyncCapableSchema(schema('brand_new_unknown_tool'))).toBe(false);
    expect(isAsyncCapableSchema({})).toBe(false);
    expect(isAsyncCapableSchema(null)).toBe(false);
  });

  it('surfaceHasAsyncCapableTool detects a mixed surface', () => {
    expect(surfaceHasAsyncCapableTool([schema('read_file'), schema('list_files')])).toBe(false);
    expect(surfaceHasAsyncCapableTool([schema('read_file'), schema('web_search')])).toBe(true);
    expect(surfaceHasAsyncCapableTool([])).toBe(false);
  });

  it('the long-running list is a meaningful minority, not everything', () => {
    // Anti-vacuity: a list that grew to include every tool would pass all the
    // eligibility tests above while restoring the original cost.
    expect(LONG_RUNNING_TOOL_NAMES.size).toBeGreaterThan(10);
    expect(LONG_RUNNING_TOOL_NAMES.size).toBeLessThan(60);
  });
});

describe('gating is documentation-only — capability is preserved', () => {
  const ORCH = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OrchestratorService.js'),
    'utf8',
  );

  it('the dispatcher reads _executeAsync off raw args, not off the schema', () => {
    // This is WHY omitting the params is safe. If dispatch ever started
    // consulting the schema, gating would silently remove a capability.
    expect(ORCH).toMatch(/const llmRequestedAsync = functionArgs\._executeAsync === true/);
  });

  it('the prompt tells the model the params work on every tool', () => {
    const guidance = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'system-prompts', 'async-execution.js'),
      'utf8',
    );
    expect(guidance).toMatch(/work on every\s*\n?\s*tool, including ones whose schema does not list them/);
  });

  it('injectAsyncParams consults the eligibility predicate', () => {
    const tools = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools.js'),
      'utf8',
    );
    const fn = tools.slice(tools.indexOf('function injectAsyncParams'), tools.indexOf('function injectAsyncParams') + 700);
    expect(fn).toMatch(/if \(!isAsyncCapableSchema\(schema\)\) return schema;/);
    expect(fn).not.toMatch(/if \(false/);
  });
});
