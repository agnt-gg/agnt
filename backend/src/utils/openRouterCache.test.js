import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveOpenRouterCacheContract, openRouterCacheTtlMs, __testing } from './openRouterCache.js';
import { promptCacheTtlMs } from './promptCacheTtl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('resolveOpenRouterCacheContract', () => {
  it('marks the Anthropic family explicitly, for one hour', () => {
    // Measured live 2026-08-02: an explicit breakpoint on the stable prefix
    // took turn 2 from $0.017063 to $0.0008933 (94.8%). The write was billed
    // at 2.0x base input, which is Anthropic's 1-hour write rate (5m is
    // 1.25x) — that billing rate is the proof the ttl was honoured.
    const c = resolveOpenRouterCacheContract('anthropic/claude-haiku-4.5');
    expect(c.mode).toBe('explicit');
    expect(c.ttl).toBe('1h');
    expect(c.ttlMs).toBe(3_600_000);
    expect(c.marker).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('marks Alibaba explicitly but claims no selectable duration', () => {
    // Alibaba requires the breakpoint but its window is a fixed upstream 5m.
    // Sending ttl:'1h' there would be a request we cannot honour and would
    // then be echoed back to the user as a countdown that never applied.
    const c = resolveOpenRouterCacheContract('qwen/qwen3-coder-plus');
    expect(c.mode).toBe('explicit');
    expect(c.ttl).toBeNull();
    expect(c.marker).toEqual({ type: 'ephemeral' });
    expect(c.ttlMs).toBe(300_000);
  });

  it('leaves automatic families alone', () => {
    // These cache without a marker. Sending one buys nothing and risks
    // shaping a request for an upstream that never asked for it.
    for (const id of [
      'openai/gpt-5.2',
      'x-ai/grok-4.5',
      'deepseek/deepseek-v3.2',
      'google/gemini-2.5-flash',
      'meta-llama/llama-3.3-70b-instruct',
    ]) {
      const c = resolveOpenRouterCacheContract(id);
      expect(c.mode, id).toBe('automatic');
      expect(c.marker, id).toBeNull();
      expect(c.ttlMs, id).toBeNull();
    }
  });

  it('tolerates variant suffixes and casing', () => {
    expect(resolveOpenRouterCacheContract('Anthropic/Claude-Sonnet-4.6:thinking').ttl).toBe('1h');
    expect(resolveOpenRouterCacheContract('  anthropic/claude-opus-4.7:beta  ').mode).toBe('explicit');
  });

  it('never throws on malformed input', () => {
    for (const bad of [null, undefined, '', 42, {}, 'no-slash-model']) {
      expect(() => resolveOpenRouterCacheContract(bad)).not.toThrow();
      expect(resolveOpenRouterCacheContract(bad).mode).toBe('automatic');
    }
  });
});

describe('reported TTL matches the marker actually sent', () => {
  // The generalized form of the Anthropic guard in promptCacheTtl.test.js:
  // whatever duration we tell the user, the request must have asked for it.
  // A table where these two drift apart puts a confident countdown on screen
  // that describes a cache the provider never agreed to keep.
  const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

  it('agrees for every explicitly-cached family', () => {
    const families = Object.keys(__testing.EXPLICIT_CACHE_FAMILIES);
    expect(families.length).toBeGreaterThan(0);

    for (const vendor of families) {
      const c = resolveOpenRouterCacheContract(`${vendor}/some-model`);
      expect(c.mode, vendor).toBe('explicit');

      if (c.marker.ttl) {
        const [, n, unit] = c.marker.ttl.match(/^(\d+)([mhd])$/);
        expect(Number(n) * UNITS[unit], vendor).toBe(c.ttlMs);
      } else {
        // No selectable ttl: the reported window must be the upstream default
        // we documented, never a number we wished for.
        expect(c.ttlMs, vendor).toBe(300_000);
      }
    }
  });

  it('is what promptCacheTtlMs surfaces for openrouter', () => {
    expect(promptCacheTtlMs('openrouter', 'anthropic/claude-sonnet-4.6')).toBe(3_600_000);
    expect(promptCacheTtlMs('OpenRouter', 'qwen/qwen3-coder-plus')).toBe(300_000);
    // Still silent where we have no basis — the pre-existing discipline.
    expect(promptCacheTtlMs('openrouter', 'openai/gpt-5.2')).toBeNull();
    expect(promptCacheTtlMs('openrouter')).toBeNull();
  });
});

describe('the adapter carries no bare ephemeral literal', () => {
  // Mirrors the guard in promptCacheTtl.test.js. Restated here because the
  // reason it still holds changed: OpenRouter introduced a legitimate bare
  // marker, and it lives in THIS module precisely so the adapter guard can
  // stay absolute. If someone later inlines a bare marker into the adapter to
  // "simplify", both tests should fail, not just one.
  // Both files DISCUSS bare markers at length in their comments, so counting
  // raw text would measure the prose rather than the behaviour. Strip comments
  // first: the assertion is about what gets sent, not what gets explained.
  const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('keeps the bare marker in the contract module, not llmAdapters', () => {
    const adapter = codeOnly(fs.readFileSync(
      path.join(__dirname, '../services/orchestrator/llmAdapters.js'),
      'utf8'
    ));
    expect(adapter.match(/\{\s*type:\s*'ephemeral'\s*\}/g) || []).toHaveLength(0);

    const contract = codeOnly(fs.readFileSync(path.join(__dirname, 'openRouterCache.js'), 'utf8'));
    expect((contract.match(/\{\s*type:\s*'ephemeral'\s*\}/g) || []).length).toBe(1);
  });

  it('and the comment-stripper itself works', () => {
    // Otherwise the guard above could pass by stripping everything.
    expect(codeOnly("/* { type: 'ephemeral' } */ const x = 1;")).not.toMatch(/ephemeral/);
    expect(codeOnly("const m = { type: 'ephemeral' };")).toMatch(/ephemeral/);
  });
});

describe('openRouterCacheTtlMs', () => {
  it('is the narrow projection of the contract', () => {
    expect(openRouterCacheTtlMs('anthropic/claude-haiku-4.5')).toBe(3_600_000);
    expect(openRouterCacheTtlMs('openai/gpt-5.2')).toBeNull();
  });
});
