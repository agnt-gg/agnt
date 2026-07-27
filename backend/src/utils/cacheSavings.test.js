// Cache savings — derived from the REAL pricing table, never a re-implementation.
//
// The whole design rests on one claim: the "if nothing had been cached"
// baseline is getModelCost with the cache argument omitted. These tests pin
// that against the actual providerConfigs pricing so a multiplier change can
// never silently desync the two numbers.
import { describe, it, expect } from 'vitest';
import { computeCacheSavings, uncachedCostForRow } from './cacheSavings.js';
import { getModelCost } from '../services/ai/providerConfigs.js';

describe('computeCacheSavings', () => {
  it('reports a real saving when tokens are served from cache', () => {
    const r = computeCacheSavings('anthropic', 'claude-opus-5', 100_000, 1_000, {
      cacheReadTokens: 90_000,
    });
    expect(r).not.toBeNull();
    expect(r.savedCost).toBeGreaterThan(0);
    expect(r.uncachedCost).toBeGreaterThan(r.actualCost);
    expect(r.savedPct).toBeGreaterThan(50);
  });

  it('matches the real pricing function exactly on both sides', () => {
    const cache = { cacheReadTokens: 90_000 };
    const r = computeCacheSavings('anthropic', 'claude-opus-5', 100_000, 1_000, cache);
    const actual = getModelCost('anthropic', 'claude-opus-5', 100_000, 1_000, cache);
    const baseline = getModelCost('anthropic', 'claude-opus-5', 100_000, 1_000);
    expect(r.actualCost).toBe(actual.totalCost);
    expect(r.uncachedCost).toBe(baseline.totalCost);
    expect(r.savedCost).toBeCloseTo(baseline.totalCost - actual.totalCost, 12);
  });

  it('goes NEGATIVE on a cache-write turn — writes cost 1.25x, and we say so', () => {
    const r = computeCacheSavings('anthropic', 'claude-opus-5', 50_000, 600, {
      cacheCreation5mTokens: 50_000,
    });
    expect(r.savedCost).toBeLessThan(0);
    expect(r.actualCost).toBeGreaterThan(r.uncachedCost);
  });

  it('pays back on the very next turn (read at 0.1x)', () => {
    const write = computeCacheSavings('anthropic', 'claude-opus-5', 50_000, 600, {
      cacheCreation5mTokens: 50_000,
    });
    const read = computeCacheSavings('anthropic', 'claude-opus-5', 52_000, 600, {
      cacheReadTokens: 50_000,
    });
    expect(write.savedCost + read.savedCost).toBeGreaterThan(0);
  });

  it('reports zero saving for providers with no cache pricing', () => {
    const r = computeCacheSavings('groq', 'llama-3.3-70b-versatile', 100_000, 1_000, {
      cacheReadTokens: 90_000,
    });
    if (r) expect(r.savedCost).toBeCloseTo(0, 12);
  });

  it('returns null for an unknown model rather than inventing a number', () => {
    expect(computeCacheSavings('anthropic', 'not-a-real-model-xyz', 1000, 10, {})).toBeNull();
  });

  it('is zero when nothing was cached at all', () => {
    const r = computeCacheSavings('anthropic', 'claude-opus-5', 10_000, 500, {});
    expect(r.savedCost).toBeCloseTo(0, 12);
  });
});

describe('uncachedCostForRow (retroactive, no migration)', () => {
  const row = (over = {}) => ({
    provider: 'anthropic',
    model: 'claude-opus-5',
    input_tokens: 100_000,
    output_tokens: 1_000,
    cache_read_tokens: 90_000,
    cache_creation_tokens: 0,
    estimated_cost: 0.12,
    ...over,
  });

  it('reconstructs a baseline above the recorded cost for a cached row', () => {
    const r = row();
    expect(uncachedCostForRow(r)).toBeGreaterThan(r.estimated_cost);
  });

  it('never overstates: unpriceable rows fall back to their recorded cost', () => {
    expect(uncachedCostForRow(row({ provider: null, model: null }))).toBe(0.12);
    expect(uncachedCostForRow(row({ model: 'unknown-model-xyz' }))).toBe(0.12);
  });

  it('rows with no cache activity contribute zero saving', () => {
    const r = row({ cache_read_tokens: 0, cache_creation_tokens: 0 });
    expect(uncachedCostForRow(r)).toBe(r.estimated_cost);
  });

  it('handles empty / malformed rows without throwing', () => {
    expect(uncachedCostForRow(null)).toBe(0);
    expect(uncachedCostForRow({})).toBe(0);
    expect(uncachedCostForRow({ provider: 'anthropic', model: 'claude-opus-5' })).toBe(0);
  });

  it('summing rows yields a baseline >= the summed recorded cost', () => {
    const rows = [row(), row({ estimated_cost: 0.2 }), row({ provider: null })];
    const baseline = rows.reduce((a, r) => a + uncachedCostForRow(r), 0);
    const recorded = rows.reduce((a, r) => a + r.estimated_cost, 0);
    expect(baseline).toBeGreaterThanOrEqual(recorded);
  });
});
