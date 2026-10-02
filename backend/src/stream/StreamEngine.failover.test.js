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

describe('StreamEngine.startStream — failover before the first token', () => {
  function sseRes() {
    const out = { chunks: [], ended: false, statusCode: null };
    return {
      out,
      headersSent: true,
      setHeader: () => {},
      flushHeaders: () => {},
      write: (chunk) => { out.chunks.push(String(chunk)); return true; },
      end: () => { out.ended = true; },
      status(code) { out.statusCode = code; return this; },
      send: (body) => { out.chunks.push(String(body)); out.ended = true; },
    };
  }

  /** A Responses-API client: rejects at setup, or streams the given deltas. */
  function responsesClient(behaviour) {
    return {
      responses: {
        create: vi.fn(async () => {
          if (behaviour instanceof Error) throw behaviour;
          return (async function* stream() {
            for (const delta of behaviour.deltas) {
              if (delta instanceof Error) throw delta;
              yield { type: 'response.output_text.delta', delta };
            }
          })();
        }),
      },
    };
  }

  it('a setup failure on the requested model is invisible; the next model answers', async () => {
    chainFor = () => [tier('openai', 'gpt-x', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => (provider === 'openai'
      ? responsesClient(Object.assign(new Error('429 rate limit exceeded'), { status: 429 }))
      : responsesClient({ deltas: ['Hello', ' there'] })));
    const res = sseRes();
    await new StreamEngine('u1').startStream({}, res, 'hi', null, 'openai', 'gpt-x', 'false', null, 'tok');
    const body = res.out.chunks.join('');
    expect(body).toContain('Hello there');
    expect(body).not.toMatch(/error/i);
    expect(res.out.ended).toBe(true);
    expect(providerHealth.isAvailable('u1', 'openai')).toBe(false);
  });

  it('the requested model gets the caller\'s credential; fallbacks fetch their own', async () => {
    chainFor = () => [tier('openai', 'gpt-x', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => (provider === 'openai'
      ? responsesClient(new Error('503 overloaded'))
      : responsesClient({ deltas: ['ok'] })));
    await new StreamEngine('u1').startStream({}, sseRes(), 'hi', null, 'openai', 'gpt-x', 'false', null, 'tok');
    expect(createLlmClient.mock.calls[0][2].authToken).toBe('tok');
    expect(createLlmClient.mock.calls[1][2].authToken).toBeNull();
  });

  it('a failure AFTER content is shown, never spliced onto another model', async () => {
    chainFor = () => [tier('openai', 'gpt-x', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => (provider === 'openai'
      ? responsesClient({ deltas: ['Partial answer', new Error('connection reset')] })
      : responsesClient({ deltas: ['SHOULD NOT APPEAR'] })));
    const res = sseRes();
    await new StreamEngine('u1').startStream({}, res, 'hi', null, 'openai', 'gpt-x', 'false', null, 'tok');
    const body = res.out.chunks.join('');
    expect(body).toContain('Partial answer');
    expect(body).toContain('connection reset');
    expect(body).not.toContain('SHOULD NOT APPEAR');
  });

  it('when every model fails, the last one\'s error reaches the client as before', async () => {
    chainFor = () => [tier('openai', 'gpt-x', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    createLlmClient.mockImplementation(async (provider) => responsesClient(new Error(`${provider} is down`)));
    const res = sseRes();
    await new StreamEngine('u1').startStream({}, res, 'hi', null, 'openai', 'gpt-x', 'false', null, 'tok');
    const body = res.out.chunks.join('');
    expect(body).toContain('deepseek is down');
    expect(body).not.toContain('openai is down');
  });
});
