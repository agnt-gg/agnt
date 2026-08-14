/**
 * DynamicChain.js — the router.
 *
 * ── WHY THIS IS A CHAIN BUILDER AND NOT A MODEL PICKER ───────────────────
 * AGNT already executes an ordered list of provider tiers and rolls forward
 * when one fails (ProviderFallback.runWithFallback). A router's natural output
 * is a RANKING. So the router does not need its own execution path, its own
 * retry semantics, or its own cancellation rules: it emits the same shape
 * buildProviderChain already emits, and the existing executor runs it.
 *
 * The consequence is worth stating plainly, because it is the whole design:
 * the router's 2nd and 3rd choices ARE the failover chain. Resilience is not a
 * separate feature bolted next to optimisation — it falls out of ranking. A
 * user who turns this on stops configuring fallbacks by hand and gets a better
 * chain than they would have written, recomputed per turn against live health.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * OBJECTIVE
 *   S = (1-λ)·W·Q̂  −  λ·Ĉ  −  κ·Ĉ_switch  −  τ·L̂
 *
 * Three of those terms are missing from every router in the literature:
 *
 *   W  (stake) — supplied by the caller, never inferred. See routingIntent.js.
 *
 *   Ĉ_switch — the cost of ABANDONING A WARM CACHE. Measured in this codebase:
 *     a cold Grok conversation reused 128 of 39,998 tokens (0.3%) at $0.0499
 *     while the warm path reused 99.8% at $0.0081. A 6.2x swing decided by
 *     nothing but which node served it — larger than most model price gaps.
 *     A router that ignores this will happily "save money" by moving off a hot
 *     prefix and spend more. Modelled explicitly, in dollars, not as a nudge.
 *
 *   Eligible() as a HARD pre-filter, not a weighted preference. A model that
 *     cannot see the image, cannot call the tool, or cannot hold the context
 *     is not an expensive choice, it is an invalid one. Constraints are
 *     evaluated first and cost nothing — they typically collapse a 20-provider
 *     pool to 3, which is most of the value of the whole system and requires
 *     no learning at all.
 *
 * PURITY CONTRACT (same as ProviderFallback.js): no DB, no SSE, no imports
 * beyond this file. Candidates, policy, session and health are INJECTED. This
 * is what makes the router exhaustively testable without a provider account.
 */

/**
 * Chain ceiling. Mirrors ProviderFallback.MAX_FALLBACKS deliberately rather
 * than importing it (that module reaches into ProviderRegistry and this one
 * must stay dependency-free). dynamicChain.conformance.test.js fails if the
 * two ever drift, so the duplication cannot rot silently.
 */
export const MAX_FALLBACKS = 3;

/**
 * κ — how much of a lost cache we actually believe.
 *
 * Below 1.0 because the switch penalty is an ESTIMATE of a future saving, and
 * an estimate weighted as heavily as a known price would pin every
 * conversation to its first provider forever, which is a worse failure than
 * occasionally paying for a cold prefix.
 */
export const SWITCH_PENALTY_WEIGHT = 0.7;

/** τ — latency weight. Small: correctness and cost dominate. */
export const LATENCY_WEIGHT = 0.08;

/**
 * Below this spread, quality is not a differentiator.
 *
 * Quality is min-max normalised across the pool so it competes with cost on
 * the same 0..1 scale. That is necessary — an un-normalised prior lives in a
 * narrow band (~0.5..0.85) and would always lose to a cost term spanning the
 * full range, which silently turns "Best quality" into "cheapest capable".
 *
 * But normalisation also AMPLIFIES noise: two models differing by 0.001 would
 * become 0 and 1. So when the spread is this small the whole quality term is
 * flattened to zero and cost decides — which is the correct answer to "these
 * are indistinguishable", not a fudge.
 */
export const MIN_QUALITY_SPREAD = 0.02;

/**
 * How much cheaper "free" is than the cheapest paid option, on the log scale.
 *
 * A subscription seat has zero marginal cost, and log(0) is undefined, so free
 * needs a floor. Making it one order of magnitude below the cheapest paid model
 * says the true thing — free is decisively better, not infinitely better — and
 * keeps it from swamping the scale the way a literal zero would.
 */
export const FREE_FLOOR_RATIO = 0.1;

/**
 * Explore budget for models we have never measured.
 *
 * A router that only ever picks what it has already measured can never learn
 * that a newly-released model is better, and the lineup turns over monthly. So
 * unknown quality is not punished to zero — it is treated as "probably average"
 * and given a small bonus so it gets sampled. `qualityKnown: false` travels
 * with the candidate so this is visible rather than implied.
 */
export const UNKNOWN_QUALITY_PRIOR = 0.55;
export const EXPLORE_BONUS = 0.05;

/** Output tokens assumed when the caller has no better estimate. */
export const DEFAULT_OUTPUT_TOKENS = 800;

