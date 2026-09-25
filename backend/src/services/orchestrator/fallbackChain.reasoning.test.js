/**
 * Per-tier reasoning effort on fallback chains: stored, carried into the
 * chain, and turned into adapter options — without changing anything for a
 * chain saved before tiers could carry an effort.
 */
import { describe, it, expect } from 'vitest';
import { parseFallbackChain, serializeFallbackChain, normalizeTierReasoning } from './fallbackChain.js';
import { parseFallbackList, buildProviderChain, tierReasoningOptions } from './ProviderFallback.js';

describe('normalizeTierReasoning', () => {
  it('keeps a plausible effort token, lowercased', () => {
    expect(normalizeTierReasoning('xhigh')).toBe('xhigh');
    expect(normalizeTierReasoning('  High ')).toBe('high');
    expect(normalizeTierReasoning('default')).toBe('default');
  });

  it('treats anything else as unset', () => {
    for (const v of [undefined, null, '', '   ', 7, {}, 'not an effort!', 'x'.repeat(40), '1high']) {
      expect(normalizeTierReasoning(v)).toBeNull();
    }
  });
});

describe('storage (users / agents fallback_providers column)', () => {
  it('round-trips a tier effort', () => {
    const json = serializeFallbackChain([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
    expect(parseFallbackChain(json)).toEqual([{ provider: 'Grok-Build', model: 'grok-4.7', reasoning: 'xhigh' }]);
  });

  it('keeps the exact pre-existing shape when no effort is set', () => {
    expect(parseFallbackChain([{ provider: 'OpenAI', model: null }])).toEqual([{ provider: 'OpenAI', model: null }]);
    expect(parseFallbackChain([{ provider: 'OpenAI', model: 'gpt-5.5', reasoning: '' }]))
      .toEqual([{ provider: 'OpenAI', model: 'gpt-5.5' }]);
  });

  it('drops a malformed effort instead of storing it', () => {
    expect(parseFallbackChain([{ provider: 'OpenAI', model: 'gpt-5.5', reasoning: 'DROP TABLE' }]))
      .toEqual([{ provider: 'OpenAI', model: 'gpt-5.5' }]);
  });
});

describe('chain building', () => {
  it('parseFallbackList carries the effort', () => {
    expect(parseFallbackList([{ provider: 'grok-build', model: 'grok-4.7', reasoning: 'low' }]))
      .toEqual([{ provider: 'grok-build', model: 'grok-4.7', reasoning: 'low' }]);
  });

  it('a configured tier effort reaches the chain; an unconfigured tier has no key', () => {
    const chain = buildProviderChain({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'grok-build', model: 'grok-4.7', reasoning: 'xhigh' },
        { provider: 'openai', model: null },
      ],
    });
    const grok = chain.find((t) => t.provider === 'grok-build');
    expect(grok).toMatchObject({ model: 'grok-4.7', reasoning: 'xhigh', primary: false });
    const openai = chain.find((t) => t.provider === 'openai');
    expect(openai).toBeDefined();
    expect('reasoning' in openai).toBe(false);
    expect('reasoning' in chain[0]).toBe(false);
  });
});

describe('tierReasoningOptions', () => {
  const inherited = { reasoningEnabled: true, reasoningValue: 'max' };

  it('a tier with its own effort uses it', () => {
    expect(tierReasoningOptions({ primary: false, reasoning: 'low' }, inherited))
      .toEqual({ reasoningValue: 'low', reasoningEnabled: true });
  });

  it('"default" on a tier means the provider default, with reasoning not forced on', () => {
    expect(tierReasoningOptions({ primary: false, reasoning: 'default' }, inherited))
      .toEqual({ reasoningValue: 'default', reasoningEnabled: false });
  });

  it('a tier without an effort inherits exactly what the caller passed before', () => {
    expect(tierReasoningOptions({ primary: false }, inherited)).toBe(inherited);
    // Autonomous loop passed no options at all; it still gets none.
    expect(tierReasoningOptions({ primary: false })).toEqual({});
  });

  it('the primary never takes a tier effort', () => {
    expect(tierReasoningOptions({ primary: true, reasoning: 'low' }, inherited)).toBe(inherited);
  });
});
