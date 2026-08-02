import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readOpenAiShapedCacheUsage } from './usageCacheFields.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('readOpenAiShapedCacheUsage', () => {
  it('reads a cache WRITE from a real OpenRouter response', () => {
    // Captured live 2026-08-02, anthropic/claude-haiku-4.5 via Amazon Bedrock.
    // REGRESSION: this counter was never read, so 816 OpenRouter executions in
    // the ledger recorded cache_creation_tokens = 0 while paying a 2x write
    // premium — caching looked broken precisely when it was working.
    const usage = {
      prompt_tokens: 8522,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 8519, audio_tokens: 0 },
    };
    expect(readOpenAiShapedCacheUsage(usage)).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 8519,
    });
  });

  it('reads a cache READ from the following turn', () => {
    const usage = {
      prompt_tokens: 8525,
      prompt_tokens_details: { cached_tokens: 8513, cache_write_tokens: 0 },
    };
    expect(readOpenAiShapedCacheUsage(usage)).toEqual({
      cacheReadTokens: 8513,
      cacheWriteTokens: 0,
    });
  });

  it('reads the Responses API shape (OpenAI gpt-5.x and all Codex models)', () => {
    const usage = {
      input_tokens: 12000,
      input_tokens_details: { cached_tokens: 9000, cache_write_tokens: 1000 },
    };
    expect(readOpenAiShapedCacheUsage(usage)).toEqual({
      cacheReadTokens: 9000,
      cacheWriteTokens: 1000,
    });
  });

  it('falls back per FIELD, not per object', () => {
    // A details object present but missing one counter must still resolve that
    // counter from the other shape. Preferring the whole object would zero it.
    const usage = {
      prompt_tokens_details: { cached_tokens: 500 },
      input_tokens_details: { cache_write_tokens: 700 },
    };
    expect(readOpenAiShapedCacheUsage(usage)).toEqual({
      cacheReadTokens: 500,
      cacheWriteTokens: 700,
    });
  });

  it('returns zeros for every absent or malformed shape', () => {
    for (const usage of [
      undefined, null, {}, { prompt_tokens: 10 },
      { prompt_tokens_details: null },
      { prompt_tokens_details: { cached_tokens: null, cache_write_tokens: undefined } },
      { prompt_tokens_details: { cached_tokens: 'nope', cache_write_tokens: NaN } },
      { prompt_tokens_details: { cached_tokens: -5 } },
    ]) {
      expect(readOpenAiShapedCacheUsage(usage)).toEqual({
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    }
  });
});

describe('the orchestrator accumulates writes, and does not double-count input', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../services/OrchestratorService.js'),
    'utf8'
  );

  it('credits the write buckets from the extracted reader', () => {
    expect(SRC).toMatch(/readOpenAiShapedCacheUsage\(usage\)/);
    expect(SRC).toMatch(/tokenAccumulator\.cacheCreationTokens \+= cacheWriteTokens/);
  });

  it('buckets the write by the TTL the request asked for', () => {
    // The response never echoes the ttl back, so the request is the only place
    // the duration is known. Bucketing everything as 5m would price a 2.0x
    // write at 1.25x.
    expect(SRC).toMatch(/const writeTtlMs = promptCacheTtlMs\(normalizedProvider, model\)/);
    expect(SRC).toMatch(/tokenAccumulator\.cacheCreation1hTokens \+= cacheWriteTokens/);
    expect(SRC).toMatch(/tokenAccumulator\.cacheCreation5mTokens \+= cacheWriteTokens/);
  });

  it('NEGATIVE CONTROL: never adds cache writes to the input total', () => {
    // `prompt_tokens` already includes them on this shape. An extra
    // `inputTokens += cacheWriteTokens` would double-bill every write turn.
    expect(SRC).not.toMatch(/inputTokens \+= cacheWriteTokens/);
  });

  it('the write branch is reachable, not dead', () => {
    // A source-contract test that only checks PRESENCE cannot tell a live
    // branch from `if (false && ...)`. Pin the guard shape itself.
    expect(SRC).toMatch(/if \(cacheWriteTokens > 0\) \{/);
    expect(SRC).not.toMatch(/if \(false[^)]*cacheWriteTokens/);
  });
});
