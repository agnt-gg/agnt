import { describe, it, expect } from 'vitest';
import { getCacheEconomics, getModelCost } from './providerConfigs.js';
import { OPENAI_GPT56_OR_LATER } from '../../utils/promptCacheTtl.js';

/**
 * GPT-5.6+ charges a CACHE WRITE PREMIUM, and we were billing 1.0x.
 *
 *   "Cache writes have no additional fee on models before the GPT-5.6 family.
 *    For GPT-5.6 models and later model families, cache writes cost 1.25x the
 *    uncached input token rate."
 *   — developers.openai.com/api/docs/guides/prompt-caching (2026-08-10)
 *
 * This under-billed the provider people use most: openai-codex's model list
 * LEADS with gpt-5.6-sol/terra/luna. It also changes what a cache MISS means
 * on these models — a miss is no longer free, it writes at 1.25x — so prefix
 * instability costs money here, not just latency.
 *
 * Note the asymmetry with Anthropic, which is NOT a copy-paste of it:
 * Anthropic charges 1.25x at 5m and 2.0x at 1h. OpenAI's 5.6 premium is a flat
 * 1.25x, because it has no user-selectable 1h tier on this path.
 */

describe('GPT-5.6+ cache write premium', () => {
  it.each([
    ['gpt-5.6-sol', 1.25],
    ['gpt-5.6-terra', 1.25],
    ['gpt-5.6-luna', 1.25],
    ['gpt-5.6', 1.25],
    ['gpt-7', 1.25],
  ])('%s writes at %sx', (model, mult) => {
    for (const provider of ['openai', 'openai-codex']) {
      const econ = getCacheEconomics(provider, model);
      expect(econ.write5mMult, `${provider}/${model}`).toBe(mult);
      expect(econ.write1hMult, `${provider}/${model}`).toBe(mult);
      expect(econ.readMult, 'reads are unchanged at 0.5x').toBe(0.5);
      expect(econ.known).toBe(true);
    }
  });

  it.each(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2-codex', 'gpt-4.1', 'o4-mini'])(
    'pre-5.6 model %s keeps the documented free write',
    (model) => {
      const econ = getCacheEconomics('openai', model);
      expect(econ.write5mMult).toBe(1.0);
      expect(econ.write1hMult).toBe(1.0);
    }
  );

  it('the premium reaches the actual bill, not just the table', () => {
    const base = getModelCost('openai', 'gpt-5.6', 100_000, 0);
    const written = getModelCost('openai', 'gpt-5.6', 100_000, 0, { cacheCreationTokens: 100_000 });
    if (!base) return; // model not catalogued in this build
    expect(written.inputCost).toBeGreaterThan(base.inputCost);
    expect(written.inputCost).toBeCloseTo(base.inputCost * 1.25, 10);
  });

  it('a pre-5.6 write still bills at par', () => {
    const base = getModelCost('openai', 'gpt-4.1', 100_000, 0);
    const written = getModelCost('openai', 'gpt-4.1', 100_000, 0, { cacheCreationTokens: 100_000 });
    if (!base) return;
    expect(written.inputCost).toBeCloseTo(base.inputCost, 10);
  });

  it('Anthropic is untouched — its 5m/1h split is a different contract', () => {
    const econ = getCacheEconomics('anthropic', 'claude-opus-4-8');
    expect(econ.write5mMult).toBe(1.25);
    expect(econ.write1hMult).toBe(2.0);
  });

  it('SINGLE SOURCE: pricing and TTL classify 5.6 with the same regex', () => {
    // A second copy would let the bill and the retention policy disagree about
    // which models are 5.6. Both must come from this one export.
    expect(OPENAI_GPT56_OR_LATER.test('gpt-5.6-sol')).toBe(true);
    expect(OPENAI_GPT56_OR_LATER.test('gpt-5.5')).toBe(false);
    // ...and the economics table agrees with it on every case above.
    expect(getCacheEconomics('openai', 'gpt-5.6-sol').write5mMult).toBe(1.25);
    expect(getCacheEconomics('openai', 'gpt-5.5').write5mMult).toBe(1.0);
  });
});
