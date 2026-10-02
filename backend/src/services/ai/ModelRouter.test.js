import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => null) } }));
vi.mock('../../models/LlmCallModel.js', () => ({
  CHAT_SURFACE_ORIGINS: ['orchestrator', 'agent', 'workflow', 'tool', 'widget', 'goal', 'artifact'],
  default: {},
}));

const { resolveChain, complete } = await import('./ModelRouter.js');
const { createProviderHealth } = await import('./providerHealth.js');
const { NoAiConfiguredError } = await import('./accountAi.js');

const ok = (text) => ({ responseMessage: { content: text }, toolCalls: [], usage: { inputTokens: 10, outputTokens: 2 } });
const failed = (recoveredError) => ({ responseMessage: null, toolCalls: [], recoveredFromError: true, recoveredError });

function makeDeps({ settings = null, routed = null, outcomes = {}, health = createProviderHealth() } = {}) {
  const calls = [];
  const recorded = [];
  const routerCalls = [];
  return {
    calls,
    recorded,
    routerCalls,
    health,
    loadUserSettings: async () => settings,
    loadCustomProviders: async () => [],
    buildRoutedChain: async (args) => {
      routerCalls.push(args);
      return routed ? { chain: routed, decision: { chosenProvider: routed[0].provider } } : null;
    },
    createClient: async (provider) => ({ provider }),
    createAdapter: async (provider, client, model) => ({
      call: async () => {
        calls.push(`${provider}/${model}`);
        const outcome = outcomes[`${provider}/${model}`];
        if (outcome instanceof Error) throw outcome;
        return outcome || ok('default answer');
      },
    }),
    recordCall: async (row) => { recorded.push(row); return 'row'; },
  };
}

const account = {
  selectedProvider: 'anthropic',
  selectedModel: 'claude-opus-5',
  fallbackEnabled: true,
  fallbackProviders: [{ provider: 'openai', model: 'gpt-5.5' }],
  routingMode: 'static',
  routingPolicy: null,
};
const routedPicks = [
  { provider: 'groq', model: 'llama-3.1-8b-instant', tier: 0, primary: true, reason: 'low stake — cheapest capable' },
  { provider: 'deepseek', model: 'deepseek-v4', tier: 1, primary: false, reason: 'backup' },
];
const pairs = (chain) => chain.map((t) => `${t.provider}/${t.model}`);

describe('resolveChain — who to try, in order', () => {
  it('background work is routed even when chat routing is off, and keeps default + fallbacks', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    const { chain, routed } = await resolveChain({ userId: 'u', origin: 'title' }, deps);
    expect(routed).toBe(true);
    expect(pairs(chain)).toEqual([
      'groq/llama-3.1-8b-instant', 'deepseek/deepseek-v4', 'anthropic/claude-opus-5', 'openai/gpt-5.5',
    ]);
  });

  it('high-stake work puts the account chain first; routed picks are backups', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    const { chain } = await resolveChain({ userId: 'u', origin: 'goal_eval' }, deps);
    expect(pairs(chain).slice(0, 2)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
    expect(pairs(chain)).toContain('groq/llama-3.1-8b-instant');
  });

  it('chat surfaces follow the user setting: static means no routing', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    const { chain, routed } = await resolveChain({ userId: 'u', origin: 'orchestrator' }, deps);
    expect(routed).toBe(false);
    expect(deps.routerCalls).toHaveLength(0);
    expect(pairs(chain)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
  });

  it('chat surfaces are routed when the user turned dynamic routing on', async () => {
    const deps = makeDeps({ settings: { ...account, routingMode: 'dynamic' }, routed: routedPicks });
    const { routed } = await resolveChain({ userId: 'u', origin: 'orchestrator' }, deps);
    expect(routed).toBe(true);
  });

  it("routing: 'never' keeps a measurement on the account chain", async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    const { chain } = await resolveChain({ userId: 'u', origin: 'insight', routing: 'never' }, deps);
    expect(deps.routerCalls).toHaveLength(0);
    expect(pairs(chain)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
  });

  it('a pin goes first, then the rest', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    const { chain } = await resolveChain({ userId: 'u', origin: 'insight', requested: { provider: 'kimi', model: 'kimi-k2' } }, deps);
    expect(chain[0]).toMatchObject({ provider: 'kimi', model: 'kimi-k2', source: 'pinned' });
    expect(pairs(chain)).toContain('anthropic/claude-opus-5');
  });

  it('a router failure degrades to the account chain, never an error', async () => {
    const deps = makeDeps({ settings: account });
    deps.buildRoutedChain = async () => { throw new Error('router down'); };
    const { chain } = await resolveChain({ userId: 'u', origin: 'title' }, deps);
    expect(pairs(chain)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5.5']);
  });

  it('no default set: the fallback list alone is the account chain', async () => {
    const deps = makeDeps({ settings: { ...account, selectedProvider: null, selectedModel: null } });
    const { chain } = await resolveChain({ userId: 'u', origin: 'title' }, deps);
    expect(pairs(chain)).toEqual(['openai/gpt-5.5']);
  });

  it('cooling providers move to the back', async () => {
    const health = createProviderHealth();
    health.recordFailure('u', 'groq', 'rate_limit');
    const deps = makeDeps({ settings: account, routed: routedPicks, health });
    const { chain } = await resolveChain({ userId: 'u', origin: 'title' }, deps);
    expect(chain.at(-1).provider).toBe('groq');
    expect(chain[0].provider).toBe('deepseek');
  });

  it('tells the router what the job is', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    await resolveChain({ userId: 'u', origin: 'title', conversationId: 'c1', intentInput: { contextTokens: 600, outputTokens: 30 } }, deps);
    expect(deps.routerCalls[0]).toMatchObject({
      origin: 'title', conversationId: 'c1', hintProvider: 'anthropic', hintModel: 'claude-opus-5',
      intentInput: { contextTokens: 600, outputTokens: 30 },
    });
  });
});

