import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The workflow AI node tries models in order until one answers.
 * Chain construction is ModelRouter's job (tested there); this pins how the
 * node walks it, what it records, and what it reports.
 */

let chainFor = () => [];
const resolveChainCalls = [];
vi.mock('../../../services/ai/ModelRouter.js', () => ({
  resolveChain: async (args) => {
    resolveChainCalls.push(args);
    return { chain: chainFor(args) };
  },
}));

const recorded = [];
vi.mock('../../../services/execution/LedgerRecorder.js', () => ({
  recordLlmCall: async (row) => { recorded.push(row); return 'row'; },
}));

const { default: singleton } = await import('./generate-with-ai-llm.js');
const { providerHealth } = await import('../../../services/ai/providerHealth.js');

const tier = (provider, model, source, i) => ({ provider, model, source, tier: i, primary: i === 0 });

function action(outcomes) {
  const a = Object.create(singleton);
  a.authManager = { getValidAccessToken: vi.fn(async () => 'key') };
  a.generateWithOpenAiLike = vi.fn(async (p) => {
    const outcome = outcomes[`${p.provider}/${p.model}`];
    if (outcome instanceof Error) throw outcome;
    return { generatedText: outcome ?? 'ok', inputTokens: 10, outputTokens: 2 };
  });
  return a;
}

const engine = { userId: 'u1', currentExecutionId: 'exec-1' };

beforeEach(() => {
  resolveChainCalls.length = 0;
  recorded.length = 0;
  providerHealth.reset();
});

describe('workflow AI node — failover', () => {
  it('a node that names a model keeps it first and is not cost-routed', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0)];
    await action({}).execute({ provider: 'groq', model: 'm1', prompt: 'hi' }, {}, engine);
    expect(resolveChainCalls[0]).toMatchObject({ userId: 'u1', origin: 'workflow_node', requested: { provider: 'groq', model: 'm1' }, routing: 'never' });
  });

  it('a node with no model is background work: routed', async () => {
    chainFor = () => [tier('deepseek', 'd1', 'routed', 0)];
    await action({}).execute({ prompt: 'hi' }, {}, engine);
    expect(resolveChainCalls[0]).toMatchObject({ requested: {}, routing: 'auto' });
  });

  it('rolls to the next model and records each attempt under the model that ran it', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    const out = await action({ 'groq/m1': new Error('503 overloaded'), 'deepseek/d1': 'from deepseek' })
      .execute({ provider: 'groq', model: 'm1', prompt: 'hi' }, {}, engine);
    expect(out.generatedText).toBe('from deepseek');
    expect(out.error ?? null).toBeNull();
    expect(recorded.map((r) => [r.provider, r.model, r.status, r.originId])).toEqual([
      ['groq', 'm1', 'error', 'exec-1'],
      ['deepseek', 'd1', 'ok', 'exec-1'],
    ]);
  });

  it('a provider-wide failure cools the provider for the next node', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    await action({ 'groq/m1': new Error('429 rate limit') }).execute({ provider: 'groq', model: 'm1', prompt: 'hi' }, {}, engine);
    expect(providerHealth.isAvailable('u1', 'groq')).toBe(false);
  });

  it('when every model fails, the node reports the FIRST model\'s error', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0), tier('deepseek', 'd1', 'default', 1)];
    const out = await action({ 'groq/m1': new Error('groq said no'), 'deepseek/d1': new Error('deepseek said no') })
      .execute({ provider: 'groq', model: 'm1', prompt: 'hi' }, {}, engine);
    expect(out.error).toBe('groq said no');
  });

  it('nothing configured is reported as exactly that', async () => {
    chainFor = () => [];
    const out = await action({}).execute({ prompt: 'hi' }, {}, engine);
    expect(out.error).toMatch(/No AI model is configured/);
  });

  it('prompt validation still applies before anything is sent', async () => {
    chainFor = () => [tier('groq', 'm1', 'pinned', 0)];
    const a = action({});
    const out = await a.execute({ provider: 'groq', model: 'm1' }, {}, engine);
    expect(out.error).toMatch(/Prompt or instructions are required/);
    expect(a.generateWithOpenAiLike).not.toHaveBeenCalled();
  });
});