// ── Stage 1: ELIGIBILITY ───────────────────────────────────────────────────

/**
 * Hard constraints. Returns { eligible, rejected } where every rejection
 * carries a human-readable reason — a router that cannot say why it excluded
 * something is indistinguishable from one that is broken.
 *
 * @param {Array} candidates
 * @param {object} intent  from classifyIntent()
 */
export function selectEligible(candidates, intent = {}) {
  const eligible = [];
  const rejected = [];
  const reject = (c, reason) => rejected.push({ provider: c.provider, model: c.model, reason });

  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || typeof c !== 'object' || !c.provider) continue;

    if (c.healthy === false) { reject(c, 'provider unhealthy'); continue; }
    if (c.credentialed === false) { reject(c, 'no credential stored'); continue; }
    if (intent.needsVision && c.supportsVision === false) { reject(c, 'no vision support'); continue; }
    if (intent.needsTools && c.supportsTools === false) { reject(c, 'no tool support'); continue; }

    // Context: leave headroom for the response. A model that fits the prompt
    // exactly cannot answer it.
    if (intent.contextTokens > 0 && Number.isFinite(c.contextWindow)) {
      const needed = intent.contextTokens + Math.min(c.maxOutputTokens || 4096, 8192);
      if (c.contextWindow < needed) { reject(c, 'context window too small'); continue; }
    }

    if (!c.model) { reject(c, 'no model resolved'); continue; }

    eligible.push(c);
  }

  return { eligible, rejected };
}

// ── Stage 2: SCORING ───────────────────────────────────────────────────────

/**
 * Estimated dollar cost of running this turn on this candidate.
 *
 * Returns null when the model has no published price. That is NOT zero and
 * must never be treated as zero — an unpriced model that silently scored as
 * free would win every comparison it entered. Callers put unpriced models on
 * the "unknown" path instead.
 *
 * Subscription providers (a flat-rate seat) genuinely have ~0 marginal cost
 * per call, which is a real and valuable routing fact rather than a modelling
 * shortcut — so they price at 0 and are marked so the reason string can say
 * "included in plan" rather than implying the model is free.
 */
export function estimateCost(candidate, intent = {}) {
  if (candidate.subscription) return 0;
  const inRate = candidate.inputCostPer1M;
  const outRate = candidate.outputCostPer1M;
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate)) return null;

  const inTokens = intent.contextTokens > 0 ? intent.contextTokens : 2000;
  const outTokens = Number.isFinite(intent.outputTokens) && intent.outputTokens > 0
    ? intent.outputTokens
    : DEFAULT_OUTPUT_TOKENS;

  return (inTokens / 1e6) * inRate + (outTokens / 1e6) * outRate;
}

/**
 * Dollars given up by moving off a warm conversation.
 *
 * Only charged when we KNOW the discount (getCacheEconomics reports `known`).
 * Guessing a cache discount for a provider that may not give one would invent
 * a reason to stay put — the same "silent default" defect this codebase
 * already fixed once in its pricing layer.
 */
export function estimateSwitchCost(candidate, intent = {}, session = {}) {
  if (!session || !session.lastProvider) return 0;
  const same = String(session.lastProvider).toLowerCase() === String(candidate.provider).toLowerCase();
  if (same) return 0;                       // staying warm costs nothing
  if (!session.cachedTokens) return 0;      // nothing warm to lose
  if (candidate.cacheKnown === false) return 0;

  const readMult = Number.isFinite(session.lastCacheReadMult) ? session.lastCacheReadMult : 1.0;
  const rate = Number.isFinite(session.lastInputCostPer1M) ? session.lastInputCostPer1M : null;
  if (rate === null || readMult >= 1.0) return 0;   // no discount existed → nothing lost

  const reusable = Math.min(session.cachedTokens, intent.contextTokens || session.cachedTokens);
  return (reusable / 1e6) * rate * (1 - readMult);
}

/**
 * Quality prior for a model nobody has measured yet.
 *
 * Built from CAPABILITY FACTS the registry already publishes, not from price.
 * Price-as-quality is circular in an objective that also subtracts price: it
 * collapses the whole router into a tunable price point wearing a costume.
 */
export function estimateQualityPrior(candidate) {
  let q = UNKNOWN_QUALITY_PRIOR;
  if (candidate.reasoning === true) q += 0.15;
  if (Number.isFinite(candidate.contextWindow)) {
    if (candidate.contextWindow >= 400000) q += 0.10;
    else if (candidate.contextWindow >= 180000) q += 0.06;
    else if (candidate.contextWindow < 32000) q -= 0.10;
  }
  if (candidate.supportsVision) q += 0.02;
  return Math.max(0.05, Math.min(1, q));
}

