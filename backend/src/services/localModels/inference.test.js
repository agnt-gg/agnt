import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalInference, isLocalProvider, getLocalToolBudget, assertLocalInstructionsPreserved } from './inference.js';
import { getContextBudget, estimateToolTokens, manageContext } from '../../utils/contextManager.js';
import { capToolsToBudget } from '../orchestrator/toolSelector.js';

const model = 'qwen/qwen3.5-9b';
const baseURL = 'http://127.0.0.1:54321/v1';
const messages = [{ role: 'system', content: 'Be helpful.' }, { role: 'user', content: 'Hello' }];
const tool = (name, size = 500) => ({ type: 'function', function: { name, description: 'operation '.repeat(size), parameters: { type: 'object', properties: {} } } });
function server(routes) {
  const fetchImpl = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    const value = routes[path];
    if (value instanceof Error) throw value;
    const body = typeof value === 'function' ? value(options) : value;
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
  });
  return { inference: createLocalInference({ resolve: vi.fn(async () => baseURL), fetchImpl }), fetchImpl };
}
afterEach(() => vi.restoreAllMocks());

describe('local loaded context discovery', () => {
  it('uses per-slot llama.cpp context, not the catalog maximum or total n_ctx', async () => {
    const { inference } = server({ '/props': { n_ctx: 131072, default_generation_settings: { n_ctx: 32768 } } });
    expect(await inference.inspect(model)).toMatchObject({ contextWindow: 32768, tokenizer: true, outputBuffer: 4096 });
  });
  it('reads the LM Studio loaded instance, not its architecture limit', async () => {
    const { inference } = server({ '/props': { error: 'Unexpected endpoint' }, '/api/v1/models': {
      models: [{ key: 'disk/model', max_context_length: 262144, loaded_instances: [{ id: model, config: { context_length: 65536 } }] }],
    } });
    expect(await inference.inspect(model)).toMatchObject({ contextWindow: 65536, tokenizer: false });
  });
  it('supports older LM Studio, including its HTTP-200 unsupported endpoints', async () => {
    const { inference } = server({ '/props': { error: 'Unexpected endpoint' }, '/api/v0/models': {
      data: [{ id: 'other', state: 'loaded', loaded_context_length: 99999 }, { id: model, state: 'loaded', max_context_length: 262144, loaded_context_length: 4096 }],
    } });
    expect(await inference.inspect(model)).toMatchObject({ contextWindow: 4096, outputBuffer: 512 });
  });
  it('reads Ollama running context, including default :latest ids', async () => {
    const { inference } = server({ '/api/ps': { models: [{ name: `${model}:latest`, context_length: 16384 }] } });
    expect(await inference.inspect(model)).toMatchObject({ contextWindow: 16384 });
  });
  it.each([null, 0, -1, 1.5, 262144.1, '65536'])('rejects an unknown/invalid loaded capacity (%s)', async (contextWindow) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { inference } = server({ '/props': { default_generation_settings: { n_ctx: contextWindow } } });
    await expect(inference.inspect(model)).rejects.toMatchObject({ code: 'LOCAL_CONTEXT_LIMIT' });
  });
  it('does not substitute an unloaded model maximum or another model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { inference } = server({ '/api/v0/models': { data: [{ id: model, state: 'not-loaded', max_context_length: 262144 }] } });
    await expect(inference.inspect(model)).rejects.toThrow('No cloud fallback');
  });
  it('refreshes the loaded window each request after a runtime reload', async () => {
    let context = 65536;
    const { inference } = server({ '/props': () => ({ default_generation_settings: { n_ctx: context } }) });
    expect((await inference.inspect(model)).contextWindow).toBe(65536);
    context = 4096;
    expect((await inference.inspect(model)).contextWindow).toBe(4096);
  });
});

