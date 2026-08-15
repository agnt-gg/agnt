/**
 * DynamicChain — the router's decision logic.
 *
 * These tests are the reason the module is pure: every case below runs with no
 * provider account, no database and no network, which is what makes it
 * possible to assert on the ECONOMICS rather than on mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  selectEligible,
  estimateCost,
  estimateSwitchCost,
  estimateQualityPrior,
  scoreCandidates,
  buildDynamicChain,
  MAX_FALLBACKS,
  UNKNOWN_QUALITY_PRIOR,
} from './DynamicChain.js';
import { classifyIntent } from './routingIntent.js';

const cheap = {
  provider: 'anthropic', model: 'haiku',
  inputCostPer1M: 1, outputCostPer1M: 5,
  contextWindow: 200000, maxOutputTokens: 8192,
  supportsVision: true, supportsTools: true, reasoning: false,
  cacheReadMult: 0.1, cacheKnown: true,
};
const dear = {
  provider: 'openai', model: 'big',
  inputCostPer1M: 30, outputCostPer1M: 120,
  contextWindow: 400000, maxOutputTokens: 32000,
  supportsVision: true, supportsTools: true, reasoning: true,
  cacheReadMult: 0.5, cacheKnown: true,
};
const blind = { ...cheap, provider: 'groq', model: 'text-only', supportsVision: false };
const toolless = { ...cheap, provider: 'cerebras', model: 'no-tools', supportsTools: false };
const tiny = { ...cheap, provider: 'gemini', model: 'small-ctx', contextWindow: 8000, maxOutputTokens: 2000 };

const intentOf = (over = {}) => classifyIntent({ origin: 'orchestrator', contextTokens: 10000, ...over });

describe('ELIGIBILITY is a hard filter, and it explains itself', () => {
  it('drops a vision-incapable model only when the turn carries an image', () => {
    const withImage = selectEligible([cheap, blind], intentOf({ hasImages: true }));
    expect(withImage.eligible.map((c) => c.model)).toEqual(['haiku']);
    expect(withImage.rejected[0].reason).toMatch(/vision/);

    // ...and never excludes it from ordinary text work it can plainly do.
    const noImage = selectEligible([cheap, blind], intentOf({ hasImages: false }));
    expect(noImage.eligible).toHaveLength(2);
  });

  it('drops a tool-incapable model when tools are bound', () => {
    const r = selectEligible([cheap, toolless], intentOf({ hasTools: true }));
    expect(r.eligible.map((c) => c.provider)).toEqual(['anthropic']);
    expect(r.rejected[0].reason).toMatch(/tool/);
  });

  it('leaves headroom for the answer, not just the prompt', () => {
    // 10k of prompt fits in an 8k window only if you forget the response.
    const r = selectEligible([cheap, tiny], intentOf({ contextTokens: 10000 }));
    expect(r.eligible.map((c) => c.provider)).toEqual(['anthropic']);
    expect(r.rejected[0].reason).toMatch(/context/);
  });

  it('drops uncredentialed and unhealthy providers', () => {
    const r = selectEligible(
      [{ ...cheap, credentialed: false }, { ...dear, healthy: false }],
      intentOf()
    );
    expect(r.eligible).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['no credential stored', 'provider unhealthy']);
  });

  it('every rejection names a reason (an unexplained router is a broken one)', () => {
    const r = selectEligible([blind, toolless, tiny], intentOf({ hasImages: true, hasTools: true }));
    expect(r.rejected.length).toBeGreaterThan(0);
    for (const x of r.rejected) expect(typeof x.reason).toBe('string');
  });
});

describe('COST — unknown is never zero', () => {
  it('prices a normal model from published rates', () => {
    const c = estimateCost(cheap, { contextTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(c).toBeCloseTo(6, 6); // 1 in + 5 out
  });

  it('returns null (not 0) for an unpriced model', () => {
    expect(estimateCost({ ...cheap, inputCostPer1M: null }, { contextTokens: 1000 })).toBeNull();
  });

  it('an unpriced model does NOT win on price', () => {
    // The failure this prevents: a null cost treated as free beats every
    // priced competitor forever, and the router quietly converges on the
    // models it knows least about.
    const unpriced = { ...dear, provider: 'mystery', model: 'unpriced', inputCostPer1M: null, outputCostPer1M: null };
    const scored = scoreCandidates([cheap, dear, unpriced], { intent: intentOf(), lambda: 0.85 });
    expect(scored[0].provider).toBe('anthropic');
    const m = scored.find((s) => s.provider === 'mystery');
    expect(m.estimatedCostUsd).toBeNull();
    expect(m.costKnown).toBe(false);
  });

  it('a subscription seat with a notional rate prices at that rate, not zero', () => {
    // The seat has zero MARGINAL dollars per call (that is what the ledger
    // records) but the ROUTER treats the seat as an opportunity cost, or it
    // routes every turn to the seat and burns its weekly quota as if it were
    // free. See SUBSCRIPTION_NOTIONAL_USD_PER_1M in providerConfigs.js.
    const seat = {
      ...dear, provider: 'claude-code', model: 'seat',
      subscription: true, notionalCostPer1M: 0.60,
    };
    // 5000 in + 800 out (DEFAULT_OUTPUT_TOKENS) * $0.60/M = 0.00348
    const c = estimateCost(seat, { contextTokens: 5000 });
    expect(c).toBeCloseTo((5000 + 800) / 1e6 * 0.60, 8);
    expect(c).toBeGreaterThan(0);
  });

  it('a free-tier seat still prices at zero (gemini-cli, antigravity)', () => {
    // Zero is a real number and wins comparisons — which is correct for a
    // genuinely free tier. This is distinct from an UNKNOWN seat, which must
    // return null and take the unknown-cost path.
    const free = {
      ...dear, provider: 'gemini-cli', model: 'gemini-2.5-pro',
      subscription: true, notionalCostPer1M: 0,
    };
    expect(estimateCost(free, { contextTokens: 5000 })).toBe(0);
  });

  it('an UNKNOWN seat returns null, not zero — never re-introduce the bug', () => {
    // The safe default for a seat we haven't priced yet (e.g. grok-build,
    // whose xAI plan publishes no accounting). Zero would put every unknown
    // seat back into "infinitely cheaper than everything" — which is the
    // exact bug the notional-rate table exists to prevent. Null puts it on
    // the unknown-cost path (pool median), which lets a metered competitor
    // beat it on price.
    const unpricedSeat = {
      ...dear, provider: 'grok-build', model: 'seat',
      subscription: true, notionalCostPer1M: null,
    };
    expect(estimateCost(unpricedSeat, { contextTokens: 5000 })).toBeNull();
  });

  it('the reason string names the seat\'s economics honestly', () => {
    const paid = { ...cheap, provider: 'claude-code', model: 's', subscription: true, notionalCostPer1M: 0.60 };
    const free = { ...cheap, provider: 'gemini-cli', model: 'g', subscription: true, notionalCostPer1M: 0 };

    // Paid seat beats a metered competitor and says why + at what rate.
    const paidScored = scoreCandidates([paid, dear], { intent: intentOf(), lambda: 0.5 });
    expect(paidScored[0].provider).toBe('claude-code');
    expect(paidScored[0].reason).toBe('included in plan (~$0.60/M notional)');

    // Free seat gets its own reason, because "free tier" is a routing fact.
    const freeScored = scoreCandidates([free, dear], { intent: intentOf(), lambda: 0.5 });
    expect(freeScored[0].provider).toBe('gemini-cli');
    expect(freeScored[0].reason).toBe('included in plan (free tier)');
  });

  it('THE DIAL: a metered model can now BEAT a seat when quality matters', () => {
    // The regression this notional cost fixes. Before: a seat priced at $0
    // dominated every metered model at every λ, so all three policy modes
    // returned the same answer whenever a seat was in the pool. After: the
    // seat's notional rate ($0.60/M for Claude Code) puts it back into a real
    // trade-off with metered options.
    //
    // Setup: a Claude-Code seat vs a cheap-but-weaker metered model vs a
    // strong metered model. Under "quality" (λ=0.2, stake=high) the frontier
    // metered model should win despite costing real dollars, because seat
    // notional isn't infinite savings anymore.
    const seat = { ...cheap, provider: 'claude-code', model: 'seat-sonnet', subscription: true, notionalCostPer1M: 0.60, reasoning: false };
    const strong = { ...dear, provider: 'openai', model: 'gpt-5', reasoning: true, contextWindow: 400000 };
    const highStake = classifyIntent({ origin: 'goal_eval', contextTokens: 10000 });

    const quality = scoreCandidates([seat, strong], { intent: highStake, lambda: 0.2 });
    expect(quality[0].provider).toBe('openai');

    // And under "save money" (λ=0.85) the seat still wins on price — the
    // notional rate is cheap, just not free.
    const save = scoreCandidates([seat, strong], { intent: intentOf(), lambda: 0.85 });
    expect(save[0].provider).toBe('claude-code');
  });

  it('a seat with no notional field falls to the unknown path, not to zero', () => {
    // Belt and braces: even if routingCandidates ever forgets to attach
    // notionalCostPer1M, the router must NOT re-award "infinite savings" to
    // the seat. It must fall through to the unknown-cost path.
    const legacySeat = { ...cheap, provider: 'kimi-code', model: 'seat', subscription: true };
    expect(estimateCost(legacySeat, { contextTokens: 5000 })).toBeNull();
  });
});

describe('SWITCH COST — the term nobody else has', () => {
  const session = {
    lastProvider: 'anthropic', lastModel: 'haiku',
    cachedTokens: 40000, lastCacheReadMult: 0.1, lastInputCostPer1M: 3,
  };

  it('staying on the warm provider costs nothing', () => {
    expect(estimateSwitchCost(cheap, { contextTokens: 40000 }, session)).toBe(0);
  });

  it('leaving a warm provider costs the discount you gave up', () => {
    const c = estimateSwitchCost(dear, { contextTokens: 40000 }, session);
    expect(c).toBeCloseTo((40000 / 1e6) * 3 * 0.9, 8);
  });

  it('charges nothing when the discount is UNKNOWN rather than guessing one', () => {
    // Inventing a cache discount for a provider that may not give one would
    // manufacture a reason to stay put — the same silent-default defect this
    // codebase already removed from its pricing layer.
    expect(estimateSwitchCost({ ...dear, cacheKnown: false }, { contextTokens: 40000 }, session)).toBe(0);
  });

  it('charges nothing with no session, and nothing with nothing warm', () => {
    expect(estimateSwitchCost(dear, { contextTokens: 1000 }, {})).toBe(0);
    expect(estimateSwitchCost(dear, { contextTokens: 1000 }, { ...session, cachedTokens: 0 })).toBe(0);
  });

  it('cache warmth can outrank a nominally cheaper model', () => {
    // The measured case: a 6.2x swing decided by which node served the turn,
    // with no model change at all. A router blind to this "saves money" by
    // moving off a hot prefix and spends more.
    const warmDear = { ...dear, inputCostPer1M: 4, outputCostPer1M: 8 };
    const coldCheap = { ...cheap, provider: 'groq', model: 'cold', inputCostPer1M: 3, outputCostPer1M: 6 };
    const hotSession = {
      lastProvider: 'openai', cachedTokens: 200000,
      lastCacheReadMult: 0.1, lastInputCostPer1M: 4,
    };
    const scored = scoreCandidates([warmDear, coldCheap], {
      intent: intentOf({ contextTokens: 200000 }),
      lambda: 0.85,
      session: hotSession,
    });
    expect(scored[0].provider).toBe('openai');
    expect(scored[0].reason).toBe('cache-warm');
  });
});

describe('UNKNOWN QUALITY IS LOUD, and gets sampled', () => {
  it('an unmeasured model is flagged, not silently scored', () => {
    const scored = scoreCandidates([cheap], { intent: intentOf(), lambda: 0.5 });
    expect(scored[0].qualityKnown).toBe(false);
    expect(scored[0].quality).toBeGreaterThan(0);
  });

  it('a measured model reports qualityKnown', () => {
    const scored = scoreCandidates([{ ...cheap, quality: 0.99 }], { intent: intentOf(), lambda: 0.5 });
    expect(scored[0].qualityKnown).toBe(true);
    expect(scored[0].quality).toBe(0.99);
  });

  it('the prior is built from capability facts, not price', () => {
    const a = estimateQualityPrior({ reasoning: true, contextWindow: 400000 });
    const b = estimateQualityPrior({ reasoning: false, contextWindow: 8000 });
    expect(a).toBeGreaterThan(b);
    expect(estimateQualityPrior({})).toBeCloseTo(UNKNOWN_QUALITY_PRIOR, 6);

    // Price must not move the prior at all — otherwise the objective becomes
    // "S = f(price) - λ·price", a tunable price point wearing a costume.
    const rich = estimateQualityPrior({ inputCostPer1M: 500, outputCostPer1M: 900 });
    const poor = estimateQualityPrior({ inputCostPer1M: 0.01, outputCostPer1M: 0.02 });
    expect(rich).toBe(poor);
  });
});

describe('POLICY moves the answer', () => {
  it('save picks the cheap model, quality picks the strong one', () => {
    const intent = intentOf();
    expect(scoreCandidates([cheap, dear], { intent, lambda: 0.85 })[0].provider).toBe('anthropic');
    expect(scoreCandidates([cheap, dear], { intent, lambda: 0.2 })[0].provider).toBe('openai');
  });

  it('stake moves the answer independently of policy', () => {
    const low = scoreCandidates([cheap, dear], { intent: classifyIntent({ origin: 'insight', contextTokens: 10000 }), lambda: 0.5 });
    const high = scoreCandidates([cheap, dear], { intent: classifyIntent({ origin: 'goal_eval', contextTokens: 10000 }), lambda: 0.5 });
    expect(low[0].provider).toBe('anthropic');
    expect(high[0].provider).toBe('openai');
  });

  it('a low-stake background job never lands on the frontier model', () => {
    // The largest unclaimed saving in the product: background work inheriting
    // the account default and running at frontier prices with nobody waiting.
    const scored = scoreCandidates([cheap, dear], {
      intent: classifyIntent({ origin: 'insight', contextTokens: 5000 }),
      lambda: 0.5,
    });
    expect(scored[0].provider).toBe('anthropic');
    expect(scored[0].reason).toBe('low stake — cheapest capable');
  });
});

describe('THE CHAIN — ranking IS the failover chain', () => {
  const third = { ...cheap, provider: 'gemini', model: 'flash', inputCostPer1M: 2, outputCostPer1M: 6 };

  it('returns tiers in the shape the executor already consumes', () => {
    const chain = buildDynamicChain({
      intent: intentOf(), candidates: [cheap, dear, third], policy: { lambda: 0.5 }, hint: {},
    });
    expect(chain[0]).toMatchObject({ tier: 0, primary: true });
    chain.slice(1).forEach((t, i) => expect(t).toMatchObject({ tier: i + 1, primary: false }));
    for (const t of chain) {
      expect(typeof t.provider).toBe('string');
      expect(t.model).toBeTruthy();
    }
  });

  it('never repeats a provider — three models on one dead vendor is three ways to lose', () => {
    const sameVendor = [
      cheap,
      { ...cheap, model: 'haiku-2' },
      { ...cheap, model: 'haiku-3' },
      dear,
    ];
    const chain = buildDynamicChain({ intent: intentOf(), candidates: sameVendor, policy: { lambda: 0.5 }, hint: {} });
    const providers = chain.map((t) => t.provider);
    expect(new Set(providers).size).toBe(providers.length);
  });

  it('respects the fallback ceiling', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...cheap, provider: `p${i}`, model: `m${i}` }));
    const chain = buildDynamicChain({ intent: intentOf(), candidates: many, policy: { lambda: 0.5 }, hint: {} });
    expect(chain.length).toBeLessThanOrEqual(MAX_FALLBACKS + 1);
  });

  it('carries an audit trail on tier 0 only', () => {
    const chain = buildDynamicChain({
      intent: intentOf({ hasImages: true }),
      candidates: [cheap, blind, dear],
      policy: { lambda: 0.5 },
      hint: {},
    });
    expect(chain[0].rejected.length).toBeGreaterThan(0);
    expect(chain[0].consideredCount).toBe(2);
    chain.slice(1).forEach((t) => expect(t.rejected).toBeUndefined());
  });

  it('every tier explains itself', () => {
    const chain = buildDynamicChain({ intent: intentOf(), candidates: [cheap, dear, third], policy: { lambda: 0.5 }, hint: {} });
    for (const t of chain) expect(t.reason).toBeTruthy();
    chain.slice(1).forEach((t) => expect(t.reason).toMatch(/^backup: /));
  });
});

describe('DEGRADATION — an optimiser must never fail a request', () => {
  it('falls back to the user default when nothing is eligible', () => {
    const chain = buildDynamicChain({
      intent: intentOf({ hasImages: true }),
      candidates: [blind],
      policy: { lambda: 0.5 },
      hint: { provider: 'anthropic', model: 'claude-sonnet' },
    });
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet', tier: 0, primary: true });
    expect(chain[0].score).toBeNull();
    expect(chain[0].reason).toMatch(/no eligible candidate/);
  });

  it('falls back with an empty or junk candidate list', () => {
    for (const candidates of [[], null, undefined, [null, {}, 'nope']]) {
      const chain = buildDynamicChain({
        intent: intentOf(), candidates, policy: { lambda: 0.5 },
        hint: { provider: 'openai', model: 'gpt' },
      });
      expect(chain[0].provider).toBe('openai');
    }
  });
});
