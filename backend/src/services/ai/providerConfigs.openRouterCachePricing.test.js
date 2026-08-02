import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDynamicPricingFromModels,
  getModelMetadata,
  getModelCost,
  getProviderConfig,
} from './providerConfigs.js';
import { computeCacheSavings } from '../../utils/cacheSavings.js';

/**
 * Live shapes captured from https://openrouter.ai/api/v1/models on 2026-08-02.
 * Prices are per token, as OpenRouter publishes them.
 */
const HAIKU_RAW = {
  id: 'anthropic/claude-haiku-4.5',
  name: 'Anthropic: Claude Haiku 4.5',
  context_length: 200000,
  pricing: {
    prompt: '0.000001',
    completion: '0.000005',
    input_cache_read: '0.0000001',
    input_cache_write: '0.00000125',
    input_cache_write_1h: '0.000002',
  },
};

const GROK_RAW = {
  id: 'x-ai/grok-4.5',
  name: 'xAI: Grok 4.5',
  context_length: 256000,
  // Publishes a read rate but no write rate — a real and common shape
  // (183 models publish read, only 58 publish write).
  pricing: { prompt: '0.000002', completion: '0.000006', input_cache_read: '0.0000003' },
};

const transform = getProviderConfig('openrouter').modelTransform;

describe('OpenRouter modelTransform carries published cache pricing', () => {
  it('parses read, write and 1h-write rates', () => {
    const t = transform(HAIKU_RAW);
    expect(t.pricing.input_cache_read).toBeCloseTo(1e-7, 12);
    expect(t.pricing.input_cache_write).toBeCloseTo(1.25e-6, 12);
    expect(t.pricing.input_cache_write_1h).toBeCloseTo(2e-6, 12);
  });

  it('reports a missing rate as null, never as free', () => {
    // Coercing an absent rate to 0 would under-report cost. That is a worse
    // error than the over-report it replaces, because it flatters the vendor.
    const t = transform(GROK_RAW);
    expect(t.pricing.input_cache_read).toBeCloseTo(3e-7, 12);
    expect(t.pricing.input_cache_write).toBeNull();
    expect(t.pricing.input_cache_write_1h).toBeNull();
  });
});

describe('registration converts per-token rates to per-million', () => {
  beforeEach(() => {
    registerDynamicPricingFromModels('openrouter', [transform(HAIKU_RAW), transform(GROK_RAW)]);
  });

  it('records all three rates for a fully-priced model', () => {
    const meta = getModelMetadata('openrouter', 'anthropic/claude-haiku-4.5');
    expect(meta.inputCostPer1M).toBeCloseTo(1.0, 6);
    expect(meta.inputCacheReadCostPer1M).toBeCloseTo(0.1, 6);
    expect(meta.inputCacheWriteCostPer1M).toBeCloseTo(1.25, 6);
    expect(meta.inputCacheWrite1hCostPer1M).toBeCloseTo(2.0, 6);
  });

  it('these are Anthropic’s real multipliers, which is the point', () => {
    // 0.1x read / 1.25x 5m-write / 2.0x 1h-write. The measured probe billed a
    // write at 2.0x, which is how we know the 1h ttl was honoured through
    // OpenRouter rather than being silently downgraded to the 5m default.
    const m = getModelMetadata('openrouter', 'anthropic/claude-haiku-4.5');
    expect(m.inputCacheReadCostPer1M / m.inputCostPer1M).toBeCloseTo(0.1, 6);
    expect(m.inputCacheWriteCostPer1M / m.inputCostPer1M).toBeCloseTo(1.25, 6);
    expect(m.inputCacheWrite1hCostPer1M / m.inputCostPer1M).toBeCloseTo(2.0, 6);
  });

  it('leaves unpublished rates unset rather than inventing them', () => {
    const meta = getModelMetadata('openrouter', 'x-ai/grok-4.5');
    expect(meta.inputCacheReadCostPer1M).toBeCloseTo(0.3, 6);
    expect(meta.inputCacheWriteCostPer1M).toBeUndefined();
  });
});