describe('local token accounting and strict budgets', () => {
  it('uses the chat template including tools, measures calibration and bounds output', async () => {
    const tools = [tool('search', 1)];
    const { inference, fetchImpl } = server({
      '/props': { default_generation_settings: { n_ctx: 8192 } },
      '/apply-template': (options) => { expect(JSON.parse(options.body).tools).toEqual(tools); return { prompt: 'expanded template' }; },
      '/tokenize': (options) => { expect(JSON.parse(options.body)).toEqual({ content: 'expanded template', add_special: true, parse_special: true }); return { tokens: Array(300).fill(1) }; },
    });
    const measured = await inference.measure(model, messages, tools);
    expect(measured.calibration).toBeGreaterThan(1);
    const request = { model, messages, tools, max_tokens: 100000 };
    await inference.preflight(model, request);
    expect(request.max_tokens).toBe(1024);
    expect(fetchImpl).toHaveBeenCalled();
  });
  it('rejects a tokenized request before generation even though the catalog says 262K', async () => {
    const { inference } = server({ '/props': { default_generation_settings: { n_ctx: 4096 } }, '/apply-template': { prompt: 'expanded' }, '/tokenize': { tokens: Array(4000).fill(1) } });
    await expect(inference.preflight(model, { messages })).rejects.toThrow('4000 input tokens');
  });
  it('fails closed if the promised tokenizer is broken', async () => {
    const { inference } = server({ '/props': { default_generation_settings: { n_ctx: 65536 } }, '/apply-template': { prompt: 42 } });
    await expect(inference.preflight(model, { messages })).rejects.toThrow('usable chat template');
  });
  it('labels the conservative estimate when no tokenizer exists', async () => {
    const { inference } = server({ '/api/ps': { models: [{ name: model, context_length: 4096 }] } });
    await expect(inference.preflight(model, { messages: [{ role: 'user', content: 'big request '.repeat(3000) }] })).rejects.toThrow('an estimated');
  });
  it('overrides the catalog only for this request and keeps telemetry in loaded-window units', () => {
    const before = getContextBudget(model, 'local');
    const profile = { contextWindow: 4096, outputBuffer: 512, calibration: 3 };
    expect(getContextBudget(model, 'local', profile).contextWindow).toBe(4096);
    const result = manageContext(messages, model, [], 'local', profile);
    expect(result.contextWindow).toBe(4096);
    expect(result.outputBufferTokens).toBe(512);
    expect(getContextBudget(model, 'local')).toEqual(before);
  });
  it('rejects truncated system instructions or the current user request, not ordinary history eviction', () => {
    const full = [messages[0], { role: 'user', content: 'old history' }, messages[1]];
    expect(() => assertLocalInstructionsPreserved(full, messages)).not.toThrow();
    expect(() => assertLocalInstructionsPreserved(full, [messages[1]])).toThrow('without truncation');
    expect(() => assertLocalInstructionsPreserved(full, [messages[0], { role: 'user', content: 'Hel...' }])).toThrow('without truncation');
  });
  it('reserves a long current request before admitting optional tools', () => {
    const profile = { contextWindow: 65536, outputBuffer: 4096, calibration: 3 };
    const shortBudget = getLocalToolBudget(model, profile, messages);
    const longBudget = getLocalToolBudget(model, profile, [{ role: 'system', content: 'Be helpful.' }, { role: 'user', content: 'current request '.repeat(4000) }]);
    expect(longBudget).toBeLessThan(shortBudget);
    expect(longBudget).toBeGreaterThanOrEqual(0);
  });
  it('never force-adds a default, loaded tool or pinned tool beyond local capacity', () => {
    const schemas = [tool('discover_tools', 1), tool('web_search'), tool('write_file'), tool('oversized')];
    const budget = estimateToolTokens([schemas[0]]) + 5;
    const capped = capToolsToBudget(schemas, { budgetTokens: budget, hardTokenLimit: true, pinnedNames: ['oversized'], loadedToolNames: new Set(['write_file']) });
    expect(capped.schemas.map((entry) => entry.function.name)).toEqual(['discover_tools']);
    expect(capped.toolTokens).toBeLessThanOrEqual(budget);
    expect(capToolsToBudget(schemas, { budgetTokens: 0, hardTokenLimit: true }).schemas).toEqual([]);
  });
  it('lets newly discovered tools displace old pins within the hard token cap', () => {
    const schemas = ['discover_tools', 'old', 'new'].map((name) => tool(name, 1));
    const budget = estimateToolTokens(schemas.slice(0, 2)) + 5;
    const capped = capToolsToBudget(schemas, { budgetTokens: budget, hardTokenLimit: true, pinnedNames: ['old'], loadedToolNames: new Set(['new']) });
    expect(capped.schemas.map((entry) => entry.function.name)).toEqual(['discover_tools', 'new']);
  });
  it.each(['local', 'Local', 'lm-studio', 'ollama'])('recognizes %s as local', (provider) => expect(isLocalProvider(provider)).toBe(true));
});
