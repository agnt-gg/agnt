import { describe, it, expect } from 'vitest';
import {
  promptCacheTtlMs,
  promptCacheBestEffort,
  GROQ_CACHE_TTL_MS,
  CEREBRAS_GUARANTEED_CACHE_TTL_MS,
} from './promptCacheTtl.js';

/**
 * TTLs that graduated from "no basis" to cited, and the best-effort flag.
 *
 * This module's rule is that a number appears only when it traces to a
 * parameter AGNT sends, current vendor documentation, or a reproducible
 * measurement. Groq and Cerebras now qualify:
 *
 *   Groq     "All cached data automatically expires after 2 hours without use"
 *            console.groq.com/docs/prompt-caching
 *   Cerebras "We guarantee a Time-To-Live (TTL) of 5 minutes, though caches may
 *            persist up to 1 hour depending on system load"
 *            inference-docs.cerebras.ai/capabilities/prompt-caching
 *
 * Both are FAMILY-SCOPED, because both vendors document caching for a subset of
 * their models. A countdown on a model with no cache is exactly the confident
 * false claim the rule exists to prevent.
 */

describe('cited cache windows', () => {
  it('groq reports the documented 2-hour idle expiry on cached models', () => {
    expect(GROQ_CACHE_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(promptCacheTtlMs('groq', 'openai/gpt-oss-120b')).toBe(GROQ_CACHE_TTL_MS);
    expect(promptCacheTtlMs('groq', 'openai/gpt-oss-20b')).toBe(GROQ_CACHE_TTL_MS);
    expect(promptCacheTtlMs('GROQ')).toBe(GROQ_CACHE_TTL_MS); // provider-level, case-insensitive
  });

  it('groq reports NOTHING for models that have no cache at all', () => {
    // Groq's docs scope caching to the gpt-oss family. llama/qwen have none.
    expect(promptCacheTtlMs('groq', 'llama-3.3-70b-versatile')).toBeNull();
    expect(promptCacheTtlMs('groq', 'qwen/qwen3-32b')).toBeNull();
  });

  it('cerebras reports the GUARANTEED 5m, not the load-dependent 1h ceiling', () => {
    // Promising the ceiling would over-state what the vendor commits to.
    expect(CEREBRAS_GUARANTEED_CACHE_TTL_MS).toBe(5 * 60 * 1000);
    expect(promptCacheTtlMs('cerebras', 'zai-glm-4.7')).toBe(CEREBRAS_GUARANTEED_CACHE_TTL_MS);
    expect(promptCacheTtlMs('cerebras', 'gpt-oss-120b')).toBe(CEREBRAS_GUARANTEED_CACHE_TTL_MS);
  });

  it('cerebras reports nothing for its uncached models', () => {
    expect(promptCacheTtlMs('cerebras', 'llama-3.3-70b')).toBeNull();
  });

  it('ANTI-VACUITY: unsourced providers still return null', () => {
    // If everything returned a number the rule would be dead.
    for (const p of ['togetherai', 'minimax', 'zai', 'kimi', 'grokai', 'gemini']) {
      expect(promptCacheTtlMs(p), p).toBeNull();
    }
  });
});

describe('promptCacheBestEffort', () => {
  it('is true for groq only', () => {
    expect(promptCacheBestEffort('groq')).toBe(true);
    expect(promptCacheBestEffort('GROQ')).toBe(true);
    for (const p of ['anthropic', 'claude-code', 'openai', 'openai-codex', 'gemini', 'openrouter', 'cerebras', 'grokai']) {
      expect(promptCacheBestEffort(p), p).toBe(false);
    }
  });

  it('is safe on junk input', () => {
    expect(promptCacheBestEffort(null)).toBe(false);
    expect(promptCacheBestEffort(undefined)).toBe(false);
    expect(promptCacheBestEffort('')).toBe(false);
  });

  it('is independent of whether the TTL is known', () => {
    // Groq has BOTH a cited window and an unreliable hit rate. Conflating the
    // two would either hide the window or excuse every miss.
    expect(promptCacheTtlMs('groq', 'openai/gpt-oss-120b')).not.toBeNull();
    expect(promptCacheBestEffort('groq')).toBe(true);
  });
});