describe('getModelCost honours published rates over family multipliers', () => {
  beforeEach(() => {
    registerDynamicPricingFromModels('openrouter', [transform(HAIKU_RAW), transform(GROK_RAW)]);
  });

  it('prices a cache read at the published rate, not the 1.0x fallthrough', () => {
    // REGRESSION: 'openrouter' matches no branch of the multiplier table, so
    // before this change a cached read was billed at full input price and the
    // reported saving was exactly zero on traffic that was 90% cheaper.
    const cost = getModelCost('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(0.1, 6);

    const naive = getModelCost('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0);
    expect(naive.inputCost).toBeCloseTo(1.0, 6);
  });

  it('prices a 1-hour cache write at the published 1h rate', () => {
    const cost = getModelCost('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(2.0, 6);
  });

  it('prices a 5-minute cache write at the published 5m rate', () => {
    const cost = getModelCost('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0, {
      cacheCreation5mTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(1.25, 6);
  });

  it('a published WRITE rate beats the family multiplier', () => {
    // NOTE: Anthropic's real rates (1.25x / 2.0x) are numerically identical to
    // the family multipliers, so a test using them cannot tell the two code
    // paths apart — it passes even with the published-rate lookup deleted.
    // (My first version of this test did exactly that; a negative control
    // caught it.) These rates are deliberately divergent.
    registerDynamicPricingFromModels('openrouter', [transform({
      id: 'anthropic/claude-divergent-write',
      pricing: {
        prompt: '0.000001',
        completion: '0.000005',
        input_cache_write: '0.000003',      // 3.0x, vs the 1.25x family default
        input_cache_write_1h: '0.0000045',  // 4.5x, vs the 2.0x family default
      },
    })]);

    const w5m = getModelCost('openrouter', 'anthropic/claude-divergent-write', 1_000_000, 0, {
      cacheCreation5mTokens: 1_000_000,
    });
    expect(w5m.inputCost).toBeCloseTo(3.0, 6);

    const w1h = getModelCost('openrouter', 'anthropic/claude-divergent-write', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(w1h.inputCost).toBeCloseTo(4.5, 6);
  });

  it('falls back to the published 5m rate when no 1h rate exists', () => {
    // Better than dropping to the generic 1.0x multiplier: a model that
    // publishes one write rate is telling us writes are not free.
    // 1.5x is neither the 5m (1.25x) nor the 1h (2.0x) family default, so this
    // can only pass by genuinely reading the published 5m rate.
    registerDynamicPricingFromModels('openrouter', [transform({
      id: 'anthropic/claude-only-5m-write',
      pricing: { prompt: '0.000001', completion: '0.000002', input_cache_write: '0.0000015' },
    })]);
    const cost = getModelCost('openrouter', 'anthropic/claude-only-5m-write', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(1.5, 6);
  });

  it('NEGATIVE CONTROL: Anthropic-native pricing is unchanged', () => {
    // The multiplier table must still govern providers that publish no rates.
    const cost = getModelCost('anthropic', 'claude-sonnet-4-20250514', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(3.0 * 0.1, 6);

    const write1h = getModelCost('anthropic', 'claude-sonnet-4-20250514', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(write1h.inputCost).toBeCloseTo(3.0 * 2.0, 6);
  });

  it('the measured live turn reprices correctly end to end', () => {
    // Probe D2, 2026-08-02: prompt_tokens 8525, of which 8513 were a cache
    // read, 4 completion tokens, OpenRouter billed $0.0008933.
    const cost = getModelCost('openrouter', 'anthropic/claude-haiku-4.5', 8525, 4, {
      cacheReadTokens: 8513,
    });
    expect(cost.totalCost).toBeGreaterThan(0.0008);
    expect(cost.totalCost).toBeLessThan(0.0010);
  });
});

describe('multiplier fallback before the catalog has been fetched', () => {
  // getModelCost is reachable on a cold process whose model list has not been
  // loaded yet, so the fallback path has to be right on its own. Measured
  // live: a first-turn write of 8519 tokens cost $0.017066, but was reported
  // as $0.008547 while 'openrouter' fell through to the generic 1.0x branch.
  const BARE = { id: 'anthropic/claude-fresh-release', pricing: { prompt: '0.000001', completion: '0.000005' } };

  beforeEach(() => registerDynamicPricingFromModels('openrouter', [transform(BARE)]));

  it('uses Anthropic’s multipliers for an anthropic/* slug', () => {
    const read = getModelCost('openrouter', 'anthropic/claude-fresh-release', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(read.inputCost).toBeCloseTo(0.1, 6);

    const write = getModelCost('openrouter', 'anthropic/claude-fresh-release', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(write.inputCost).toBeCloseTo(2.0, 6);
  });

  it('uses OpenAI’s 0.5x read for an openai/* slug', () => {
    registerDynamicPricingFromModels('openrouter', [transform({
      id: 'openai/gpt-fresh', pricing: { prompt: '0.000002', completion: '0.000008' },
    })]);
    const read = getModelCost('openrouter', 'openai/gpt-fresh', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(read.inputCost).toBeCloseTo(1.0, 6);
  });

  it('NEGATIVE CONTROL: an unknown family stays on the neutral 1.0x', () => {
    // Inventing a discount for a vendor we know nothing about would
    // under-report cost, which flatters the bill. Neutral is the honest default.
    registerDynamicPricingFromModels('openrouter', [transform({
      id: 'somenewvendor/model-x', pricing: { prompt: '0.000001', completion: '0.000002' },
    })]);
    const read = getModelCost('openrouter', 'somenewvendor/model-x', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(read.inputCost).toBeCloseTo(1.0, 6);
  });

  it('a published rate still beats the family multiplier', () => {
    // Precedence must not invert: the catalog is authoritative.
    registerDynamicPricingFromModels('openrouter', [transform({
      id: 'anthropic/claude-odd-deal',
      pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000005' },
    })]);
    const read = getModelCost('openrouter', 'anthropic/claude-odd-deal', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(read.inputCost).toBeCloseTo(0.5, 6); // published 0.5, not the 0.1x family default
  });

  it('reproduces the measured live write turn exactly', () => {
    // Probe turn 1: prompt_tokens 8522, cache_write_tokens 8519, 5 completion
    // tokens. OpenRouter billed $0.017066.
    const cost = getModelCost('openrouter', 'anthropic/claude-fresh-release', 8522, 5, {
      cacheCreation1hTokens: 8519,
    });
    expect(cost.totalCost).toBeCloseTo(0.017066, 5);
  });
});

describe('cache savings become visible', () => {
  beforeEach(() => {
    registerDynamicPricingFromModels('openrouter', [transform(HAIKU_RAW)]);
  });

  it('reports the ~90% saving a read actually produced', () => {
    const s = computeCacheSavings('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0, {
      cacheReadTokens: 1_000_000,
    });
    expect(s.savedPct).toBeGreaterThan(85);
  });

  it('still reports a write turn as more expensive, honestly', () => {
    // A 1h write costs 2.0x. The turn that first writes a prefix genuinely
    // costs more than not caching; clamping that to zero would hide the
    // trade-off that makes the next turn cheap.
    const s = computeCacheSavings('openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 0, {
      cacheCreation1hTokens: 1_000_000,
    });
    expect(s.savedCost).toBeLessThan(0);
  });
});