/**
 * Score every eligible candidate.
 *
 * THREE NORMALISATION RULES. THE THIRD ONE IS THE ONE THAT BITES.
 *
 * 1. Cost and switch-cost are BOTH DOLLARS, so they are added into one
 *    effective cost BEFORE normalising. Normalising them separately (the
 *    obvious first implementation) is wrong: it discards their relative
 *    magnitude, so a trivial cache loss and a catastrophic one both arrive as
 *    "1.0" and the answer collapses into arithmetic on the weights. Adding
 *    first is what lets a genuinely large cache saving outweigh a genuinely
 *    small price gap — which is the entire point of having the term.
 *
 * 2. Quality is normalised across the pool too, so both sides of the trade-off
 *    are scale-free.
 *
 * 3. COST IS NORMALISED ON A LOG SCALE, because price is multiplicative.
 *
 *    Measured on the real 33-model pool this ships against: turn costs span
 *    226x ($0.00106 to $0.24). Under LINEAR min-max the eight cheapest models
 *    — themselves a 5x price range — all compressed into 0.0000..0.0173, i.e.
 *    1.7% of the scale, while their quality differences used the full 0..1.
 *    The single expensive outlier set the scale and flattened everything the
 *    router actually chooses between, so λ had nothing left to weigh and
 *    "Save money" returned the same model as "Best quality". A dial that does
 *    not move is worse than no dial: it reports a choice the user did not get.
 *
 *    Log normalisation states the right invariant — doubling the price feels
 *    the same at $0.001 and at $0.10 — and gives those same eight models
 *    0.0000..0.2928. Only a live pool exposes this; every pool small enough to
 *    write by hand in a unit test behaves identically under both transforms,
 *    which is exactly why this survived the unit suite.
 */