describe('complete — pick one, did it work? no: pick two', () => {
  const messages = [{ role: 'user', content: 'hi' }];

  it('serves from the first working pick and records the model that SERVED', async () => {
    const deps = makeDeps({
      settings: account,
      routed: routedPicks,
      outcomes: { 'groq/llama-3.1-8b-instant': failed('503 overloaded'), 'deepseek/deepseek-v4': ok('answer') },
    });
    const out = await complete({ userId: 'u', origin: 'insight', originId: 'x', messages }, deps);
    expect(out).toMatchObject({ text: 'answer', provider: 'deepseek', model: 'deepseek-v4' });
    expect(deps.calls).toEqual(['groq/llama-3.1-8b-instant', 'deepseek/deepseek-v4']);
    await vi.waitFor(() => expect(deps.recorded).toHaveLength(2));
    expect(deps.recorded.map((r) => [r.provider, r.status])).toEqual([['groq', 'error'], ['deepseek', 'ok']]);
    expect(deps.recorded[1]).toMatchObject({ origin: 'insight', originId: 'x', userId: 'u' });
  });

  it('a rejected answer moves to the next pick', async () => {
    const deps = makeDeps({
      settings: account,
      routed: routedPicks,
      outcomes: { 'groq/llama-3.1-8b-instant': ok('I cannot help'), 'deepseek/deepseek-v4': ok('{"title":"Good"}') },
    });
    const out = await complete({ userId: 'u', origin: 'title', messages, validate: (t) => t.startsWith('{') }, deps);
    expect(out.text).toBe('{"title":"Good"}');
  });

  it('feeds provider health from real calls', async () => {
    const health = createProviderHealth();
    const deps = makeDeps({ settings: account, routed: routedPicks, health, outcomes: { 'groq/llama-3.1-8b-instant': failed('401 unauthorized') } });
    await complete({ userId: 'u', origin: 'insight', messages }, deps);
    expect(health.status('u', 'groq').state).toBe('cooling');
  });

  it('a client that cannot be built (no credential) rolls over instead of failing', async () => {
    const deps = makeDeps({ settings: account, routed: routedPicks });
    deps.createClient = async (provider) => {
      if (provider === 'groq') throw new Error('Missing access token for provider: groq');
      return {};
    };
    const out = await complete({ userId: 'u', origin: 'insight', messages }, deps);
    expect(out.provider).toBe('deepseek');
  });

  it('every pick failing throws with the attempts attached', async () => {
    const deps = makeDeps({
      settings: account,
      outcomes: { 'anthropic/claude-opus-5': failed('529 overloaded'), 'openai/gpt-5.5': failed('502 bad gateway') },
    });
    await expect(complete({ userId: 'u', origin: 'insight', messages, routing: 'never' }, deps)).rejects.toMatchObject({
      code: 'ALL_TIERS_FAILED',
      attempts: [expect.objectContaining({ provider: 'anthropic' }), expect.objectContaining({ provider: 'openai' })],
    });
  });

  it('every answer rejected throws INVALID_OUTPUT', async () => {
    const deps = makeDeps({ settings: account });
    await expect(complete({ userId: 'u', origin: 'title', messages, routing: 'never', validate: () => 'no' }, deps))
      .rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('nothing configured is reported as exactly that', async () => {
    const deps = makeDeps({ settings: null });
    await expect(complete({ userId: 'u', origin: 'insight', messages }, deps)).rejects.toBeInstanceOf(NoAiConfiguredError);
  });

  it('record: false leaves accounting to the caller; onUsage still reports what served', async () => {
    const deps = makeDeps({ settings: account });
    const seen = [];
    await complete({ userId: 'u', origin: 'goal_eval', messages, routing: 'never', record: false, onUsage: (u, served) => seen.push([u.inputTokens, served.provider]) }, deps);
    expect(deps.recorded).toHaveLength(0);
    expect(seen).toEqual([[10, 'anthropic']]);
  });

  it('rejects an empty message list up front', async () => {
    await expect(complete({ userId: 'u', origin: 'insight', messages: [] }, makeDeps({ settings: account }))).rejects.toThrow(TypeError);
  });
});

beforeEach(() => vi.clearAllMocks());
