import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { composeChain, MAX_COMPOSED_TIERS } from './chainComposer.js';

const pair = (provider, model) => ({ provider, model });
const names = (chain) => chain.map((t) => `${t.provider}/${t.model}`);

describe('composeChain — the account chain is never lost', () => {
  const routed = [pair('groq', 'llama-8b'), pair('deepseek', 'v4'), pair('gemini', 'flash')];
  const defaults = [pair('anthropic', 'opus'), pair('openai', 'gpt-5.5')];

  it('normal stake: routed picks first, then default, then fallbacks', () => {
    expect(names(composeChain({ routed, defaults }))).toEqual([
      'groq/llama-8b', 'deepseek/v4', 'gemini/flash', 'anthropic/opus', 'openai/gpt-5.5',
    ]);
  });

  it('high stake: account default and fallbacks lead, routed picks are backups', () => {
    expect(names(composeChain({ routed, defaults, stake: 'high' }))).toEqual([
      'anthropic/opus', 'openai/gpt-5.5', 'groq/llama-8b', 'deepseek/v4', 'gemini/flash',
    ]);
  });

  it('a pin is always first, at every stake', () => {
    for (const stake of ['low', 'normal', 'high']) {
      expect(composeChain({ pinned: pair('kimi', 'k2'), routed, defaults, stake })[0]).toMatchObject({ provider: 'kimi', source: 'pinned' });
    }
  });

  it('the cap never drops the account default', () => {
    const many = Array.from({ length: 10 }, (_, i) => pair(`p${i}`, 'm'));
    const chain = composeChain({ routed: many, defaults, maxTiers: 4 });
    expect(chain).toHaveLength(4);
    expect(chain.some((t) => t.source === 'default')).toBe(true);
  });

  it('the cap never drops a pin to make room for the default', () => {
    const chain = composeChain({ pinned: pair('kimi', 'k2'), routed, defaults, maxTiers: 1 });
    expect(names(chain)).toEqual(['kimi/k2']);
  });

  it('caps at MAX_COMPOSED_TIERS by default', () => {
    const many = Array.from({ length: 20 }, (_, i) => pair(`p${i}`, 'm'));
    expect(composeChain({ routed: many, defaults })).toHaveLength(MAX_COMPOSED_TIERS);
  });

  it('dedupes provider+model, keeping the earliest position, case-insensitively', () => {
    const chain = composeChain({ routed: [pair('Anthropic', 'opus')], defaults: [pair('anthropic', 'OPUS')] });
    expect(chain).toHaveLength(1);
    expect(chain[0].source).toBe('routed');
  });

  it('keeps a second model on the same provider (run time decides whether to try it)', () => {
    const chain = composeChain({ routed: [pair('anthropic', 'haiku')], defaults: [pair('anthropic', 'opus')] });
    expect(names(chain)).toEqual(['anthropic/haiku', 'anthropic/opus']);
  });

  it('uses a canonical key when given one', () => {
    const keyOf = (p) => (p.toLowerCase() === 'claude code' ? 'claude-code' : p.toLowerCase());
    const chain = composeChain({ routed: [pair('Claude Code', 'm')], defaults: [pair('claude-code', 'm')], keyOf });
    expect(chain).toHaveLength(1);
  });
});

describe('composeChain — health reorders, never removes', () => {
  it('moves cooling providers to the back, stably', () => {
    const chain = composeChain({
      routed: [pair('groq', 'a'), pair('deepseek', 'b')],
      defaults: [pair('anthropic', 'c'), pair('openai', 'd')],
      isAvailable: (p) => p !== 'groq' && p !== 'anthropic',
    });
    expect(names(chain)).toEqual(['deepseek/b', 'openai/d', 'groq/a', 'anthropic/c']);
  });

  it('an all-unhealthy account still gets a full chain', () => {
    const chain = composeChain({ routed: [pair('groq', 'a')], defaults: [pair('anthropic', 'c')], isAvailable: () => false });
    expect(chain).toHaveLength(2);
  });

  it('a cooling pin keeps its place', () => {
    const chain = composeChain({ pinned: pair('groq', 'a'), defaults: [pair('anthropic', 'c')], isAvailable: (p) => p !== 'groq' });
    expect(chain[0].provider).toBe('groq');
  });

  it('a throwing health check is treated as available', () => {
    const chain = composeChain({ routed: [pair('groq', 'a')], isAvailable: () => { throw new Error('boom'); } });
    expect(names(chain)).toEqual(['groq/a']);
  });
});

describe('composeChain — the shape runWithFallback consumes', () => {
  it('numbers tiers from zero, contiguous, primary only at 0', () => {
    const chain = composeChain({ routed: [pair('groq', 'a')], defaults: [pair('anthropic', 'c'), pair('openai', 'd')] });
    chain.forEach((t, i) => {
      expect(t.tier).toBe(i);
      expect(t.primary).toBe(i === 0);
      expect(typeof t.provider).toBe('string');
      expect('model' in t).toBe(true);
      expect(typeof t.reason).toBe('string');
    });
  });

  it('drops tiers with no provider and tolerates junk input', () => {
    expect(composeChain({ routed: [null, {}, { provider: '' }, pair('groq', 'a')], defaults: 'nope' })).toHaveLength(1);
    expect(composeChain()).toEqual([]);
  });

  it('keeps the routed reason so the failover event can explain itself', () => {
    const [first] = composeChain({ routed: [{ provider: 'groq', model: 'a', reason: 'low stake — cheapest capable' }] });
    expect(first.reason).toBe('low stake — cheapest capable');
  });
});

describe('composeChain stays pure', () => {
  it('imports nothing', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'chainComposer.js'), 'utf8');
    expect(src).not.toMatch(/^import\s/m);
    expect(src).not.toMatch(/\brequire\(|\bprocess\./);
  });
});
