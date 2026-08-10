/**
 * How long a provider keeps a prompt prefix cached.
 *
 * This is deliberately model-aware. OpenAI's older models support explicit
 * 24-hour retention, while GPT-5.6 introduced a different cache contract whose
 * only supported explicit TTL is currently 30 minutes. Codex uses the ChatGPT
 * backend, which accepts `prompt_cache_key` but rejects both public retention
 * controls; its lifetime must therefore come from measured backend behaviour,
 * not from api.openai.com documentation.
 *
 * A number is listed only when it can be traced to a parameter AGNT sends,
 * current vendor documentation, or a reproducible live measurement. Everything
 * else is null: silence is safer than a confident false claim about money.
 */

import { openRouterCacheTtlMs } from './openRouterCache.js';

// Anthropic-family. AGNT explicitly requests this on every cache breakpoint.
export const ANTHROPIC_REQUESTED_CACHE_TTL_MS = 60 * 60 * 1000;

// Current OpenAI in-memory behaviour when no supported retention control is
// available. This is a conservative lower bound, not the provider maximum.
export const OPENAI_IDLE_EVICTION_MS = 5 * 60 * 1000;

// GPT-5.6+ uses prompt_cache_options.ttl. OpenAI currently supports 30m only.
export const OPENAI_GPT56_CACHE_TTL_MS = 30 * 60 * 1000;

// Older supported OpenAI models accept prompt_cache_retention: '24h'.
export const OPENAI_EXTENDED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// The ChatGPT Codex backend rejects prompt_cache_options and
// prompt_cache_retention, so AGNT cannot force a duration. We measured cache
// hits after 23m and 38m of inactivity in the live execution ledger. One hour
// is therefore the useful UI window without importing the unrelated 5m floor
// from api.openai.com. This is intentionally separate from OpenAI API policy.
export const CODEX_MEASURED_CACHE_TTL_MS = 60 * 60 * 1000;

// Groq: "All cached data automatically expires after 2 hours without use"
// console.groq.com/docs/prompt-caching (retrieved 2026-08-09). A ceiling on
// freshness, not a promise of hits — the same page documents no manual control
// and Groq's cache is explicitly best-effort (see promptCacheBestEffort).
export const GROQ_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Cerebras: "We guarantee a Time-To-Live (TTL) of 5 minutes, though caches may
// persist up to 1 hour depending on system load."
// inference-docs.cerebras.ai/capabilities/prompt-caching (retrieved 2026-08-09).
// The GUARANTEE is the honest number for a countdown; the 1h ceiling is
// load-dependent and would over-promise.
export const CEREBRAS_GUARANTEED_CACHE_TTL_MS = 5 * 60 * 1000;

// Caching exists only on these families; a countdown on any other model of the
// same provider would describe a cache that does not exist.
const GROQ_CACHED_MODELS = /^openai\/gpt-oss/i;
const CEREBRAS_CACHED_MODELS = /^(zai-glm-4\.7|gpt-oss-120b)$/i;

const OPENAI_EXTENDED_CACHE_MODELS = /^(?:gpt-5\.5(?:-pro)?|gpt-5\.4|gpt-5\.2|gpt-5\.1(?:-codex(?:-max|-mini)?|-chat-latest)?|gpt-5(?:-codex)?|gpt-4\.1)$/i;
const OPENAI_GPT56_OR_LATER = /^gpt-(?:[6-9](?:\.|-|$)|5\.(?:[6-9]|\d{2,})(?:\.|-|$))/i;

/**
 * Return request-level cache controls for public OpenAI API requests.
 * Codex is intentionally excluded: its ChatGPT backend rejects these fields.
 */
export function openAIPromptCachePolicy(model) {
  if (typeof model !== 'string' || !model) return null;
  if (OPENAI_GPT56_OR_LATER.test(model)) {
    return { prompt_cache_options: { ttl: '30m' } };
  }
  if (OPENAI_EXTENDED_CACHE_MODELS.test(model)) {
    return { prompt_cache_retention: '24h' };
  }
  return null;
}

/**
 * @param {string} provider
 * @param {string} [model]
 * @returns {number|null} Cache lifetime in milliseconds.
 */
export function promptCacheTtlMs(provider, model = null) {
  if (typeof provider !== 'string' || !provider) return null;

  switch (provider.toLowerCase()) {
    case 'anthropic':
    case 'claude-code':
      return ANTHROPIC_REQUESTED_CACHE_TTL_MS;
    case 'openai-codex':
      return CODEX_MEASURED_CACHE_TTL_MS;
    case 'openai':
      if (typeof model !== 'string' || !model) return OPENAI_IDLE_EVICTION_MS;
      if (OPENAI_GPT56_OR_LATER.test(model)) return OPENAI_GPT56_CACHE_TTL_MS;
      if (OPENAI_EXTENDED_CACHE_MODELS.test(model)) return OPENAI_EXTENDED_CACHE_TTL_MS;
      return OPENAI_IDLE_EVICTION_MS;
    case 'groq':
      if (typeof model === 'string' && model && !GROQ_CACHED_MODELS.test(model)) return null;
      return GROQ_CACHE_TTL_MS;
    case 'cerebras':
      if (typeof model === 'string' && model && !CEREBRAS_CACHED_MODELS.test(model)) return null;
      return CEREBRAS_GUARANTEED_CACHE_TTL_MS;
    case 'openrouter':
      // Only the families AGNT sends an explicit breakpoint to report a
      // window, and only because the breakpoint names the duration. The
      // automatic families return null by design: their caches demonstrably
      // work, but nothing AGNT sends controls how long they live and we have
      // no reproducible measurement of it. Guessing here would put a
      // confident countdown on a panel about money.
      return openRouterCacheTtlMs(model);
    default:
      return null;
  }
}

/**
 * Providers whose prompt cache AGNT can neither control nor rely on: fully
 * automatic, server-side, no affinity parameter exists, and documented as
 * opportunistic.
 *
 * Measured 2026-08-08 on Groq — six byte-identical requests, prompt_tokens
 * constant at 32,774: hit, miss, miss, miss, miss, hit. That is the vendor's
 * documented behaviour ("Groq tries to maximize cache hits, but this is not
 * guaranteed"), not a defect in AGNT's prefix hygiene. Without this flag those
 * misses are indistinguishable from a broken cache, so the panel can present
 * them as opportunistic instead of alarming.
 *
 * Note this is NOT the same thing as an unknown TTL: Groq's window is known and
 * cited above. What is unknowable is whether any individual request hits.
 */
export function promptCacheBestEffort(provider) {
  return String(provider || '').toLowerCase() === 'groq';
}
