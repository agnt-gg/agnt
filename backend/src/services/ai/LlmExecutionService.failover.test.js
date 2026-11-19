/**
 * Goal tasks and delegated agents run through executeWithTools. Given a
 * provider chain, a tier that cannot answer rolls to the next one, as chat
 * turns and every routed background call already do. Without one, a goal
 * task whose agent was pinned to a model the account cannot use failed on
 * every run, with the account's working default never tried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./LlmService.js', () => ({ createLlmClient: vi.fn(async (provider) => ({ provider })) }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../orchestrator/tools.js', () => ({ executeTool: vi.fn(async () => 'tool output'), getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('../../utils/contextManager.js', () => ({ manageContext: vi.fn((messages) => ({ messages })), estimateToolTokens: () => 1 }));
vi.mock('../execution/LedgerRecorder.js', () => ({ recordLlmCall: vi.fn(async () => {}) }));

const { default: service } = await import('./LlmExecutionService.js');
const { createLlmClient } = await import('./LlmService.js');
const { createLlmAdapter } = await import('../orchestrator/llmAdapters.js');
const { executeTool } = await import('../orchestrator/tools.js');
const { recordLlmCall } = await import('../execution/LedgerRecorder.js');
const { providerHealth } = await import('./providerHealth.js');
const { GoalCancelledError } = await import('../../utils/abortUtils.js');

// The 400 a ChatGPT-account Codex login returns for a model outside its plan.
const UNSUPPORTED = "Codex Responses API Error: 400 The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.";
const notice = (error) => ({ responseMessage: { role: 'assistant', content: `⚠️ ${error}` }, toolCalls: [], recoveredFromError: true, recoveredError: error });
const answer = (content) => ({ responseMessage: { role: 'assistant', content }, toolCalls: [], usage: { prompt_tokens: 3, completion_tokens: 2 } });
const toolCall = { id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"ai news"}' } };
const wantsTool = { responseMessage: { role: 'assistant', content: null, tool_calls: [toolCall] }, toolCalls: [toolCall] };

const PIN = { provider: 'openai-codex', model: 'gpt-6-astra' };
const DEFAULT = { provider: 'claude-code', model: 'claude-opus-5-5' };
const BACKUP = { provider: 'gemini', model: 'gemini-2.5-pro' };

let behaviour;
let calls;

beforeEach(() => {
  vi.clearAllMocks();
  createLlmClient.mockImplementation(async (provider) => ({ provider }));
  service.cacheEnabled = false;
  providerHealth.reset?.();
  calls = [];
  behaviour = {};
  createLlmAdapter.mockImplementation(async (provider, client, model) => ({
    call: vi.fn(async (messages, tools) => {
      calls.push({ provider, model, tools: tools.map((t) => t.function.name) });
      const next = behaviour[provider];
      return typeof next === 'function' ? next() : next;
    }),
    formatToolResults: vi.fn((results) => results.map((r) => ({ ...r, formattedBy: provider }))),
  }));
});

const run = (overrides = {}) => service.executeWithTools({
  ...PIN,
  userId: 'u1',
  messages: [{ role: 'user', content: 'Find this week\'s AI news.' }],
  toolSchemas: [{ type: 'function', function: { name: 'web_search' } }],
  providerChain: [PIN, DEFAULT, BACKUP],
  ...overrides,
});

describe('executeWithTools with a provider chain', () => {
  it('Given the pinned model is refused, Then the account default answers and is reported as the serving model', async () => {
    behaviour = { 'openai-codex': notice(UNSUPPORTED), 'claude-code': answer('Five stories, ranked.') };
    const result = await run();
    expect(result.content).toBe('Five stories, ranked.');
    expect(result.recoveredFromError).toBeUndefined();
    expect(result).toMatchObject({ provider: 'claude-code', model: 'claude-opus-5-5' });
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex', 'claude-code']);
    expect(recordLlmCall).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude-code', model: 'claude-opus-5-5' }));
  });

  it('Given a tier answered, Then the rest of the execution stays on it and the refused pin is not retried', async () => {
    let claudeCalls = 0;
    behaviour = {
      'openai-codex': notice(UNSUPPORTED),
      'claude-code': () => (claudeCalls++ === 0 ? wantsTool : answer('Done.')),
    };
    const result = await run();
    expect(result.content).toBe('Done.');
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex', 'claude-code', 'claude-code']);
    expect(executeTool).toHaveBeenCalledTimes(1);
    // The tool call came from claude-code, so its adapter formats the results.
    expect(result.messages.some((m) => m.formattedBy === 'claude-code')).toBe(true);
    // Tools read the serving tier's client and model from the context.
    expect(executeTool.mock.calls[0][3]).toMatchObject({ provider: 'claude-code', model: 'claude-opus-5-5', llmClient: { provider: 'claude-code' } });
  });

  it('Given the serving tier fails mid-run, Then the next tier continues the same conversation', async () => {
    behaviour = {
      'openai-codex': () => wantsTool,
      'claude-code': answer('Finished on the backup.'),
    };
    let codexCalls = 0;
    behaviour['openai-codex'] = () => (codexCalls++ === 0 ? wantsTool : notice('529 overloaded'));
    const result = await run();
    expect(result.content).toBe('Finished on the backup.');
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex', 'openai-codex', 'claude-code']);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('Given every tier fails, Then the last error notice is the answer, flagged', async () => {
    behaviour = { 'openai-codex': notice(UNSUPPORTED), 'claude-code': notice('401 unauthorized'), gemini: notice('429 rate limit') };
    const result = await run();
    expect(result).toMatchObject({ recoveredFromError: true, recoveredError: '429 rate limit' });
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex', 'claude-code', 'gemini']);
  });

  it('Given a tier cannot even be built, Then the next tier answers', async () => {
    createLlmClient.mockImplementationOnce(async () => { throw new Error('No credentials for openai-codex'); });
    behaviour = { 'claude-code': answer('Built and answered.') };
    expect((await run()).content).toBe('Built and answered.');
  });

  it('Given every tier throws, Then the error is thrown as a single tier\'s would be', async () => {
    createLlmClient.mockImplementation(async (provider) => { throw new Error(`No credentials for ${provider}`); });
    await expect(run()).rejects.toThrow('No credentials for gemini');
  });

  it('Given the goal is paused during a call, Then the pause propagates and no other tier is tried', async () => {
    const controller = new AbortController();
    behaviour = { 'openai-codex': () => { controller.abort(new GoalCancelledError('g1', 'paused')); return new Promise(() => {}); } };
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: 'GoalCancelledError' });
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex']);
  });

  it('Given a tool one tier refuses, Then it is withheld from every tier so a failover never sends it', async () => {
    behaviour = { 'openai-codex': notice(UNSUPPORTED), 'claude-code': answer('ok') };
    await run({ toolSchemas: [{ type: 'function', function: { name: 'web_search' } }, { type: 'function', function: { name: 'mcp_client' } }] });
    expect(calls.map((c) => c.tools)).toEqual([['web_search'], ['web_search']]);
  });
});

describe('executeWithTools without a chain', () => {
  it('Given only a provider and model, Then that one model is called and its error notice is the answer', async () => {
    behaviour = { 'openai-codex': notice(UNSUPPORTED) };
    const result = await run({ providerChain: undefined });
    expect(result).toMatchObject({ recoveredFromError: true, recoveredError: UNSUPPORTED, provider: 'openai-codex' });
    expect(calls.map((c) => c.provider)).toEqual(['openai-codex']);
  });

  it('Given the one client cannot be built, Then its error is thrown', async () => {
    createLlmClient.mockImplementationOnce(async () => { throw new Error('No credentials for openai-codex'); });
    await expect(run({ providerChain: undefined })).rejects.toThrow('No credentials for openai-codex');
  });
});
