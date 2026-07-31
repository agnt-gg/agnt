import { describe, it, expect } from 'vitest';
import PF from './ProviderFallback.js';

describe('ProviderFallback.parseFallbackList', () => {
  it('parses a JSON string', () => {
    expect(PF.parseFallbackList('[{"provider":"GrokAI","model":"grok-4.5"}]'))
      .toEqual([{ provider: 'GrokAI', model: 'grok-4.5' }]);
  });
  it('returns [] for empty/blank/null', () => {
    expect(PF.parseFallbackList('')).toEqual([]);
    expect(PF.parseFallbackList(null)).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(PF.parseFallbackList('{not json')).toEqual([]);
  });
  it('drops entries with no provider', () => {
    expect(PF.parseFallbackList([{ model: 'x' }, { provider: 'GrokAI' }]))
      .toEqual([{ provider: 'GrokAI', model: null }]);
  });
});

describe('ProviderFallback.isKnownProvider', () => {
  it('unknown provider is false', () => {
    expect(PF.isKnownProvider('totally-fake-xyz')).toBe(false);
  });
  it('empty is false', () => {
    expect(PF.isKnownProvider('')).toBe(false);
  });
});

describe('ProviderFallback.buildProviderChain', () => {
  it('primary always present, no fallback when disabled', () => {
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: false, fallbackProviders: '[{"provider":"GrokAI","model":"grok-4.5"}]' });
    expect(c.length).toBe(1);
    expect(c[0].primary).toBe(true);
    expect(c[0].tier).toBe(0);
  });
  it('caps at MAX_FALLBACKS (chain length <= 4)', () => {
    const many = JSON.stringify([1, 2, 3, 4, 5].map((i) => ({ provider: `fakeprov${i}`, model: `m${i}` })));
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: many });
    expect(c[0].primary).toBe(true);
    expect(c.length).toBeLessThanOrEqual(1 + PF.MAX_FALLBACKS);
  });
  it('dedupes the primary from the fallback list', () => {
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: '[{"provider":"Anthropic","model":"m"}]' });
    expect(c.length).toBe(1);
  });
});

describe('ProviderFallback.classifyFailure', () => {
  it('auth', () => expect(PF.classifyFailure('401 Unauthorized')).toBe('auth'));
  it('cap (Claude Max)', () => expect(PF.classifyFailure('now draw from your extra usage')).toBe('cap'));
  it('overloaded', () => expect(PF.classifyFailure('Overloaded')).toBe('overloaded'));
  it('network', () => expect(PF.classifyFailure('Connection error.')).toBe('network'));
  it('rate_limit', () => expect(PF.classifyFailure('429 rate limit')).toBe('rate_limit'));
  it('unknown', () => expect(PF.classifyFailure('weird')).toBe('unknown'));
});

describe('ProviderFallback.shouldFailover / isCancellation', () => {
  it('recoveredFromError true → failover', () => expect(PF.shouldFailover({ recoveredFromError: true })).toBe(true));
  it('success → no failover', () => expect(PF.shouldFailover({ responseMessage: {} })).toBe(false));
  it('abort is cancellation', () => expect(PF.isCancellation({ name: 'AbortError' })).toBe(true));
  it('normal error is not cancellation', () => expect(PF.isCancellation({ message: '500' })).toBe(false));
});

describe('ProviderFallback.runWithFallback', () => {
  it('primary fails, rolls to tier 1 and succeeds', async () => {
    const chain = [
      { provider: 'A', model: 'a', tier: 0, primary: true },
      { provider: 'B', model: 'b', tier: 1, primary: false },
    ];
    const events = [];
    const { result, tier, attempts } = await PF.runWithFallback({
      chain,
      runOne: async (t) => (t.provider === 'A'
        ? { recoveredFromError: true, recoveredError: 'Overloaded' }
        : { responseMessage: { role: 'assistant', content: 'OK' } }),
      onFallback: (info) => events.push(info),
    });
    expect(tier.provider).toBe('B');
    expect(result.responseMessage.content).toBe('OK');
    expect(events.length).toBe(1);
    expect(events[0].from.provider).toBe('A');
    expect(events[0].to.provider).toBe('B');
    expect(events[0].reason).toBe('overloaded');
    expect(attempts.length).toBe(2);
  });

  it('all tiers fail → returns last failed result (no throw)', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    const { result } = await PF.runWithFallback({
      chain,
      runOne: async () => ({ recoveredFromError: true, recoveredError: '500' }),
    });
    expect(result.recoveredFromError).toBe(true);
  });

  it('cancellation propagates (never fails over)', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    await expect(PF.runWithFallback({
      chain,
      runOne: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    })).rejects.toThrow();
  });

  it('a thrown non-cancellation error on primary rolls to tier 1', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    const { tier } = await PF.runWithFallback({
      chain,
      runOne: async (t) => { if (t.provider === 'A') throw new Error('ECONNRESET boom'); return { responseMessage: { content: 'ok' } }; },
    });
    expect(tier.provider).toBe('B');
  });
});
