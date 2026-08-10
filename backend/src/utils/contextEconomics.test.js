import { describe, it, expect } from 'vitest';
import {
  inputTokenRate,
  cachedInputTokenRate,
  forecastTurnsToCompression,
  buildEconomics,
  priceItems,
} from './contextEconomics.js';
import { getModelCost } from '../services/ai/providerConfigs.js';

const P = 'anthropic';
const M = 'claude-sonnet-4-5-20250929';

describe('inputTokenRate', () => {
  it('agrees with getModelCost instead of re-deriving a price', () => {
    const rate = inputTokenRate(P, M);
    expect(rate).toBeGreaterThan(0);
    // The whole point of probing the pricing table: 250k tokens must cost
    // exactly what getModelCost says 250k tokens cost.
    expect(rate * 250_000).toBeCloseTo(getModelCost(P, M, 250_000, 0).inputCost, 10);
  });

  it('isolates the input side (output tokens contribute nothing)', () => {
    const rate = inputTokenRate(P, M);
    const inputOnly = getModelCost(P, M, 1_000_000, 0).totalCost;
    expect(rate * 1_000_000).toBeCloseTo(inputOnly, 10);
    // Sanity: a request WITH output really is more expensive, so the probe is
    // not accidentally measuring zero.
    expect(getModelCost(P, M, 1_000_000, 5_000).totalCost).toBeGreaterThan(inputOnly);
  });

  it('returns null for an unpriceable model rather than 0', () => {
    expect(inputTokenRate('nonexistent-provider', 'nonexistent-model')).toBeNull();
    expect(inputTokenRate(undefined, undefined)).toBeNull();
  });
});

describe('cachedInputTokenRate', () => {
  it('is cheaper than the plain rate on a provider with cache discounts', () => {
    const plain = inputTokenRate(P, M);
    const cached = cachedInputTokenRate(P, M);
    expect(cached).toBeGreaterThan(0);
    expect(cached).toBeLessThan(plain);
    // Anthropic reads are 0.1x. Asserted via the ratio so a price change to
    // the model does not break the test, only a multiplier change would.
    expect(cached / plain).toBeCloseTo(0.1, 6);
  });

  it('is null where no cache discount is KNOWN — never the plain rate as a claim', () => {
    // This used to assert cached === plain. That was the silent default: a 1.0x
    // multiplier presented as a fact about a model with no known cache pricing,
    // which the panel then rendered as "$0.00 saved". The contract is now
    // explicit ignorance (I2): no sourced multiplier and no published catalog
    // rate means null, and the panel says nothing.
    //
    // llama-on-groq is a genuine instance, not a contrived one: Groq documents
    // caching for the gpt-oss family only, so this model has no cache at all.
    const plain = inputTokenRate('groq', 'llama-3.3-70b-versatile');
    if (plain == null) return; // model not catalogued in this build
    expect(cachedInputTokenRate('groq', 'llama-3.3-70b-versatile')).toBeNull();
  });

  it('is a real discount where the rate IS known', () => {
    // The other half of the contract — otherwise "always null" would pass.
    const plain = inputTokenRate('groq', 'openai/gpt-oss-120b');
    const cached = cachedInputTokenRate('groq', 'openai/gpt-oss-120b');
    if (plain == null) return;
    expect(cached).not.toBeNull();
    expect(cached).toBeLessThan(plain);
  });

  it('returns null for an unpriceable model', () => {
    expect(cachedInputTokenRate('nope', 'nope')).toBeNull();
  });
});

describe('forecastTurnsToCompression', () => {
  it('divides remaining headroom by growth', () => {
    expect(forecastTurnsToCompression({ currentTokens: 700_000, tokenLimit: 1_000_000, growthPerTurn: 100_000 })).toBe(3);
  });

  it('floors rather than rounds — 2.9 turns of headroom is 2 safe turns', () => {
    expect(forecastTurnsToCompression({ currentTokens: 710_000, tokenLimit: 1_000_000, growthPerTurn: 100_000 })).toBe(2);
  });

  it('returns 0 when already over the limit', () => {
    expect(forecastTurnsToCompression({ currentTokens: 1_100_000, tokenLimit: 1_000_000, growthPerTurn: 50_000 })).toBe(0);
  });

  it('returns null when growth is unknown, zero or shrinking', () => {
    expect(forecastTurnsToCompression({ currentTokens: 10, tokenLimit: 100, growthPerTurn: 0 })).toBeNull();
    expect(forecastTurnsToCompression({ currentTokens: 10, tokenLimit: 100, growthPerTurn: -500 })).toBeNull();
    expect(forecastTurnsToCompression({ currentTokens: 10, tokenLimit: 0, growthPerTurn: 10 })).toBeNull();
    expect(forecastTurnsToCompression({})).toBeNull();
  });
});

describe('buildEconomics', () => {
  it('prices the fixed prefix at both the plain and cached rate', () => {
    const e = buildEconomics({ provider: P, model: M, systemTokens: 31_645, toolTokens: 37_434 });
    expect(e.floorTokens).toBe(69_079);
    expect(e.floorCost).toBeCloseTo(69_079 * e.rate, 12);
    expect(e.floorCostCached).toBeCloseTo(69_079 * e.cachedRate, 12);
    // The gap between the two IS the per-turn cost of a broken prefix.
    expect(e.floorCost).toBeGreaterThan(e.floorCostCached);
  });

  it('retains the split so the UI can attribute the floor', () => {
    const e = buildEconomics({ provider: P, model: M, systemTokens: 100, toolTokens: 400 });
    expect(e.systemTokens).toBe(100);
    expect(e.toolTokens).toBe(400);
    expect(e.floorTokens).toBe(500);
  });

  it('returns null — not a zero-cost floor — when the model is unpriceable', () => {
    expect(buildEconomics({ provider: 'nope', model: 'nope', systemTokens: 5000, toolTokens: 5000 })).toBeNull();
  });

  it('handles a missing/zero surface without producing NaN', () => {
    const e = buildEconomics({ provider: P, model: M });
    expect(e.floorTokens).toBe(0);
    expect(e.floorCost).toBe(0);
    expect(Number.isNaN(e.floorCost)).toBe(false);
  });
});

describe('priceItems', () => {
  it('adds a per-turn cost without mutating the input', () => {
    const items = [{ name: 'a', tokens: 1000 }];
    const out = priceItems(items, 0.000003);
    expect(out[0].cost).toBeCloseTo(0.003, 12);
    expect(items[0].cost).toBeUndefined();
    expect(out[0]).not.toBe(items[0]);
  });

  it('passes items through untouched when there is no rate', () => {
    const items = [{ name: 'a', tokens: 1000 }];
    expect(priceItems(items, null)).toBe(items);
  });

  it('tolerates a missing token count', () => {
    expect(priceItems([{ name: 'a' }], 0.001)[0].cost).toBe(0);
  });

  it('returns [] for a non-array', () => {
    expect(priceItems(undefined, 0.001)).toEqual([]);
    expect(priceItems(null, null)).toEqual([]);
  });
});
