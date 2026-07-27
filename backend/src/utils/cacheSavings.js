import { getModelCost } from '../services/ai/providerConfigs.js';

/**
 * What prompt caching actually saved on a request.
 *
 * The "what if nothing had been cached" baseline is deliberately the SAME
 * getModelCost call with the cache argument omitted: getModelCost treats
 * `inputTokens` as the TRUE TOTAL input (uncached + cache_read + creation),
 * so dropping the cache breakdown bills every one of those tokens at the
 * plain 1.0x input rate. That is exactly the counterfactual we want.
 *
 * Deriving the baseline this way — rather than re-implementing the multiplier
 * table — means the two numbers can never drift apart. Add a provider, change
 * a cache multiplier, fix a price: both sides of the comparison move together.
 *
 * Note the sign. Anthropic cache WRITES cost 1.25x (5m) / 2.0x (1h), so the
 * turn that first writes a prefix genuinely costs MORE than not caching at
 * all; savedCost is negative there and turns positive on the next read. We
 * surface that honestly rather than clamping it to zero.
 *
 * @param {string} provider
 * @param {string} model
 * @param {number} inputTokens  total input (INCLUDING cached tokens)
 * @param {number} outputTokens
 * @param {object} [cache] { cacheReadTokens, cacheCreation5mTokens, cacheCreation1hTokens, cacheCreationTokens }
 * @returns {{actualCost:number, uncachedCost:number, savedCost:number, savedPct:number}|null}
 *          null when the model has no pricing metadata (cost is unknowable,
 *          and a fabricated $0.00 saving would be worse than showing nothing).
 */
export function computeCacheSavings(provider, model, inputTokens, outputTokens, cache = {}) {
  const actual = getModelCost(provider, model, inputTokens, outputTokens, cache);
  if (!actual) return null;

  const uncached = getModelCost(provider, model, inputTokens, outputTokens);
  if (!uncached) return null;

  const savedCost = uncached.totalCost - actual.totalCost;
  return {
    actualCost: actual.totalCost,
    uncachedCost: uncached.totalCost,
    savedCost,
    savedPct: uncached.totalCost > 0 ? (savedCost / uncached.totalCost) * 100 : 0,
  };
}

/**
 * Same counterfactual, for a persisted agent_executions row.
 *
 * Lets the conversation summary reconstruct savings for conversations that
 * predate this feature — provider, model and the cache token columns are all
 * already stored, so nothing had to be migrated.
 *
 * Conservative by design: a row we cannot price contributes its recorded cost
 * to BOTH sides, so it reports zero savings rather than inflating the total.
 * Savings can be understated by old/unknown models; it can never be overstated.
 *
 * @returns {number} the uncached-baseline cost to attribute to this row
 */
export function uncachedCostForRow(row) {
  const recorded = Number(row?.estimated_cost) || 0;
  if (!row?.provider || !row?.model) return recorded;

  const inputTokens = Number(row.input_tokens) || 0;
  const outputTokens = Number(row.output_tokens) || 0;
  if (inputTokens <= 0 && outputTokens <= 0) return recorded;

  const cacheRead = Number(row.cache_read_tokens) || 0;
  const cacheCreation = Number(row.cache_creation_tokens) || 0;
  if (cacheRead <= 0 && cacheCreation <= 0) return recorded;

  const savings = computeCacheSavings(row.provider, row.model, inputTokens, outputTokens, {
    cacheReadTokens: cacheRead,
    // The 5m/1h split is not persisted; 5m is the historical default and the
    // cheaper write multiplier, so this understates rather than inflates.
    cacheCreationTokens: cacheCreation,
  });
  return savings ? savings.uncachedCost : recorded;
}
