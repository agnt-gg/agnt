import { describe, it, expect, vi } from 'vitest';

const PRICES = {
  'flagship-xl': [15, 75],
  'flagship-l': [5, 25],
  'mid-a': [3, 15],
  'mid-b': [2, 10],
  'whisper-large-v3': [0.01, 0.01],
  'tiny-fast': [0.05, 0.1],
  'small-fast': [0.1, 0.4],
  'unpriced-new': [null, null],
};
const ORDER = ['flagship-xl', 'flagship-l', 'mid-a', 'mid-b', 'whisper-large-v3', 'unpriced-new', 'small-fast', 'tiny-fast'];

vi.mock('../ai/ProviderRegistry.js', () => ({
  getTextModels: () => ORDER,
  PROVIDER_CAPABILITIES: { acme: {} },
  supportsVision: () => false,
}));
vi.mock('../ai/providerConfigs.js', () => ({
  getModelMetadata: (_p, id) => {
    const [inputCostPer1M, outputCostPer1M] = PRICES[id] || [null, null];
    return { inputCostPer1M, outputCostPer1M };
  },
  getAllModelMetadata: () => ({}),
  getCacheEconomics: () => ({ readMult: 1, known: false }),
  isSubscriptionProvider: () => false,
  notionalSeatCostPer1M: () => null,
  providerSupportsTools: () => true,
  getProviderConfig: () => ({ key: 'acme' }),
}));
vi.mock('../ai/defaultModel.js', () => ({
  NOT_A_CHAT_MODEL: /whisper|tts|embed/i,
  resolveDefaultModel: () => 'live-default',
}));
vi.mock('../../models/LlmCallModel.js', () => ({ default: { reliabilityByModel: async () => [] } }));

const { modelsForProvider, collectCandidates, __resetRoutingCaches } = await import('./routingCandidates.js');
const { providerHealth } = await import('../ai/providerHealth.js');

describe('modelsForProvider — a pool that can actually find the cheap model', () => {
  const pool = modelsForProvider('acme', 2);

  it('keeps the vendor-recommended head of the list', () => {
    expect(pool).toEqual(expect.arrayContaining(['flagship-xl', 'flagship-l']));
  });

  it('adds the cheapest priced chat models even when they sit at the bottom of the list', () => {
    expect(pool).toEqual(expect.arrayContaining(['tiny-fast', 'small-fast', 'mid-b']));
  });

  it('adds the live catalogue default', () => {
    expect(pool).toContain('live-default');
  });

  it('never offers a speech/embedding model as a chat candidate, however cheap', () => {
    expect(pool).not.toContain('whisper-large-v3');
  });

  it('has no duplicates', () => {
    expect(new Set(pool).size).toBe(pool.length);
  });
});

describe('collectCandidates — health is real, not assumed', () => {
  it('marks a provider cooling for this user as unhealthy', async () => {
    __resetRoutingCaches();
    providerHealth.reset();
    providerHealth.recordFailure('u1', 'acme', 'auth');
    const authManager = { getConnectedApps: async () => ['acme'] };
    const candidates = await collectCandidates({ userId: 'u1', authManager });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.healthy === false)).toBe(true);

    __resetRoutingCaches();
    const other = await collectCandidates({ userId: 'u2', authManager });
    expect(other.every((c) => c.healthy === true)).toBe(true);
    providerHealth.reset();
  });
});
