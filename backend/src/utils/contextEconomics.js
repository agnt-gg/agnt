import { getModelCost } from '../services/ai/providerConfigs.js';

/**
 * What the *shape* of a request costs, as opposed to what a request cost.
 *
 * The panel could already say "your context is 781k tokens". It could not say
 * "69.1k of that is re-sent on every single request, and you have paid for it
 * 42 times". Those are different questions and only the second one is
 * actionable: a one-time 98k tool result is spent money, while a 15k memory
 * block is a standing order.
 *
 * Both rates are DERIVED from getModelCost rather than re-implemented, for the
 * same reason cacheSavings.js derives its baseline that way: a price change or
 * a new provider moves every number here with it, and the two can never drift
 * apart. Calling getModelCost with a round 1M input tokens and 0 output tokens
 * isolates the input side exactly.
 */

const PROBE_TOKENS = 1_000_000;

/**
 * getModelCost returns { inputCost, outputCost, totalCost } and reaches
 * getProviderConfig, which calls key.toLowerCase() unguarded — a nullish
 * provider throws rather than returning null. Both are handled here so callers
 * get the documented null instead of an exception.
 */
function probeInputCost(provider, model, cache) {
  if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return null;
  let priced;
  try {
    priced = getModelCost(provider, model, PROBE_TOKENS, 0, cache);
  } catch {
    return null;
  }
  // outputTokens is 0, so inputCost IS the whole figure — reading it explicitly
  // rather than totalCost keeps the probe honest if that ever stops being true.
  const cost = priced?.inputCost;
  return Number.isFinite(cost) ? cost : null;
}

/**
 * Cost of a single input token at the plain (uncached) rate.
 * @returns {number|null} null when the model has no pricing metadata.
 */
export function inputTokenRate(provider, model) {
  const cost = probeInputCost(provider, model);
  if (cost == null || cost <= 0) return null;
  return cost / PROBE_TOKENS;
}

/**
 * Cost of a single input token when it is served from the prompt cache.
 * On Anthropic this is 0.1x, on OpenAI 0.5x, elsewhere 1.0x — but we ask the
 * pricing table rather than encoding that here.
 * @returns {number|null}
 */
export function cachedInputTokenRate(provider, model) {
  const cost = probeInputCost(provider, model, { cacheReadTokens: PROBE_TOKENS });
  if (cost == null || cost < 0) return null;
  return cost / PROBE_TOKENS;
}

/**
 * How many more turns until the context window is full, given how fast the
 * conversation is growing.
 *
 * `growthPerTurn` is deliberately an input rather than something inferred from
 * a single sample: one round of a tool loop is not a turn, and guessing from
 * one data point would produce a confident wrong number.
 *
 * @returns {number|null} null when growth is unknown or non-positive (the
 *          conversation is not heading for the wall, so there is nothing to
 *          forecast and a fabricated "999 turns" would be noise).
 */
export function forecastTurnsToWall({ currentTokens, tokenLimit, growthPerTurn }) {
  const cur = Number(currentTokens) || 0;
  const limit = Number(tokenLimit) || 0;
  const growth = Number(growthPerTurn) || 0;
  if (limit <= 0 || growth <= 0) return null;
  const headroom = limit - cur;
  if (headroom <= 0) return 0;
  return Math.max(0, Math.floor(headroom / growth));
}

/**
 * The economics block attached to a context manifest.
 *
 * @param {object} input
 * @param {string} input.provider
 * @param {string} input.model
 * @param {number} input.systemTokens
 * @param {number} input.toolTokens
 * @returns {object|null} null when the model is not priceable — a fabricated
 *          $0.00 floor would read as "this is free", which is worse than
 *          showing nothing at all.
 */
export function buildEconomics({ provider, model, systemTokens = 0, toolTokens = 0 } = {}) {
  const rate = inputTokenRate(provider, model);
  if (rate == null) return null;

  const cachedRate = cachedInputTokenRate(provider, model);
  const floorTokens = Math.max(0, (systemTokens || 0) + (toolTokens || 0));

  return {
    rate,
    cachedRate,
    floorTokens,
    // What the fixed prefix costs on a turn that misses the cache…
    floorCost: floorTokens * rate,
    // …and on a turn where the prefix survives. The gap between these two is
    // exactly what a broken prefix costs, per turn.
    floorCostCached: cachedRate == null ? null : floorTokens * cachedRate,
    systemTokens: systemTokens || 0,
    toolTokens: toolTokens || 0,
  };
}

/**
 * Attach a per-turn cost to a list of `{ tokens }` items, in place-safe form.
 * Returns a new array; leaves items untouched when the model is unpriceable.
 */
export function priceItems(items, rate) {
  if (!Array.isArray(items)) return [];
  if (rate == null) return items;
  return items.map((item) => ({ ...item, cost: (item.tokens || 0) * rate }));
}
