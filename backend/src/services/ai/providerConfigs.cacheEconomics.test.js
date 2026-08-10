import { describe, it, expect } from 'vitest';
import {
  getAllProviderKeys,
  getProviderConfig,
  getCacheEconomics,
  isCachedRateKnown,
  getModelCost,
} from './providerConfigs.js';
import { cachedInputTokenRate, buildEconomics } from '../../utils/contextEconomics.js';

/**
 * INVARIANT I2 — unknown is a value, and it is loud.
 *
 * The old `else { readMult = 1.0 }` billed cache reads at full price for every
 * family outside anthropic/openai — 109 of 206 priced models, measured
 * 2026-08-08 — and the panel rendered that as "$0.00 saved", which is a
 * confident false claim about money.
 *
 * The contract now:
 *   - documented families get their documented multiplier, whatever it is;
 *   - everything unsourced still BILLS conservatively at 1.0x (we never invent
 *     a discount) but REPORTS known:false, and the display layer turns that
 *     into null so the panel says nothing rather than something false.
 */

/** First model with base pricing but NO published cached-read rate. */
function unpricedCacheModel(providerKey, idFilter = null) {
  const cfg = getProviderConfig(providerKey);
  for (const [id, meta] of Object.entries(cfg?.modelMetadata || {})) {
    if (idFilter && !idFilter.test(id)) continue;
    if (meta.inputCostPer1M != null && meta.outputCostPer1M != null && meta.inputCacheReadCostPer1M == null) return id;
  }
  return null;
}

// Groq's discount is scoped to gpt-oss — the only Groq models with a cache.
const GROQ_CACHED = /^openai\/gpt-oss/;

describe('getCacheEconomics — the sourced table', () => {
  it.each([
    ['anthropic', 'claude-opus-4-8', 0.1, true],
    ['claude-code', 'claude-opus-4-8', 0.1, true],
    ['openai', 'gpt-5.6', 0.5, true],
    ['openai-codex', 'gpt-5.4-mini', 0.5, true],
    ['groq', 'openai/gpt-oss-120b', 0.5, true],
    ['gemini', 'gemini-2.5-flash', 0.1, true],
    ['gemini', 'gemini-3-flash-preview', 0.1, true],
    ['gemini-cli', 'gemini-2.5-pro', 0.1, true],
  ])('%s / %s -> readMult %s, known %s', (provider, model, mult, known) => {
    const econ = getCacheEconomics(provider, model);
    expect(econ.readMult).toBe(mult);
    expect(econ.known).toBe(known);
  });

  it('cerebras is KNOWN at 1.0x — a documented absence of discount is a fact', () => {
    // The instructive case for I2: `known` must be independent of the VALUE.
    // Cerebras documents that cached tokens bill at the standard rate (the win
    // is latency). Reporting that as "unknown" would be as wrong as reporting
    // an unsourced 1.0x as "no discount".
    const econ = getCacheEconomics('cerebras', 'zai-glm-4.7');
    expect(econ).toEqual({ readMult: 1.0, write5mMult: 1.0, write1hMult: 1.0, known: true });
  });

  it('remaps openrouter to the vendor named in the model slug', () => {
    expect(getCacheEconomics('openrouter', 'anthropic/claude-haiku-4.5').readMult).toBe(0.1);
    expect(getCacheEconomics('openrouter', 'openai/gpt-5.4-mini').readMult).toBe(0.5);
  });

  it('citations are SCOPED: out-of-scope models of a cited provider stay unknown', () => {
    expect(getCacheEconomics('gemini', 'gemini-1.5-pro').known).toBe(false);   // citation is 2.5+
    expect(getCacheEconomics('groq', 'llama-3.3-70b-versatile').known).toBe(false); // no cache at all
    expect(getCacheEconomics('groq', 'qwen/qwen3-32b').known).toBe(false);
  });

  it('unsourced families report known:false with conservative 1.0x', () => {
    for (const p of ['togetherai', 'zai', 'minimax', 'chutes', 'kimi', 'deepseek', 'grokai']) {
      const econ = getCacheEconomics(p, 'any-model');
      expect(econ.known, p).toBe(false);
      expect(econ.readMult, p).toBe(1.0);
    }
  });

  it('PROVIDER 21: a provider that does not exist yet is unknown, not 1.0x-as-fact', () => {
    // The whole point of a representable unknown — the next provider added
    // cannot silently land in a full-price hole.
    expect(getCacheEconomics('some-future-provider', 'some-future-model').known).toBe(false);
  });

  it('every registry provider resolves without throwing (I5)', () => {
    for (const key of getAllProviderKeys()) {
      const econ = getCacheEconomics(key, 'probe-model');
      expect(typeof econ.known, key).toBe('boolean');
      expect(Number.isFinite(econ.readMult), key).toBe(true);
    }
  });
});

