// The metadata lookups PRD-122 added to the EXISTING pricing system.
//
// The rule under test: there is one place prices live. New models enter
// through registerDynamicPricing (fed by catalog fetches) or static provider
// tables — never through a parallel price list. These specs pin the three
// mechanics that make that sufficient: normalised-name matching (one model,
// many spellings), provider-published cached rates beating the family
// multiplier, and the kimi-code seats carrying real notional rates.
import { describe, it, expect } from 'vitest';
import {
  getModelCost,
  getModelMetadata,
  registerDynamicPricing,
  registerDynamicPricingFromModels,
  hydrateDynamicPricing,
  normalizeModelKey,
} from './providerConfigs.js';

describe('normalizeModelKey', () => {
  it('collapses vendor prefixes and dot/dash spelling so one model has one identity', () => {
    // grokai/grok-4.3, <uuid> + xai/grok-4.3, openrouter + x-ai/grok-4.3 are
    // the same model; catalogs also disagree on claude-sonnet-4.5 vs -4-5.
    expect(normalizeModelKey('xai/grok-4.3')).toBe('grok-4-3');
    expect(normalizeModelKey('grok-4.3')).toBe('grok-4-3');
    expect(normalizeModelKey('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
    expect(normalizeModelKey('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(normalizeModelKey('MOONSHOTAI/Kimi-K3')).toBe('kimi-k3');
  });

  it('survives junk without throwing', () => {
    expect(normalizeModelKey(null)).toBe('');
    expect(normalizeModelKey(undefined)).toBe('');
    expect(normalizeModelKey('')).toBe('');
  });
});

describe('normalised catalog fallback (getModelMetadata step 5)', () => {
  it('resolves a custom-UUID provider through a catalog entry registered under another', () => {
    registerDynamicPricing('openrouter', 'test-vendor/np-test-model-4.2', {
      inputCostPer1M: 2.0,
      outputCostPer1M: 8.0,
    });

    // Exact keys all miss — UUID provider, vendor-prefixed model — but the
    // normalised name matches the catalog entry.
    const meta = getModelMetadata('11111111-2222-3333-4444-555555555555', 'other-vendor/np-test-model-4.2');
    expect(meta).toBeTruthy();
    expect(meta.inputCostPer1M).toBe(2.0);
  });

  it('never shadows an exact static entry', () => {
    // A catalog entry whose BASENAME matches a static model must lose to the
    // static table: exact beats normalised, always.
    registerDynamicPricing('openrouter', 'evil-vendor/gpt-5.2', {
      inputCostPer1M: 999,
      outputCostPer1M: 999,
    });
    const meta = getModelMetadata('openai', 'gpt-5.2');
    expect(meta.inputCostPer1M).toBe(1.75); // openai's static table, not 999
  });

  it('returns null when nothing anywhere knows the model', () => {
    expect(getModelMetadata('nowhere', 'model-that-no-catalog-lists')).toBeNull();
  });

  it('resolves router spellings of first-party models against the STATIC tables', () => {
    // openrouter offers anthropic/claude-haiku-4-5-20251001; anthropic's own
    // table has the bare dated id. No dynamic entry involved — the normalised
    // scan must reach static metadata or every router spelling of a known
    // model prices as unknown.
    const meta = getModelMetadata('openrouter', 'anthropic/claude-haiku-4-5-20251001');
    expect(meta).toBeTruthy();
    expect(meta.inputCostPer1M).toBe(1);
    expect(meta.outputCostPer1M).toBe(5);
  });
});

describe('a match that cannot price never shadows one that can', () => {
  // THE defect this guards. ~250 of the persisted catalog rows are
  // context-window-only entries captured from providers that publish no
  // prices, and boot hydrates them BEFORE the priced catalog sync. The lookup
  // chain returned the first candidate outright, so the priceless row won at
  // step 3 and the search stopped — leaving models unpriced whose price was
  // already in memory one step further down. Measured against the live model
  // lists this alone accounted for ~26 offered models.

  it('prefers a priced entry over an earlier priceless one for the same model', () => {
    // Arrives first, as hydration would deliver it: real contextWindow, no rates.
    registerDynamicPricing('shadowprov', 'shadow-model-1', { contextWindow: 128000 });
    // Arrives second, as the catalog sync would: the actual price.
    registerDynamicPricing('otherprov', 'shadow-model-1', {
      contextWindow: 128000, inputCostPer1M: 3, outputCostPer1M: 9,
    });

    const cost = getModelCost('shadowprov', 'shadow-model-1', 1e6, 1e6);
    expect(cost).toBeTruthy();
    expect(cost.totalCost).toBeCloseTo(12, 10);
  });

  it('still returns the priceless entry when nothing anywhere can price it', () => {
    // It carries a real contextWindow, which the context budgeter needs even
    // when the ledger cannot cost the call.
    registerDynamicPricing('lonelyprov', 'lonely-model', { contextWindow: 64000 });
    const meta = getModelMetadata('lonelyprov', 'lonely-model');
    expect(meta).toBeTruthy();
    expect(meta.contextWindow).toBe(64000);
    expect(getModelCost('lonelyprov', 'lonely-model', 1000, 1000)).toBeNull();
  });

  it('resolves a pinned release snapshot to its base model', () => {
    // OpenAI serves gpt-4o AND gpt-4o-2024-08-06; Gemini serves
    // gemini-2.0-flash AND gemini-2.0-flash-001. Same model, same price —
    // enumerating every snapshot by hand falls behind on every release.
    const base = getModelCost('openai', 'gpt-4o', 1e6, 1e6);
    const pinned = getModelCost('openai', 'gpt-4o-2024-08-06', 1e6, 1e6);
    expect(pinned).toBeTruthy();
    expect(pinned.totalCost).toBeCloseTo(base.totalCost, 10);

    // ...including the 2-character o-series, which a stricter length guard
    // silently excluded.
    const o3 = getModelCost('openai', 'o3', 1e6, 1e6);
    const o3pinned = getModelCost('openai', 'o3-2025-04-16', 1e6, 1e6);
    expect(o3pinned).toBeTruthy();
    expect(o3pinned.totalCost).toBeCloseTo(o3.totalCost, 10);
  });

  it('never reduces a version-bearing name to its bare prefix', () => {
    // 'grok-3' must not become 'grok'.
    expect(getModelMetadata('grokai', 'grok-3')).toBeTruthy();
    expect(getModelMetadata('nowhere', 'grok')).toBeNull();
  });

  it('parses published pricing given as $/M under input/output keys', () => {
    // Together AI and several OpenAI-compatible hosts spell it this way
    // instead of OpenRouter's per-token prompt/completion. Parsing only one
    // shape discards the other provider’s prices even though they arrived.
    registerDynamicPricingFromModels('shapeprov', [
      { id: 'dollars-per-million-model', pricing: { input: 0.18, output: 0.59 } },
    ]);
    const c = getModelCost('shapeprov', 'dollars-per-million-model', 1e6, 1e6);
    expect(c).toBeTruthy();
    expect(c.inputCost).toBeCloseTo(0.18, 10);
    expect(c.outputCost).toBeCloseTo(0.59, 10);
  });

  it('prices every model a flat-rate seat exposes, at a truthful $0', () => {
    // Cursor publishes ~190 routing aliases and meters none of them. Each new
    // alias would otherwise read as an unpriced call forever.
    for (const alias of ['gpt-5.3-codex-xhigh-fast', 'claude-opus-5-thinking-high', 'kimi-k3-high']) {
      const c = getModelCost('cursor-cli', alias, 1e6, 1e6);
      expect(c, alias).toBeTruthy();
      expect(c.totalCost, alias).toBe(0);
    }
  });
});

describe('published pricing survives the default model transform', () => {
  // THE defect: GenericProviderService._defaultTransform emitted only
  // id/name/description/createdAt/ownedBy and DISCARDED `pricing`. Every
  // provider without a custom modelTransform therefore lost the rates it had
  // already sent us — Together AI publishes { input, output } in $/M on every
  // model, and all 108 of its chat models read as "unpriced" downstream. The
  // data arrived and was deleted before anything could read it.

  it('keeps the rates a provider publishes, end to end', async () => {
    const { default: GenericProviderService } = await import('./providers/GenericProviderService.js');
    const svc = new GenericProviderService({ name: 'T', baseURL: 'x', responseDataPath: 'root' });

    // Together's real published shape.
    const rawModel = {
      id: 'vendor/published-price-model',
      created: 1733506314,
      context_length: 131072,
      pricing: { hourly: 0, input: 0.6, output: 1.8, base: 0 },
    };

    const transformed = svc.transformModel(rawModel);
    expect(transformed.pricing).toEqual(rawModel.pricing);
    expect(transformed.contextLength).toBe(131072);

    registerDynamicPricingFromModels('publishprov', [transformed]);
    const cost = getModelCost('publishprov', 'vendor/published-price-model', 1e6, 1e6);
    expect(cost).toBeTruthy();
    expect(cost.inputCost).toBeCloseTo(0.6, 10);
    expect(cost.outputCost).toBeCloseTo(1.8, 10);
  });

  it('leaves a provider that publishes nothing exactly as it was', async () => {
    // The transform feeds the model picker too, so a provider with no pricing
    // must produce the identical object shape it always did.
    const { default: GenericProviderService } = await import('./providers/GenericProviderService.js');
    const svc = new GenericProviderService({ name: 'T', baseURL: 'x' });
    expect(svc.transformModel({ id: 'plain', created: 1, owned_by: 'x' })).toEqual({
      id: 'plain', name: 'plain', description: '', createdAt: 1, ownedBy: 'x',
    });
  });
});

describe('every offered model prices', () => {
  it('getModelCost answers (possibly $0) for every recommended/fallback/static model', async () => {
    // Nathan's bar: no model AGNT offers may price as UNKNOWN. $0 is a valid
    // answer (subscription seats); null is not. New models enter through the
    // catalog sync or a static entry — this test is what fails when someone
    // adds an offering without either.
    const { getAllProviderConfigs } = await import('./providerConfigs.js');
    const unpriced = [];
    let audited = 0;
    for (const cfg of getAllProviderConfigs()) {
      const models = new Set([
        ...(cfg.recommendedModels || []),
        ...(cfg.fallbackModels || []),
        ...(cfg.fallbackVisionModels || []),
        ...Object.keys(cfg.modelMetadata || {}),
      ]);
      for (const m of models) {
        audited += 1;
        // The openrouter defaults are priced by the live catalog sync, which
        // tests must not depend on the network for — seed-equivalent entries.
        if (cfg.key === 'openrouter') {
          registerDynamicPricing('openrouter', m, { inputCostPer1M: 1, outputCostPer1M: 1 });
        }
        if (!getModelCost(cfg.key, m, 1e6, 1e6)) unpriced.push(`${cfg.key}/${m}`);
      }
    }
    expect(audited).toBeGreaterThan(100); // anti-vacuity: the audit walked a real surface
    expect(unpriced).toEqual([]);
  });
});

describe('provider-published cached rates', () => {
  it('uses the explicit cached-read price when metadata carries one', () => {
    registerDynamicPricing('openrouter', 'cache-rate-test/model-x', {
      inputCostPer1M: 1.0,
      outputCostPer1M: 4.0,
      inputCacheReadCostPer1M: 0.1,
    });

    const cost = getModelCost('openrouter', 'cache-rate-test/model-x', 1_000_000, 0, {
      cacheReadTokens: 900_000,
    });
    // 100k uncached at $1/1M + 900k cached at $0.10/1M — NOT 900k at the
    // family multiplier (which for "other" providers is 1.0x and would have
    // billed the reads at ten times the published rate).
    expect(cost.totalCost).toBeCloseTo((100_000 * 1.0 + 900_000 * 0.1) / 1e6, 12);
  });

  it('falls back to the family multiplier when no cached rate is published', () => {
    // Anthropic's 0.1x read multiplier must be unaffected by this feature.
    const cost = getModelCost('anthropic', 'claude-sonnet-4-5-20250929', 1_000_000, 0, {
      cacheReadTokens: 900_000,
    });
    expect(cost.totalCost).toBeCloseTo((100_000 * 3.0 + 900_000 * 0.3) / 1e6, 12);
  });
});

describe('kimi-code seats carry notional rates, per the claude-code convention', () => {
  it('prices every seat model instead of returning null', () => {
    // These ids exist in no public catalog, so if the static table nulls them
    // the ledger can never state their seat value. SUBSCRIPTION_PROVIDERS
    // keeps them from ever being billed as money.
    for (const [model, inRate] of [
      ['kimi-for-coding', 0.57],
      ['k3', 3.0],
      ['k3-256k', 3.0],
      ['kimi-for-coding-highspeed', 0.73],
    ]) {
      const cost = getModelCost('kimi-code', model, 1_000_000, 0);
      expect(cost, model).not.toBeNull();
      expect(cost.totalCost, model).toBeCloseTo(inRate, 10);
    }
  });
});

describe('hydrateDynamicPricing', () => {
  it('loads persisted rows without re-firing persistence, and fresher memory wins', () => {
    registerDynamicPricing('openrouter', 'hydrate-test/model-a', { inputCostPer1M: 5.0, outputCostPer1M: 5.0 });
    const n = hydrateDynamicPricing([
      // stale persisted copy of the same key — must NOT clobber live memory
      { provider: 'openrouter', model: 'hydrate-test/model-a', metadata: { inputCostPer1M: 1.0, outputCostPer1M: 1.0 } },
      // a key only the store knows — must appear
      { provider: 'openrouter', model: 'hydrate-test/model-b', metadata: { inputCostPer1M: 3.0, outputCostPer1M: 3.0 } },
      null, // corrupt rows are skipped, not fatal
    ]);
    expect(n).toBe(2);
    expect(getModelMetadata('openrouter', 'hydrate-test/model-a').inputCostPer1M).toBe(5.0);
    expect(getModelMetadata('openrouter', 'hydrate-test/model-b').inputCostPer1M).toBe(3.0);
  });
});
