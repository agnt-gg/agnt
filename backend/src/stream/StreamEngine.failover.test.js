import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Generators keep the caller's model first and fail over to the account chain.
 * The chain itself is ModelRouter.resolveChain's job (tested there); this pins
 * how StreamEngine walks it.
 */

const createLlmClient = vi.fn();
vi.mock('../services/ai/LlmService.js', () => ({ createLlmClient: (...args) => createLlmClient(...args) }));
vi.mock('../services/ai/RagService.js', () => ({
  default: { search: vi.fn().mockResolvedValue([]), addDocuments: vi.fn().mockResolvedValue(undefined) },
}));

let chainFor = () => [];
const resolveChainCalls = [];
vi.mock('../services/ai/ModelRouter.js', () => ({
  resolveChain: async (args) => {
    resolveChainCalls.push(args);
    return { chain: chainFor(args) };
  },
}));

const recorded = [];
vi.mock('../services/execution/LedgerRecorder.js', () => ({
  recordLlmCall: async (row) => { recorded.push(row); return 'row'; },
}));

const { default: StreamEngine } = await import('./StreamEngine.js');
const { providerHealth } = await import('../services/ai/providerHealth.js');

function openAiLike(textOrError) {
  const create = textOrError instanceof Error
    ? vi.fn().mockRejectedValue(textOrError)
    : vi.fn().mockResolvedValue({
      choices: [{ message: { content: textOrError, role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  return { chat: { completions: { create } } };
}

const TOOL = JSON.stringify({ name: 'demo_tool', fields: [] });
const tier = (provider, model, source, i) => ({ provider, model, source, tier: i, primary: i === 0 });

beforeEach(() => {
  createLlmClient.mockReset();
  resolveChainCalls.length = 0;
  recorded.length = 0;
  providerHealth.reset();
});

describe('StreamEngine generators — failover across the account chain', () => {
  it('asks for the requested pair first, unrouted, as a generator', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0)];
    createLlmClient.mockResolvedValue(openAiLike(TOOL));
    await new StreamEngine('u1').generateTool('x', 'groq', 'm1');
    expect(resolveChainCalls[0]).toMatchObject({ userId: 'u1', origin: 'generator', requested: { provider: 'groq', model: 'm1' }, routing: 'never' });
  });

  it('a failing first pick rolls over to the account default', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => (provider === 'groq' ? openAiLike(new Error('upstream 500')) : openAiLike(TOOL)));
    const out = await new StreamEngine('u1').generateTool('x', 'groq', 'm1');
    expect(out.template).toContain('demo_tool');
    expect(recorded.map((r) => [r.provider, r.status, r.origin])).toEqual([['groq', 'error', 'generator'], ['deepseek', 'ok', 'generator']]);
  });

  it('an answer that is not JSON rolls over; if none parse, the first answer is returned as before', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => openAiLike(provider === 'groq' ? 'not json' : TOOL));
    expect((await new StreamEngine('u1').generateTool('x', 'groq', 'm1')).template).toContain('demo_tool');

    createLlmClient.mockImplementation(async (provider) => openAiLike(provider === 'groq' ? 'first prose' : 'second prose'));
    expect((await new StreamEngine('u1').generateAgent({ overview: 'x', currentAgent: '{}' }, 'groq', 'm1')).agent).toBe('first prose');
  });

  it('when every pick fails, the FIRST pick\'s own error is thrown', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => (provider === 'groq' ? null : openAiLike(new Error('also down'))));
    await expect(new StreamEngine('u1').generateTool('x', 'groq', 'm1')).rejects.toThrow(/groq is not supported/);
  });

  it('nothing configured is reported as exactly that', async () => {
    chainFor = () => [];
    await expect(new StreamEngine('u1').generateTool('x', undefined, undefined)).rejects.toMatchObject({ code: 'NO_AI_CONFIGURED' });
  });
});
