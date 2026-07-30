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
 *   - capped at MAX_FALLBACK_TIERS (3)
 */

export const MAX_FALLBACK_TIERS = 3;

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
    .map((e) => ({
      provider: e.provider.trim(),
      model: typeof e.model === 'string' && e.model.trim() ? e.model.trim() : null,
    }))
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

export default { MAX_FALLBACK_TIERS, parseFallbackChain, serializeFallbackChain };
