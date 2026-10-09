import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiLikeAdapter } from './chatCompletions.js';
import { createLocalThinkingParser } from './localThinking.js';
import { buildProviderChain, runWithFallback } from '../ProviderFallback.js';
import { localContextError } from '../../localModels/inference.js';
const mocks = vi.hoisted(() => ({ preflight: vi.fn(async () => {}) }));
vi.mock('../../localModels/index.js', () => ({ localInference: { preflight: mocks.preflight } }));

const input = ' \n<think>private reasoning</think>Visible answer';
beforeEach(() => {
  mocks.preflight.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('local thinking separation', () => {
  it.each(Array.from({ length: input.length + 1 }, (_, index) => index))('handles a stream split at byte %s', (split) => {
    const parser = createLocalThinkingParser();
    const parts = [parser.push(input.slice(0, split)), parser.push(input.slice(split)), parser.push('', true)];
    expect(parts.map((part) => part.content).join('')).toBe('Visible answer');
    expect(parts.map((part) => part.reasoning).join('')).toBe('private reasoning');
  });
  it('handles single-character chunks, unfinished blocks, and literal tags in the answer', () => {
    const parser = createLocalThinkingParser();
    const parts = [...input].map((chunk) => parser.push(chunk));
    parts.push(parser.push('', true));
    expect(parts.map((part) => part.content).join('')).toBe('Visible answer');
    expect(createLocalThinkingParser().push('<think>unfinished', true)).toEqual({ content: '', reasoning: 'unfinished' });
    expect(createLocalThinkingParser().push('Use <think> as a literal.', true).content).toBe('Use <think> as a literal.');
  });
});

const messages = [{ role: 'user', content: 'Hello' }];
function adapter(create, provider = 'local') {
  return new OpenAiLikeAdapter({ chat: { completions: { create } } }, 'qwen3.5-4b', { provider });
}
function stream(chunks) {
  return (async function* () {
    for (const content of chunks) yield { choices: [{ delta: { content } }] };
    yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } };
  })();
}

describe('local transport boundaries', () => {
  it('preflights streaming requests and never sends thinking as visible deltas', async () => {
    const create = vi.fn(async () => stream(['<thi', 'nk>hidden</thi', 'nk>Answer']));
    const chunks = [];
    const result = await adapter(create).callStream(messages, [], (chunk) => chunks.push(chunk), {});
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(result.responseMessage.content).toBe('Answer');
    expect(chunks.filter((chunk) => chunk.type === 'content').map((chunk) => chunk.delta).join('')).toBe('Answer');
    expect(chunks.filter((chunk) => chunk.type === 'reasoning').map((chunk) => chunk.delta).join('')).toBe('hidden');
  });
  it('does not promote reasoning-only local output to an answer', async () => {
    const result = await adapter(vi.fn(async () => stream(['<think>unfinished private thoughts']))).callStream(messages, [], null, {});
    expect(result.responseMessage.content).not.toContain('private thoughts');
    expect(result.recoveredFromError).toBe(true);
  });
  it('cleans non-streaming replies and preserves tool calls', async () => {
    const calls = [{ id: 't', type: 'function', function: { name: 'read_file', arguments: '{}' } }];
    const create = vi.fn(async () => ({ choices: [{ message: { role: 'assistant', content: '<think>hidden</think>Answer', tool_calls: calls } }] }));
    const result = await adapter(create).call(messages, []);
    expect(result.responseMessage.content).toBe('Answer');
    expect(result.toolCalls).toEqual(calls);
    expect(mocks.preflight).toHaveBeenCalledOnce();
  });
  it.each(['call', 'callStream'])('rejects overflow before calling the inference endpoint (%s)', async (method) => {
    mocks.preflight.mockRejectedValue(localContextError('4096 tokens loaded.'));
    const create = vi.fn();
    await expect(adapter(create)[method](messages, [])).rejects.toMatchObject({ code: 'LOCAL_CONTEXT_LIMIT' });
    expect(create).not.toHaveBeenCalled();
  });
  it('reports actual server overflow without the misleading 8K advice or retries', async () => {
    const create = vi.fn(async () => { throw new Error('n_keep exceeds context size'); });
    await expect(adapter(create).callStream(messages, [])).rejects.toThrow('No cloud fallback');
    expect(create).toHaveBeenCalledOnce();
  });
  it('does not preflight or reinterpret tags for cloud models', async () => {
    const result = await adapter(vi.fn(async () => stream(['<think>literal cloud output</think>'])), 'openai').callStream(messages, [], null, {});
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(result.responseMessage.content).toBe('<think>literal cloud output</think>');
  });
});

describe('local stays local', () => {
  it.each(['local', 'lm-studio', 'ollama'])('never builds cloud fallback tiers for %s', (provider) => {
    expect(buildProviderChain({ provider, model: 'test', fallbackEnabled: true, fallbackProviders: [{ provider: 'openai', model: 'gpt-4o' }] })).toHaveLength(1);
  });
  it('also guards composed chains against overflow and infrastructure failure', async () => {
    const chain = [{ provider: 'local', model: 'qwen' }, { provider: 'openai', model: 'gpt-4o' }];
    const runOne = vi.fn(async () => { throw Object.assign(new Error('offline'), { status: 503 }); });
    const outcome = await runWithFallback({ chain, runOne });
    expect(outcome.result).toMatchObject({ recoveredFromError: true, recoveredError: 'offline' });
    expect(runOne).toHaveBeenCalledOnce();
    expect(runOne.mock.calls[0][0].provider).toBe('local');
  });
});
