import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('./LlmService.js', () => ({ createLlmClient: vi.fn(async () => ({})) }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../orchestrator/tools.js', () => ({ executeTool: vi.fn(), getAvailableToolSchemas: vi.fn() }));
vi.mock('../../utils/contextManager.js', () => ({
  manageContext: vi.fn((messages) => ({ messages, managedTokens: 1 })),
  estimateToolTokens: vi.fn(() => 1),
}));
vi.mock('../execution/LedgerRecorder.js', () => ({ recordLlmCall: vi.fn(async () => {}) }));

import service from './LlmExecutionService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { executeTool, getAvailableToolSchemas } from '../orchestrator/tools.js';
import { manageContext } from '../../utils/contextManager.js';
// Category selection and provider compatibility are REAL modules in this suite.
const schema = (name, description = name) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } } });
const call = (name, args = {}) => ({ id: `${name}-${JSON.stringify(args)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const reply = (...toolCalls) => ({ responseMessage: { role: 'assistant', content: toolCalls.length ? null : 'Done', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, toolCalls });
const names = (schemas) => schemas.map((s) => s.function.name);
let tmp;


function adapterFor(responses) {
  const requests = [];
  const run = vi.fn(async (messages, schemas) => {
    // Snapshot: arrays are intentionally extended in place between rounds.
    requests.push({ schemas: structuredClone(schemas), messages: structuredClone(messages) });
    return responses.shift() || reply();
  });
  const adapter = { call: run, callStream: run, formatToolResults: (results) => results };
  createLlmAdapter.mockResolvedValue(adapter);
  return { requests, run };
}
function execute(mode, overrides = {}) {
  const config = { provider: 'openai', model: 'test', userId: 'owner-a', messages: [{ role: 'user', content: 'Discover then read.' }], toolSchemas: [schema('discover_tools')], maxToolRounds: 4, ...overrides };
  return mode === 'stream' ? service.executeWithToolsStreaming(config, vi.fn()) : service.executeWithTools(config);
}

beforeEach(async () => {
  vi.clearAllMocks();
  service.cacheEnabled = false;
  service.cache.clear();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-discovery-'));
  await fs.writeFile(path.join(tmp, 'fixture.txt'), 'ACTUAL_FIXTURE_BYTES');
  getAvailableToolSchemas.mockResolvedValue([schema('read_file'), schema('write_file'), schema('web_search')]);
  executeTool.mockImplementation(async (name, args, _auth, context) => {
    if (name === 'discover_tools') {
      context._requestedToolCategories ??= new Set();
      for (const category of args.categories || ['artifact_code']) context._requestedToolCategories.add(category);
      return JSON.stringify({ success: true, message: 'Tools will be available next response.' });
    }
    if (name === 'read_file') return fs.readFile(path.join(tmp, 'fixture.txt'), 'utf8');
    return JSON.stringify({ success: true });
  });
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe('discovery cancellation', () => {
  it('unblocks a paused goal during registry lookup without a follow-up model call', async () => {
    const controller = new AbortController();
    let finishLookup;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    getAvailableToolSchemas.mockImplementation(() => {
      entered();
      return new Promise((resolve) => { finishLookup = resolve; });
    });
    const { requests } = adapterFor([reply(call('discover_tools')), reply()]);
    const running = execute('non-stream', { signal: controller.signal });
    const rejected = expect(running).rejects.toThrow('paused');
    await started;
    controller.abort(new Error('paused'));
    await rejected;
    finishLookup([schema('read_file')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
  });
});

for (const mode of ['non-stream', 'stream']) describe(`${mode} dynamic tool loading`, () => {
  it('advertises and executes a newly discovered reader on the next call', async () => {
    const { requests } = adapterFor([reply(call('discover_tools')), reply(call('read_file')), reply()]);
    const result = await execute(mode);
    expect(names(requests[0].schemas)).toEqual(['discover_tools']);
    expect(names(requests[1].schemas)).toEqual(['discover_tools', 'read_file', 'write_file']);
    expect(result.toolExecutions.map((e) => e.name)).toEqual(['discover_tools', 'read_file']);
    expect(result.toolExecutions[1].response).toBe('ACTUAL_FIXTURE_BYTES');
    expect(getAvailableToolSchemas).toHaveBeenCalledExactlyOnceWith({ userId: 'owner-a', asyncEnabled: true });
    expect(names(manageContext.mock.calls[1][2])).toEqual(names(requests[1].schemas));
    const context = executeTool.mock.calls[1][3];
    expect(names(context.toolSchemas)).toEqual(names(requests[1].schemas));
    expect([...context._requestedToolCategories]).toEqual([]);
    expect([...context._loadedToolNames]).toEqual(['read_file', 'write_file']);
    expect([...context._loadedToolGroups]).toEqual(['artifact_code']);
  });

  it.each(['_toolCeiling', 'enabledTools'])('keeps discovery within %s', async (key) => {
    const { requests } = adapterFor([reply(call('discover_tools')), reply()]);
    await execute(mode, { context: { [key]: new Set(['discover_tools', 'read_file']) } });
    expect(names(requests[1].schemas)).toEqual(['discover_tools', 'read_file']);
    expect(executeTool.mock.calls[0][3]._loadedToolNames.has('write_file')).toBe(false);
  });

  it('honors an empty resolved ceiling over a wider fallback selection', async () => {
    const { requests } = adapterFor([reply(call('discover_tools')), reply()]);
    await execute(mode, { context: { _toolCeiling: new Set(), enabledTools: new Set(['read_file']) } });
    expect(names(requests[1].schemas)).toEqual(['discover_tools']);
  });

  it('appends without duplicates or replacing the initial schema/prefix', async () => {
    getAvailableToolSchemas.mockResolvedValue([schema('write_file'), schema('read_file', 'new version'), schema('write_file')]);
    const original = [schema('discover_tools'), schema('read_file', 'pinned version')];
    const context = { _pinnedToolNames: ['discover_tools', 'read_file'], _toolOrder: ['discover_tools', 'read_file'] };
    const { requests } = adapterFor([reply(call('discover_tools')), reply(call('discover_tools')), reply()]);
    await execute(mode, { toolSchemas: original, context });
    expect(names(requests[2].schemas)).toEqual(['discover_tools', 'read_file', 'write_file']);
    expect(requests[2].schemas[1].function.description).toBe('pinned version');
    expect(names(original)).toEqual(['discover_tools', 'read_file']);
    expect(executeTool.mock.calls[0][3]._toolOrder).toEqual(['discover_tools', 'read_file', 'write_file']);
    expect(context._toolOrder).toEqual(['discover_tools', 'read_file']);
    expect(context._pinnedToolNames).toEqual(['discover_tools', 'read_file']);
  });

  it('unions category requests from the same tool round', async () => {
    const { requests } = adapterFor([reply(call('discover_tools', { categories: ['artifact_code'] }), call('discover_tools', { categories: ['core'] })), reply()]);
    await execute(mode);
    expect(names(requests[1].schemas)).toEqual(['discover_tools', 'read_file', 'write_file', 'web_search']);
    expect(getAvailableToolSchemas).toHaveBeenCalledTimes(1);
  });

  it('uses user-scoped installed schemas and preserves async-disabled context', async () => {
    getAvailableToolSchemas.mockImplementation(async ({ userId }) => [schema(`custom_${userId}`)]);
    const { requests } = adapterFor([reply(call('discover_tools', { categories: ['installed'] })), reply()]);
    await execute(mode, { context: { asyncEnabled: false } });
    expect(names(requests[1].schemas)).toEqual(['discover_tools', 'custom_owner-a']);
    expect(getAvailableToolSchemas).toHaveBeenCalledWith({ userId: 'owner-a', asyncEnabled: false });
  });

  it('applies provider compatibility to newly loaded tools', async () => {
    getAvailableToolSchemas.mockResolvedValue([
      schema('mcp_client'), schema('mcp_client_alias'), schema('mcp__server__read'),
      { ...schema('bad_schema'), function: { ...schema('bad_schema').function, parameters: { type: 'object', properties: { 'invalid key': { type: 'string' } } } } },
    ]);
    const { requests } = adapterFor([reply(call('discover_tools', { categories: ['installed', 'core', 'mcp'] })), reply()]);
    await execute(mode, { provider: 'Claude-Code' });
    expect(names(requests[1].schemas)).toEqual(['discover_tools', 'mcp__server__read']);
    expect([...executeTool.mock.calls[0][3]._loadedToolNames]).toEqual(['mcp__server__read']);
  });

  it('does not look up the registry for ordinary turns or empty pending sets', async () => {
    adapterFor([reply(call('read_file')), reply()]);
    await execute(mode, { toolSchemas: [schema('read_file')], context: { _requestedToolCategories: new Set() } });
    expect(getAvailableToolSchemas).not.toHaveBeenCalled();
  });

  it('fails explicitly on registry failure, without another model call or loaded-state claim', async () => {
    getAvailableToolSchemas.mockRejectedValue(new Error('registry unavailable'));
    const { requests } = adapterFor([reply(call('discover_tools'))]);
    await expect(execute(mode)).rejects.toThrow('registry unavailable');
    expect(requests).toHaveLength(1);
    const context = executeTool.mock.calls[0][3];
    expect([...context._requestedToolCategories]).toEqual(['artifact_code']);
    expect(context._loadedToolGroups.size).toBe(0);
    expect(context._loadedToolNames.size).toBe(0);
  });

  it('ignores unknown categories and unnamed registry entries', async () => {
    getAvailableToolSchemas.mockResolvedValue([schema('read_file'), { type: 'function', function: {} }]);
    const { requests } = adapterFor([reply(call('discover_tools', { categories: ['not-a-category'] })), reply()]);
    await execute(mode);
    expect(names(requests[1].schemas)).toEqual(['discover_tools']);
  });

  it('isolates concurrent runs sharing a caller context, pending and loaded sets', async () => {
    const shared = { _requestedToolCategories: new Set(), _loadedToolGroups: new Set(['core']), _loadedToolNames: new Set(), _toolCeiling: new Set(['discover_tools', 'read_file', 'custom_owner-b']) };
    const observed = new Map();
    getAvailableToolSchemas.mockImplementation(async ({ userId }) => userId === 'owner-a' ? [schema('read_file')] : [schema('custom_owner-b')]);
    createLlmAdapter.mockImplementation(async (_p, _c, _m) => {
      let round = 0;
      const run = async (messages, schemas) => {
        const owner = messages.find((m) => m.role === 'user').content;
        observed.set(owner, names(schemas));
        return round++ === 0 ? reply(call('discover_tools', { categories: [owner === 'owner-a' ? 'artifact_code' : 'installed'] })) : reply();
      };
      return { call: run, callStream: run, formatToolResults: (x) => x };
    });
    await Promise.all(['owner-a', 'owner-b'].map((userId) => execute(mode, { userId, context: shared, messages: [{ role: 'user', content: userId }] })));
    expect(observed.get('owner-a')).toEqual(['discover_tools', 'read_file']);
    expect(observed.get('owner-b')).toEqual(['discover_tools', 'custom_owner-b']);
    expect([...shared._requestedToolCategories]).toEqual([]);
    expect([...shared._loadedToolGroups]).toEqual(['core']);
    expect([...shared._loadedToolNames]).toEqual([]);
  });
});
