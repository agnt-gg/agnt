import { describe, it, expect } from 'vitest';
import { readGeminiCachedTokens, normalizeGeminiUsage } from './usageCacheFields.js';

/**
 * The Gemini wire shape — third occurrence of the one-reader rule.
 *
 * Measured 2026-08-09: the API-key Gemini client reported 0% cache hits over 8
 * turns on a stable prefix while the Code Assist client reported 99.6% for the
 * same adapter and model. The difference was which FIELD the backend
 * populated; the adapter's hand-rolled read knew only `cachedContentTokenCount`.
 * These pin every spelling Google uses or documents, so an unrecognised one can
 * never again read as "cache off".
 */

describe('readGeminiCachedTokens', () => {
  it.each([
    ['SDK camelCase', { cachedContentTokenCount: 4608 }],
    ['raw REST snake_case', { cached_content_token_count: 4608 }],
    ['docs camelCase total', { totalCachedTokens: 4608 }],
    ['docs snake_case total', { total_cached_tokens: 4608 }],
  ])('reads the %s spelling', (_label, usageMetadata) => {
    expect(readGeminiCachedTokens(usageMetadata)).toBe(4608);
  });

  it('is field-level: the first populated spelling wins', () => {
    expect(readGeminiCachedTokens({ cachedContentTokenCount: 100, total_cached_tokens: 999 })).toBe(100);
  });

  it('falls through a zero to a later spelling rather than reporting nothing', () => {
    // Object-level selection would stop at the first present KEY and return 0.
    expect(readGeminiCachedTokens({ cachedContentTokenCount: 0, total_cached_tokens: 512 })).toBe(512);
  });

  it('returns 0 — never NaN or undefined — for absent, null or junk input', () => {
    expect(readGeminiCachedTokens(undefined)).toBe(0);
    expect(readGeminiCachedTokens(null)).toBe(0);
    expect(readGeminiCachedTokens({})).toBe(0);
    expect(readGeminiCachedTokens({ cachedContentTokenCount: 'lots' })).toBe(0);
    expect(readGeminiCachedTokens({ cachedContentTokenCount: NaN })).toBe(0);
    expect(readGeminiCachedTokens({ cachedContentTokenCount: -5 })).toBe(0);
  });
});

describe('normalizeGeminiUsage', () => {
  it('maps camelCase usageMetadata to the Chat-Completions shape', () => {
    expect(normalizeGeminiUsage({
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
      totalTokenCount: 1200,
      cachedContentTokenCount: 900,
    })).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 900 },
    });
  });

  it('maps snake_case usageMetadata identically', () => {
    expect(normalizeGeminiUsage({
      prompt_token_count: 1000,
      candidates_token_count: 200,
      total_token_count: 1200,
      total_cached_tokens: 900,
    })).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 900 },
    });
  });

  it('OMITS prompt_tokens_details when nothing was cached (existing contract)', () => {
    const usage = normalizeGeminiUsage({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
    expect(usage.prompt_tokens_details).toBeUndefined();
    expect('prompt_tokens_details' in usage).toBe(true); // key present, value undefined — as before
  });

  it('returns undefined for absent usageMetadata (existing contract)', () => {
    expect(normalizeGeminiUsage(undefined)).toBeUndefined();
    expect(normalizeGeminiUsage(null)).toBeUndefined();
  });
});
