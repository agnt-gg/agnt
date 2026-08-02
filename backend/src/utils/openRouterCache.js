/**
 * OpenRouter prompt-cache contract resolution.
 *
 * OpenRouter is not a provider. It is a ROUTER in front of ~9 upstream
 * families, and those families do not agree on how prompt caching is turned
 * on. Treating "openrouter" as one opaque OpenAI clone is what left
 * `anthropic/*` traffic at a 0% cache hit rate while the very same models
 * called natively through AGNT's Anthropic adapter cached perfectly.
 *
 * Two upstream families REQUIRE an explicit per-message breakpoint and cache
 * nothing without one (OpenRouter's prompt-caching guide names exactly these
 * two: Anthropic and Alibaba). Everyone else caches automatically and needs no
 * marker at all — sending one there buys nothing, so we don't.
 *
 * ─────────────────────── MEASURED, NOT ASSUMED ───────────────────────
 * Live against OpenRouter on 2026-08-02, anthropic/claude-haiku-4.5, an ~8.5k
 * token stable prefix, upstream Amazon Bedrock:
 *
 *   top-level `cache_control` (the obvious fix):
 *     turn 1  read=0     write=8519   $0.017066
 *     turn 2  read=0     write=8520   $0.017063   <-- REWRITES. Never reads.
 *
 *   explicit block breakpoint on the stable prefix (this module):
 *     turn 1  read=0     write=8513   $0.01706
 *     turn 2  read=8513  write=0      $0.0008933  <-- 94.8% cheaper
 *     turn 3  read=8513  write=0      $0.0009433
 *
 * The top-level form fails because OpenRouter expands it to a breakpoint on
 * the LAST cacheable block, which is the varying user turn — so the cached
 * prefix never matches on the next request. It fails SILENTLY: HTTP 200,
 * plausible-looking usage, full price forever. That is precisely why this
 * module places breakpoints explicitly instead of delegating to the shorthand.
 *
 * The 1h TTL is confirmed by price, not by documentation: the write above was
 * billed at 2.0x base input (Anthropic's 1-hour write rate; the 5-minute rate
 * is 1.25x) and reads at 0.1x.
 */

/**
 * Upstream families that cache ONLY when given an explicit breakpoint.
 *
 * Keyed by the vendor segment of an OpenRouter model slug
 * (`anthropic/claude-sonnet-4.6` -> `anthropic`).
 *
 * `ttl` is the value sent in the cache_control marker. `null` means "send no
 * ttl field" — Alibaba's window is a fixed upstream 5 minutes and is not
 * caller-selectable, so naming a duration there would be a lie we'd then have
 * to display.
 */
const EXPLICIT_CACHE_FAMILIES = {
  // Anthropic honours the extended 1-hour TTL through OpenRouter. Verified by
  // billing rate (2.0x write / 0.1x read) in the measurement above.
  anthropic: { ttl: '1h', ttlMs: 60 * 60 * 1000 },
  // Alibaba (Qwen). Requires explicit cache_control; window is a fixed 5m.
  qwen: { ttl: null, ttlMs: 5 * 60 * 1000 },
};

/**
 * The automatic families cache without any marker, so we send none. Their TTL
 * is deliberately NOT recorded here: we have no parameter that controls it and
 * no reproducible measurement of it, and `promptCacheTtlMs` returning null
 * ("we don't claim to know") is strictly better than a confident wrong number
 * on a panel about money.
 */

/**
 * The ready-to-send `cache_control` marker is built HERE rather than in the
 * adapter, and that placement is load-bearing. An un-suffixed
 * `{ type: 'ephemeral' }` means "whatever the upstream default is" — five
 * minutes on the Anthropic path — so llmAdapters.js carries a guard test
 * asserting no bare ephemeral literal exists anywhere in it. Building the
 * marker in this module keeps that guard strict with zero exemptions, and puts
 * the one legitimate bare marker (Alibaba, whose window genuinely is not
 * selectable) directly beside the table that explains why.
 *
 * @param {string} modelId An OpenRouter model slug, e.g. 'anthropic/claude-sonnet-4.6'.
 *   Tolerates variant suffixes ('...:thinking', '...:beta') and stray casing.
 * @returns {{mode: 'explicit'|'automatic', ttl: string|null, ttlMs: number|null,
 *   marker: {type: string, ttl?: string}|null}}
 */
export function resolveOpenRouterCacheContract(modelId) {
  const AUTOMATIC = { mode: 'automatic', ttl: null, ttlMs: null, marker: null };
  if (typeof modelId !== 'string' || !modelId) return AUTOMATIC;

  const vendor = modelId.toLowerCase().trim().split('/')[0];
  const family = EXPLICIT_CACHE_FAMILIES[vendor];
  if (!family) return AUTOMATIC;

  return {
    mode: 'explicit',
    ttl: family.ttl,
    ttlMs: family.ttlMs,
    marker: family.ttl ? { type: 'ephemeral', ttl: family.ttl } : { type: 'ephemeral' },
  };
}

/**
 * Cache lifetime for an OpenRouter model, or null when unknown.
 * Separated from the contract so UI code can ask the narrow question without
 * pulling in request-shaping concerns.
 *
 * @param {string} modelId
 * @returns {number|null} milliseconds
 */
export function openRouterCacheTtlMs(modelId) {
  return resolveOpenRouterCacheContract(modelId).ttlMs;
}

export const __testing = { EXPLICIT_CACHE_FAMILIES };