describe('getModelCost — billing is unchanged and conservative', () => {
  it('discounts groq gpt-oss cache reads at the documented 0.5x', () => {
    const model = unpricedCacheModel('groq', GROQ_CACHED);
    expect(model, 'groq needs a priced gpt-oss model with no published cache rate').not.toBeNull();
    const full = getModelCost('groq', model, 100_000, 0);
    const cached = getModelCost('groq', model, 100_000, 0, { cacheReadTokens: 100_000 });
    expect(cached.inputCost).toBeCloseTo(full.inputCost * 0.5, 10);
  });

  it('keeps the anthropic path at 0.1x — the gold standard is untouched', () => {
    const full = getModelCost('anthropic', 'claude-opus-4-8', 100_000, 0);
    const cached = getModelCost('anthropic', 'claude-opus-4-8', 100_000, 0, { cacheReadTokens: 100_000 });
    if (!full) return;
    expect(cached.inputCost).toBeCloseTo(full.inputCost * 0.1, 10);
  });

  it('bills unknown families at FULL price — never invents a discount', () => {
    const model = unpricedCacheModel('togetherai');
    expect(model).not.toBeNull();
    const full = getModelCost('togetherai', model, 100_000, 0);
    const cached = getModelCost('togetherai', model, 100_000, 0, { cacheReadTokens: 100_000 });
    expect(cached.inputCost).toBeCloseTo(full.inputCost, 12);
  });
});

describe('display path — unknown renders as nothing, never as a fabricated rate', () => {
  it('groq gpt-oss shows a real cached rate', () => {
    const model = unpricedCacheModel('groq', GROQ_CACHED);
    const base = getModelCost('groq', model, 1_000_000, 0).inputCost / 1_000_000;
    expect(cachedInputTokenRate('groq', model)).toBeCloseTo(base * 0.5, 15);
  });

  it('an unknown family shows null', () => {
    expect(cachedInputTokenRate('togetherai', unpricedCacheModel('togetherai'))).toBeNull();
  });

  it('a published per-model rate wins regardless of family', () => {
    // grokai publishes per-model cached rates that DIFFER between models
    // (4.3 is 0.1x, 4.20 is 0.16x), which is exactly why xai has no family row.
    for (const cfg of [getProviderConfig('grokai')]) {
      const published = Object.entries(cfg.modelMetadata || {})
        .find(([, m]) => m.inputCacheReadCostPer1M != null);
      expect(published, 'grokai should publish at least one cached rate').toBeTruthy();
      expect(isCachedRateKnown('grokai', published[0])).toBe(true);
      expect(cachedInputTokenRate('grokai', published[0])).not.toBeNull();
    }
  });

  it('buildEconomics: unknown -> cachedRate null, floorCostCached null, cacheRateKnown false', () => {
    const model = unpricedCacheModel('togetherai');
    const econ = buildEconomics({ provider: 'togetherai', model, systemTokens: 1000, toolTokens: 1000 });
    expect(econ).not.toBeNull();
    expect(econ.cachedRate).toBeNull();
    expect(econ.floorCostCached).toBeNull();
    expect(econ.cacheRateKnown).toBe(false);
  });

  it('buildEconomics: known -> real cached rate and cacheRateKnown true', () => {
    const model = unpricedCacheModel('groq', GROQ_CACHED);
    const econ = buildEconomics({ provider: 'groq', model, systemTokens: 1000, toolTokens: 1000 });
    expect(econ.cacheRateKnown).toBe(true);
    expect(econ.cachedRate).toBeCloseTo(econ.rate * 0.5, 15);
  });

  it('cerebras: known, and cachedRate EQUALS rate — a truthful "no discount"', () => {
    const model = unpricedCacheModel('cerebras');
    if (!model) return;
    const econ = buildEconomics({ provider: 'cerebras', model, systemTokens: 1000, toolTokens: 1000 });
    expect(econ.cacheRateKnown).toBe(true);
    expect(econ.cachedRate).toBeCloseTo(econ.rate, 15);
  });
});
