/**
 * fallbackChain.js — shared sanitizers for provider-failover chains.
 *
 * A "fallback chain" is a JSON array of up to 3 { provider, model } tiers,
 * persisted as TEXT on both the `users` table (user-global default chain) and
 * the `agents` table (per-agent override chain). This module is the single
 * source of truth for parsing/serializing that column so UserModel, AgentModel
 * and any future caller stay consistent.
 *
 * Design contracts (match UserModel's original inline helpers, Phase 1):
 *   - NULL / '' / malformed JSON / non-array  → []
 *   - each entry must have a non-empty string `provider`; others dropped
 *   - `model` coerced to a trimmed string or null
 *   - optional `reasoning` (effort for THIS tier) kept only when it is a
 *     plausible effort token; absent means "same as the chat's selection"
 *   - capped at MAX_FALLBACK_TIERS (3)
 */

export const MAX_FALLBACK_TIERS = 3;

// Effort values are short lowercase tokens ('default', 'low', 'xhigh', 'max',
// 'off', 'on', …). Anything else is dropped rather than stored, so a malformed
// client cannot park arbitrary text in the column. Whether the tier's MODEL
// accepts the value is deliberately NOT decided here: that is the wire
// builder's job at request time, against the live control (which for
// grok-build comes from the proxy and can change without a code change).
const REASONING_TOKEN_RE = /^[a-z][a-z0-9_-]{0,15}$/;

/**
 * Normalise a tier's optional reasoning effort.
 * @param {unknown} value
 * @returns {string|null} lowercase token, or null for "not set"
 */
export function normalizeTierReasoning(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return REASONING_TOKEN_RE.test(v) ? v : null;
}

/**
 * Parse a raw fallback_providers column value into a clean array.
 * @param {string|Array|null|undefined} raw
 * @returns {{provider: string, model: string|null}[]}
 */
export function parseFallbackChain(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((e) => e && typeof e === 'object' && typeof e.provider === 'string' && e.provider.trim())
    .map((e) => {
      const tier = {
        provider: e.provider.trim(),
        model: typeof e.model === 'string' && e.model.trim() ? e.model.trim() : null,
      };
      // Key omitted (not null) when unset, so existing chains keep their exact
      // stored shape and nothing that compares tiers sees a new field.
      const reasoning = normalizeTierReasoning(e.reasoning);
      if (reasoning) tier.reasoning = reasoning;
      return tier;
    })
    .slice(0, MAX_FALLBACK_TIERS);
}

/**
 * Serialize a fallback chain for storage. Accepts an array or a pre-stringified
 * JSON string; anything invalid becomes '[]'.
 * @param {Array|string|null|undefined} value
 * @returns {string} JSON string
 */
export function serializeFallbackChain(value) {
  return JSON.stringify(parseFallbackChain(value));
}

export default { MAX_FALLBACK_TIERS, normalizeTierReasoning, parseFallbackChain, serializeFallbackChain };
