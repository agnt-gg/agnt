import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  promptCacheTtlMs,
  openAIPromptCachePolicy,
  ANTHROPIC_REQUESTED_CACHE_TTL_MS,
  OPENAI_IDLE_EVICTION_MS,
  OPENAI_GPT56_CACHE_TTL_MS,
  OPENAI_EXTENDED_CACHE_TTL_MS,
  CODEX_MEASURED_CACHE_TTL_MS,
} from './promptCacheTtl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('promptCacheTtlMs', () => {
  it('reports the hour AGNT actually requests from Anthropic', () => {
    expect(promptCacheTtlMs('anthropic')).toBe(3_600_000);
    expect(promptCacheTtlMs('claude-code')).toBe(3_600_000);
  });

  it('is case-insensitive, matching how providers are named across the codebase', () => {
    expect(promptCacheTtlMs('Claude-Code')).toBe(3_600_000);
    expect(promptCacheTtlMs('OpenAI-Codex', 'gpt-5.6-sol')).toBe(CODEX_MEASURED_CACHE_TTL_MS);
  });

  it('does not apply api.openai.com’s five-minute floor to the ChatGPT Codex backend', () => {
    expect(promptCacheTtlMs('openai-codex', 'gpt-5.6-sol')).toBe(3_600_000);
  });

  it('reports the explicit policy selected for public OpenAI models', () => {
    expect(promptCacheTtlMs('openai', 'gpt-5.6-sol')).toBe(OPENAI_GPT56_CACHE_TTL_MS);
    expect(promptCacheTtlMs('openai', 'gpt-5.5')).toBe(OPENAI_EXTENDED_CACHE_TTL_MS);
    expect(promptCacheTtlMs('openai', 'gpt-4o')).toBe(OPENAI_IDLE_EVICTION_MS);
  });

  it('returns null rather than guessing for providers we have no basis for', () => {
    // A wrong TTL produces a confident false statement about the user's money.
    // Silence is the correct output when there is nothing to say.
    expect(promptCacheTtlMs('groq')).toBeNull();
    expect(promptCacheTtlMs('gemini')).toBeNull();
    expect(promptCacheTtlMs('kimi-code')).toBeNull();
    expect(promptCacheTtlMs('')).toBeNull();
    expect(promptCacheTtlMs(undefined)).toBeNull();
    expect(promptCacheTtlMs(null)).toBeNull();
  });
});

describe('openAIPromptCachePolicy', () => {
  it('uses GPT-5.6’s only supported explicit TTL', () => {
    expect(openAIPromptCachePolicy('gpt-5.6-sol')).toEqual({
      prompt_cache_options: { ttl: '30m' },
    });
  });

  it('uses 24-hour retention on older models that support it', () => {
    expect(openAIPromptCachePolicy('gpt-5.5')).toEqual({ prompt_cache_retention: '24h' });
    expect(openAIPromptCachePolicy('gpt-5.2-codex')).toBeNull();
    expect(openAIPromptCachePolicy('gpt-4.1')).toEqual({ prompt_cache_retention: '24h' });
  });

  it('does not guess for models without a documented explicit policy', () => {
    expect(openAIPromptCachePolicy('gpt-4o')).toBeNull();
    expect(openAIPromptCachePolicy('')).toBeNull();
  });
});

describe('the table matches what the adapter actually sends', () => {
  // A source-contract test. The TTL is not a fact about Anthropic — it is a
  // parameter AGNT chooses — so the only way this table can be correct is if it
  // tracks the adapter. Duplicating the value without pinning it is exactly how
  // the original 5-minute bug survived: the constant was plausible, documented,
  // and had nothing to do with the request we were sending.
  const ADAPTER = fs.readFileSync(
    path.join(__dirname, '../services/orchestrator/llmAdapters.js'),
    'utf8'
  );

  it('finds explicit ttl parameters on every Anthropic cache breakpoint', () => {
    const withTtl = ADAPTER.match(/cache_control(?:\s*[:=]\s*)\{\s*type:\s*'ephemeral',\s*ttl:\s*'([^']+)'/g) || [];
    expect(withTtl.length).toBeGreaterThan(0);
  });

  it('agrees with the adapter on the requested duration', () => {
    const ttls = [...ADAPTER.matchAll(/type:\s*'ephemeral',\s*ttl:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(ttls.length).toBeGreaterThan(0);

    // One value, used consistently — a mixed set would mean the panel cannot
    // describe the prefix with a single number and this module needs rethinking.
    const distinct = [...new Set(ttls)];
    expect(distinct).toHaveLength(1);

    const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };
    const [, n, unit] = distinct[0].match(/^(\d+)([mhd])$/);
    expect(Number(n) * UNITS[unit]).toBe(ANTHROPIC_REQUESTED_CACHE_TTL_MS);
  });

  it('leaves no un-suffixed ephemeral markers that would silently fall back to 5m', () => {
    // `{ type: 'ephemeral' }` with no ttl is Anthropic's 5-minute default. If
    // one appears, part of the prefix expires twelve times sooner than the rest
    // and a single reported TTL becomes a lie.
    const bare = ADAPTER.match(/\{\s*type:\s*'ephemeral'\s*\}/g) || [];
    expect(bare).toHaveLength(0);
  });
});