export function scoreCandidates(eligible, { intent = {}, lambda = 0.5, session = {} } = {}) {
  const stakeWeight = Number.isFinite(intent.stakeWeight) ? intent.stakeWeight : 1.0;

  const priced = eligible.map((c) => {
    const cost = estimateCost(c, intent);
    const switchCost = estimateSwitchCost(c, intent, session);
    const qualityKnown = Number.isFinite(c.quality);
    const quality = qualityKnown ? c.quality : estimateQualityPrior(c);
    return { candidate: c, cost, switchCost, quality, qualityKnown };
  });

  // Unpriced models are ranked, never silently treated as free. They sit at
  // the pool's median cost so they compete on quality rather than winning on a
  // price nobody published.
  const knownCosts = priced.map((p) => p.cost).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const medianCost = knownCosts.length
    ? knownCosts[Math.floor(knownCosts.length / 2)]
    : 0;

  // One effective cost per candidate, in dollars: what the turn costs plus the
  // discounted value of the cache it throws away.
  const effectiveCosts = priced.map(
    (p) => (Number.isFinite(p.cost) ? p.cost : medianCost) + SWITCH_PENALTY_WEIGHT * p.switchCost
  );
  const maxCost = Math.max(...effectiveCosts);

  // Log scale, floored so a zero-cost subscription seat is representable.
  //
  // THE FLOOR IS CONDITIONAL, and that detail is load-bearing. Applying it
  // unconditionally reserves the bottom of the scale for a "free" tier that may
  // not exist, which pushes the cheapest PAID model up to ~0.30 and burns 30%
  // of λ's leverage on empty space. Measured: with the floor always on, the
  // real pool put its cheapest model at 0.298 and "Save money" still returned
  // the same answer as "Best quality". Only widen the scale for free when there
  // is actually something free to represent.
  const positiveCosts = effectiveCosts.filter((c) => c > 0);
  const cheapestPaid = positiveCosts.length ? Math.min(...positiveCosts) : 1;
  const hasFreeCandidate = effectiveCosts.some((c) => c <= 0);
  const costFloor = hasFreeCandidate ? cheapestPaid * FREE_FLOOR_RATIO : cheapestPaid;
  const logSpan = maxCost > costFloor ? Math.log(maxCost / costFloor) : 0;
  const normaliseCost = (c) =>
    logSpan > 0 ? Math.log(Math.max(c, costFloor) / costFloor) / logSpan : 0;

  const qualities = priced.map((p) => p.quality + (p.qualityKnown ? 0 : EXPLORE_BONUS));
  const minQuality = Math.min(...qualities);
  const maxQuality = Math.max(...qualities);
  const qualitySpan = maxQuality - minQuality;
  const qualityIsDecisive = qualitySpan >= MIN_QUALITY_SPREAD;

  const latencies = priced.map((p) => (Number.isFinite(p.candidate.latencyMs) ? p.candidate.latencyMs : 0));
  const maxLatency = Math.max(...latencies, 0) || 1;

  return priced
    .map((p, i) => {
      const costNorm = normaliseCost(effectiveCosts[i]);
      const qualityNorm = qualityIsDecisive ? (qualities[i] - minQuality) / qualitySpan : 0;
      const switchNorm = maxCost > 0 ? (SWITCH_PENALTY_WEIGHT * p.switchCost) / maxCost : 0;
      const latencyNorm = (Number.isFinite(p.candidate.latencyMs) ? p.candidate.latencyMs : 0) / maxLatency;

      const qualityTerm = (1 - lambda) * stakeWeight * qualityNorm;
      const costTerm = lambda * costNorm;
      const latencyTerm = LATENCY_WEIGHT * latencyNorm;

      const score = qualityTerm - costTerm - latencyTerm;

      return {
        ...p.candidate,
        score,
        estimatedCostUsd: Number.isFinite(p.cost) ? p.cost : null,
        costKnown: Number.isFinite(p.cost),
        switchCostUsd: p.switchCost,
        quality: p.quality,
        qualityKnown: p.qualityKnown,
        reason: explainChoice(p, { costNorm, switchNorm, lambda, intent, session }),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** One short phrase naming the dominant factor. Never post-hoc reconstructed. */
function explainChoice(p, { costNorm, switchNorm, lambda, intent, session }) {
  const c = p.candidate;
  if (session && session.lastProvider &&
      String(session.lastProvider).toLowerCase() === String(c.provider).toLowerCase() &&
      session.cachedTokens > 0) {
    return 'cache-warm';
  }
  if (c.subscription) return 'included in plan';
  if (intent.stake === 'high') return 'high stake — quality first';
  if (intent.stake === 'low') return 'low stake — cheapest capable';
  if (!p.qualityKnown) return 'unmeasured — sampling';
  if (costNorm <= 0.25 && lambda >= 0.5) return 'cheapest capable';
  if (switchNorm > 0.5) return 'worth the cache switch';
  return 'best value';
}

// ── Stage 3 + 4: RANK INTO A CHAIN, ANNOTATED ──────────────────────────────

/**
 * Build the ordered provider chain for a turn.
 *
 * Tier 0 is the best-scoring candidate. Every later tier must come from a
 * DIFFERENT provider, for the same reason buildProviderChain refuses same-
 * provider fallbacks: a second model on a provider that just went down will
 * almost certainly fail too, so a chain of three models from one vendor is
 * three ways to lose.
 *
 * `hint` (the user's configured default) is honoured in one specific way: if
 * nothing is eligible we return it untouched rather than failing the turn.
 * Routing is an optimisation and must degrade to today's behaviour, never to
 * an error.
 *
 * @returns {{provider,model,tier,primary,reason,score,estimatedCostUsd}[]}
 */
export function buildDynamicChain({
  intent = {},
  candidates = [],
  policy = {},
  session = {},
  hint = {},
  maxFallbacks = MAX_FALLBACKS,
} = {}) {
  const lambda = Number.isFinite(policy.lambda) ? policy.lambda : 0.5;

  const { eligible, rejected } = selectEligible(candidates, intent);

  if (eligible.length === 0) {
    // Nothing qualified. Fall back to the user's own default — an optimiser
    // that can fail the request is worse than no optimiser.
    return [{
      provider: hint.provider,
      model: hint.model || null,
      tier: 0,
      primary: true,
      reason: 'no eligible candidate — using default',
      score: null,
      estimatedCostUsd: null,
      rejected,
    }];
  }

  const scored = scoreCandidates(eligible, { intent, lambda, session });

  const chain = [];
  const usedProviders = new Set();
  for (const cand of scored) {
    if (chain.length > maxFallbacks) break;
    const key = String(cand.provider).toLowerCase();
    if (usedProviders.has(key)) continue;
    usedProviders.add(key);
    chain.push({
      provider: cand.provider,
      model: cand.model,
      tier: chain.length,
      primary: chain.length === 0,
      reason: chain.length === 0 ? cand.reason : `backup: ${cand.reason}`,
      score: cand.score,
      estimatedCostUsd: cand.estimatedCostUsd,
      costKnown: cand.costKnown,
      qualityKnown: cand.qualityKnown,
    });
  }

  // Attach the audit trail to tier 0 only — it describes the DECISION, not the
  // tier, and duplicating it on every tier would bloat every log line.
  if (chain.length > 0) {
    chain[0].rejected = rejected;
    chain[0].consideredCount = eligible.length;
  }

  return chain;
}

export default {
  MAX_FALLBACKS,
  SWITCH_PENALTY_WEIGHT,
  LATENCY_WEIGHT,
  UNKNOWN_QUALITY_PRIOR,
  EXPLORE_BONUS,
  DEFAULT_OUTPUT_TOKENS,
  selectEligible,
  estimateCost,
  estimateSwitchCost,
  estimateQualityPrior,
  scoreCandidates,
  buildDynamicChain,
};
