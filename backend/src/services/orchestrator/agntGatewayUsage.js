/**
 * models.agnt.gg (AGNT Flash) reports usage in its own camelCase shape:
 *   { inputTokens, cachedInputTokens, outputTokens, credits, ... }
 * where inputTokens is the UNCACHED part only. accumulateUsage reads OpenAI's
 * names (prompt_tokens / completion_tokens / prompt_tokens_details) and found
 * none, so every AGNT Flash turn was recorded as 0 tokens and free.
 *
 * Returns the OpenAI shape when, and only when, the gateway shape is all there
 * is. A gateway new enough to send OpenAI fields as well is passed through
 * untouched, so the same tokens are never counted twice.
 */
export function fromAgntGatewayUsage(usage) {
  if (!usage || typeof usage !== 'object') return usage;
  const hasStandard = ['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens'].some((key) => usage[key] !== undefined);
  const hasGateway = ['inputTokens', 'cachedInputTokens', 'outputTokens'].some((key) => usage[key] !== undefined);
  if (hasStandard || !hasGateway) return usage;
  const fresh = Number(usage.inputTokens) || 0;
  const cached = Number(usage.cachedInputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  return {
    ...usage,
    prompt_tokens: fresh + cached,
    completion_tokens: output,
    total_tokens: fresh + cached + output,
    prompt_tokens_details: { cached_tokens: cached },
  };
}
