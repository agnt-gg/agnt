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

/**
 * Read cached-token counts out of a Gemini `usageMetadata` object.
 *
 * The THIRD occurrence of the failure class this module exists to prevent, and
 * the first that was reintroduced by BYPASSING the module rather than by it
 * missing a shape: the Gemini adapter hand-rolled a read of
 * `cachedContentTokenCount` and nothing else.
 *
 * Decisive measurement, 2026-08-09 — same adapter, same model, same code path,
 * two different Google backends:
 *   API-key client   : 0.0% cache reads across 8 turns on a stable prefix
 *   Code Assist (CLI): 99.6% on turn 2
 * A difference in which FIELD the backend populates, not in whether Google's
 * cache works.
 *
 * Field-level fallback across every spelling Google uses or documents:
 *   cachedContentTokenCount      @google/genai SDK (camelCased REST)
 *   cached_content_token_count   raw REST
 *   totalCachedTokens /
 *   total_cached_tokens          current ai.google.dev caching docs
 *
 * Field-level, never object-level, for the same reason as the OpenAI-shaped
 * reader above: choosing an object first would silently zero a counter that
 * the other spelling could have supplied.
 *
 * @param {object|null|undefined} usageMetadata
 * @returns {number} Always a finite number, never NaN or undefined.
 */
export function readGeminiCachedTokens(usageMetadata) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const um = usageMetadata || {};
  // First POSITIVE spelling wins, not first PRESENT one. A `??` chain stops at
  // an explicit 0, so a backend that emits `cachedContentTokenCount: 0`
  // alongside a populated `total_cached_tokens` would be reported as a cache
  // miss — which is precisely the "indistinguishable from caching being off"
  // failure this module exists to prevent. Two spellings disagreeing means one
  // is vestigial; the populated one is the live counter.
  for (const v of [
    um.cachedContentTokenCount,
    um.cached_content_token_count,
    um.totalCachedTokens,
    um.total_cached_tokens,
  ]) {
    const n = num(v);
    if (n > 0) return n;
  }
  return 0;
}

/**
 * Normalize Gemini `usageMetadata` into the Chat-Completions `usage` shape the
 * rest of AGNT accounts in — mirroring what OpenAIResponsesAdapter already does
 * for the Responses API. Teach ONE normalizer a shape, not every consumer.
 *
 * Preserves the existing contract exactly: `prompt_tokens_details` is OMITTED
 * (not zeroed) when nothing was cached, so downstream accumulators that
 * distinguish "absent" from "zero" keep behaving as they do today.
 *
 * @param {object|null|undefined} usageMetadata
 * @returns {object|undefined} OpenAI-shaped usage, or undefined when absent.
 */
export function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata) return undefined;
  const cached = readGeminiCachedTokens(usageMetadata);
  return {
    prompt_tokens: usageMetadata.promptTokenCount || usageMetadata.prompt_token_count || 0,
    completion_tokens: usageMetadata.candidatesTokenCount || usageMetadata.candidates_token_count || 0,
    total_tokens: usageMetadata.totalTokenCount || usageMetadata.total_token_count || 0,
    prompt_tokens_details: cached > 0 ? { cached_tokens: cached } : undefined,
  };
}
