import { describe, it, expect } from 'vitest';
import { hasContextActivity } from './contextActivity.js';

describe('hasContextActivity', () => {
  it('is false for a brand-new conversation', () => {
    expect(hasContextActivity()).toBe(false);
    expect(hasContextActivity({})).toBe(false);
    expect(hasContextActivity({
      contextStatus: { currentTokens: 0, tokenLimit: 0, model: 'N/A' },
      totalTokenUsage: {},
      totalCost: 0,
      executionsCount: 0,
      rounds: [],
    })).toBe(false);
  });

  it('REGRESSION: a known context window is not evidence of a conversation', () => {
    // This is the whole bug. Selecting a model populates tokenLimit before a
    // single message exists, and the panel reported "0% full · 0 / 1.0M".
    expect(hasContextActivity({
      contextStatus: { currentTokens: 0, tokenLimit: 1_000_000, model: 'claude-opus-5' },
      totalCost: 0,
      executionsCount: 0,
      rounds: [],
    })).toBe(false);
  });

  it('turns true the moment a request is sized', () => {
    expect(hasContextActivity({ contextStatus: { currentTokens: 1, tokenLimit: 1_000_000 } })).toBe(true);
  });

  it('accepts any single piece of real evidence on its own', () => {
    const cases = [
      { contextStatus: { messagesCount: 2 } },
      { totalCost: 0.0001 },
      { executionsCount: 1 },
      { rounds: [{ tokens: 500 }] },
      { totalTokenUsage: { inputTokens: 120 } },
      { totalTokenUsage: { outputTokens: 30 } },
    ];
    for (const c of cases) expect(hasContextActivity(c)).toBe(true);
  });

  it('ignores fields that carry no measurement', () => {
    expect(hasContextActivity({
      contextStatus: { tokenLimit: 400_000, model: 'gpt-5.2', breakdown: { systemTokens: 0 } },
      totalUncachedCost: null,
      subscriptionBased: true,
      growthPerTurn: 0,
    })).toBe(false);
  });

  it('does not throw or coerce nonsense into truth', () => {
    expect(hasContextActivity({ contextStatus: null, totalTokenUsage: null, rounds: null })).toBe(false);
    expect(hasContextActivity({ totalCost: NaN, executionsCount: undefined })).toBe(false);
    expect(hasContextActivity({ totalCost: 'not a number', rounds: 'nope' })).toBe(false);
  });

  it('treats a negative balance as activity, since something was measured', () => {
    // Defensive: a credited/refunded turn still happened.
    expect(hasContextActivity({ executionsCount: 3, totalCost: 0 })).toBe(true);
  });
});
