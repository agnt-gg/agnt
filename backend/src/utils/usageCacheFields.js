/**
 * Read cache counters out of an OpenAI-shaped `usage` object.
 *
 * Three wire shapes report the same two numbers under different names, and
 * AGNT talks to all three:
 *
 *   Chat Completions   usage.prompt_tokens_details.{cached_tokens, cache_write_tokens}
 *   Responses API      usage.input_tokens_details.{cached_tokens, cache_write_tokens}
 *   OpenRouter         Chat Completions shape, for every routed upstream
 *
 * Reading only one shape is not a cosmetic bug — it is indistinguishable from
 * caching being switched off. Two instances of exactly that have been fixed
 * here: Codex hits were accumulated as zero until `input_tokens_details` was
 * read, and every OpenRouter cache WRITE was accumulated as zero until
 * `cache_write_tokens` was, leaving 816 executions in the live ledger claiming
 * `cache_creation_tokens = 0` while genuinely paying a write premium.
 *
 * IMPORTANT — do not add these to an input-token total. Unlike Anthropic's
 * native shape (where `input_tokens` is the uncached remainder), `prompt_tokens`
 * here ALREADY includes both cached reads and cache writes. Verified live on
 * 2026-08-02: prompt_tokens 8522 alongside cache_write_tokens 8513.
 *
 * @param {object|null|undefined} usage
 * @returns {{cacheReadTokens: number, cacheWriteTokens: number}} Always numbers,
 *   never NaN or undefined, so callers can accumulate without guarding.
 */
export function readOpenAiShapedCacheUsage(usage) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  // Field-level fallback, not object-level: a provider that sends a
  // prompt_tokens_details object missing one counter must still be able to
  // supply that counter from the other shape. Choosing the OBJECT first would
  // silently zero it.
  const pick = (field) => num(
    usage?.prompt_tokens_details?.[field] ?? usage?.input_tokens_details?.[field]
  );

  return {
    cacheReadTokens: pick('cached_tokens'),
    cacheWriteTokens: pick('cache_write_tokens'),
  };
}
