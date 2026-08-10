import { describe, it, expect } from 'vitest';
import { registerDynamicPricingFromModels, getModelMetadata, isCachedRateKnown } from './providerConfigs.js';
import GenericProviderService from './providers/GenericProviderService.js';

/**
 * xAI publishes per-model cached pricing, and we were throwing it away.
 *
 * Measured 2026-08-08: 11 of grokai's 15 catalogued models had no cached-read
 * price, so their cache hits billed at full rate. The obvious fix — a family
 * multiplier like Groq's 0.5x — is WRONG for xAI, because its cached rates
 * differ per model (grok-4.3 is 0.1x of input, grok-4.20 is 0.16x).
 *
 * The right fix turned out to require no guessing at all: verified live
 * 2026-08-10, the ordinary /v1/models response AGNT already fetches carries
 * `cached_prompt_text_token_price` on every model. It was being dropped
 * because xAI puts rates in FLAT top-level fields while the transform only
 * preserved a nested `pricing` object.
 *
 * The fixture below is a verbatim entry from that live response.
 */

// Real api.x.ai/v1/models entry, captured 2026-08-10.
const XAI_MODEL = {
  id: 'grok-4.20-0309-non-reasoning',
  aliases: ['grok-4.20-non-reasoning'],
  context_length: 2000000,
  created: 1772668800,
  object: 'model',
  owned_by: 'xai',
  prompt_text_token_price: 12500,
  cached_prompt_text_token_price: 2000,
  prompt_image_token_price: 12500,
  completion_text_token_price: 25000,
  prompt_text_token_price_long_context: 25000,
  cached_prompt_text_token_price_long_context: 4000,
  completion_text_token_price_long_context: 50000,
  long_context_threshold: 128000,
};

describe('GenericProviderService default transform preserves xAI rates', () => {
  const svc = new GenericProviderService({ key: 'grokai', name: 'Grok', baseURL: 'https://api.x.ai/v1' });

  it('keeps the flat per-token price fields', () => {
    const out = svc._defaultTransform(XAI_MODEL);
    expect(out.prompt_text_token_price).toBe(12500);
    expect(out.cached_prompt_text_token_price).toBe(2000);
    expect(out.completion_text_token_price).toBe(25000);
  });

  it('still maps the ordinary fields', () => {
    const out = svc._defaultTransform(XAI_MODEL);
    expect(out.id).toBe('grok-4.20-0309-non-reasoning');
    expect(out.contextLength).toBe(2000000);
    expect(out.ownedBy).toBe('xai');
  });

  it('ANTI-VACUITY: a model with no price fields gains none', () => {
    const out = svc._defaultTransform({ id: 'plain-model', object: 'model' });
    expect('prompt_text_token_price' in out).toBe(false);
    expect('cached_prompt_text_token_price' in out).toBe(false);
  });

  it('ignores non-numeric junk rather than registering NaN', () => {
    const out = svc._defaultTransform({ id: 'x', prompt_text_token_price: 'free' });
    expect('prompt_text_token_price' in out).toBe(false);
  });
});

describe('registerDynamicPricingFromModels understands the xAI spelling', () => {
  it('converts 1e-10-dollars-per-token to dollars per million', () => {
    const id = 'xai-unit-probe-model';
    registerDynamicPricingFromModels('grokai', [{ ...XAI_MODEL, id }]);
    const meta = getModelMetadata('grokai', id);
    // 12500 / 10_000 = 1.25 $/M — the published grok-4.20 input rate.
    expect(meta.inputCostPer1M).toBeCloseTo(1.25, 10);
    expect(meta.outputCostPer1M).toBeCloseTo(2.5, 10);
    // 2000 / 10_000 = 0.20 $/M, i.e. 0.16x of input — NOT any family constant.
    expect(meta.inputCacheReadCostPer1M).toBeCloseTo(0.2, 10);
  });

  it('makes the cached rate KNOWN for a model that had none', () => {
    const id = 'xai-unpriced-until-now';
    expect(isCachedRateKnown('grokai', id)).toBe(false); // grokai has no family row, by design
    registerDynamicPricingFromModels('grokai', [{ ...XAI_MODEL, id }]);
    expect(isCachedRateKnown('grokai', id)).toBe(true);
  });

  it('preserves per-model differences instead of flattening to a multiplier', () => {
    // grok-4.3 publishes a different ratio to grok-4.20. A family constant
    // would have to be wrong for one of them.
    registerDynamicPricingFromModels('grokai', [
      { ...XAI_MODEL, id: 'xai-ratio-a', prompt_text_token_price: 12500, cached_prompt_text_token_price: 2000 },
      { ...XAI_MODEL, id: 'xai-ratio-b', prompt_text_token_price: 30000, cached_prompt_text_token_price: 3000 },
    ]);
    const a = getModelMetadata('grokai', 'xai-ratio-a');
    const b = getModelMetadata('grokai', 'xai-ratio-b');
    expect(a.inputCacheReadCostPer1M / a.inputCostPer1M).toBeCloseTo(0.16, 6);
    expect(b.inputCacheReadCostPer1M / b.inputCostPer1M).toBeCloseTo(0.10, 6);
  });

  it('does not disturb the OpenRouter per-token spelling', () => {
    const id = 'vendor/openrouter-shape-probe';
    registerDynamicPricingFromModels('openrouter', [{
      id,
      pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001' },
    }]);
    const meta = getModelMetadata('openrouter', id);
    expect(meta.inputCostPer1M).toBeCloseTo(1.0, 10);
    expect(meta.outputCostPer1M).toBeCloseTo(5.0, 10);
    expect(meta.inputCacheReadCostPer1M).toBeCloseTo(0.1, 10);
  });

  it('does not disturb the Together AI dollars-per-million spelling', () => {
    const id = 'together-shape-probe';
    registerDynamicPricingFromModels('togetherai', [{ id, pricing: { input: 0.8, output: 2.4 } }]);
    const meta = getModelMetadata('togetherai', id);
    expect(meta.inputCostPer1M).toBeCloseTo(0.8, 10);
    expect(meta.outputCostPer1M).toBeCloseTo(2.4, 10);
  });
});
