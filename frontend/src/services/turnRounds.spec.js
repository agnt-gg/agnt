import { describe, it, expect, beforeEach } from 'vitest';
import { applyContextStatusRound, markPrefixBreak } from './turnRounds.js';

let ms;
beforeEach(() => {
  ms = { turnRounds: [], prevTurnStartTokens: null, growthPerTurn: 0 };
});

const status = (round, currentTokens, tokenLimit = 1_000_000) =>
  ({ round, currentTokens, tokenLimit });

describe('applyContextStatusRound', () => {
  it('records one entry per request in the turn', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    applyContextStatusRound(ms, status(2, 250_000));
    applyContextStatusRound(ms, status(3, 400_000));
    expect(ms.turnRounds.map((r) => r.tokens)).toEqual([100_000, 250_000, 400_000]);
    expect(ms.turnRounds.map((r) => r.round)).toEqual([1, 2, 3]);
  });

  it('starts a fresh list when the next turn begins', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    applyContextStatusRound(ms, status(2, 250_000));
    applyContextStatusRound(ms, status(1, 300_000));
    expect(ms.turnRounds).toHaveLength(1);
    expect(ms.turnRounds[0].tokens).toBe(300_000);
  });

  it('measures growth between the starts of consecutive turns', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    // Tool rounds inside a turn must NOT be mistaken for turn growth.
    applyContextStatusRound(ms, status(2, 900_000));
    expect(ms.growthPerTurn).toBe(0);

    applyContextStatusRound(ms, status(1, 173_000));
    expect(ms.growthPerTurn).toBe(73_000);
  });

  it('reports no growth on the very first turn rather than guessing', () => {
    applyContextStatusRound(ms, status(1, 500_000));
    expect(ms.growthPerTurn).toBe(0);
    expect(ms.prevTurnStartTokens).toBe(500_000);
  });

  it('never reports negative growth after context management shrinks a turn', () => {
    applyContextStatusRound(ms, status(1, 800_000));
    applyContextStatusRound(ms, status(1, 300_000));
    expect(ms.growthPerTurn).toBe(0);
  });

  it('treats a missing round number as round 1 (degrades to old behaviour)', () => {
    applyContextStatusRound(ms, { currentTokens: 50_000, tokenLimit: 1_000_000 });
    expect(ms.turnRounds).toHaveLength(1);
    expect(ms.turnRounds[0].round).toBe(1);
  });

  it('carries the window limit through for each round', () => {
    applyContextStatusRound(ms, status(1, 10, 200_000));
    expect(ms.turnRounds[0].limit).toBe(200_000);
  });

  it('is a no-op on missing state or payload', () => {
    expect(() => applyContextStatusRound(null, status(1, 1))).not.toThrow();
    expect(() => applyContextStatusRound(ms, null)).not.toThrow();
    expect(ms.turnRounds).toHaveLength(0);
  });

  it('rebuilds a missing rounds array rather than throwing', () => {
    const bare = { prevTurnStartTokens: null, growthPerTurn: 0 };
    applyContextStatusRound(bare, status(2, 42));
    expect(bare.turnRounds[1].tokens).toBe(42);
  });

  it('overwrites a repeated round instead of appending a duplicate', () => {
    applyContextStatusRound(ms, status(1, 100));
    applyContextStatusRound(ms, status(2, 200));
    applyContextStatusRound(ms, status(2, 250));
    expect(ms.turnRounds).toHaveLength(2);
    expect(ms.turnRounds[1].tokens).toBe(250);
  });
});

describe('markPrefixBreak', () => {
  it('marks round 1 when the manifest reports a broken prefix', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    applyContextStatusRound(ms, status(2, 200_000));
    markPrefixBreak(ms, { cache: { prefixStable: false } });
    expect(ms.turnRounds[0].prefixBroke).toBe(true);
    // Never inferred onto a later round.
    expect(ms.turnRounds[1].prefixBroke).toBe(false);
  });

  it('leaves a stable prefix unmarked', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    markPrefixBreak(ms, { cache: { prefixStable: true } });
    expect(ms.turnRounds[0].prefixBroke).toBe(false);
  });

  it('survives a manifest with no cache block at all', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    expect(() => markPrefixBreak(ms, {})).not.toThrow();
    expect(() => markPrefixBreak(ms, null)).not.toThrow();
    expect(ms.turnRounds[0].prefixBroke).toBe(false);
  });

  it('does not throw when the manifest arrives before any round', () => {
    expect(() => markPrefixBreak(ms, { cache: { prefixStable: false } })).not.toThrow();
  });

  it('keeps the mark when later rounds arrive in the same turn', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    markPrefixBreak(ms, { cache: { prefixStable: false } });
    applyContextStatusRound(ms, status(2, 200_000));
    expect(ms.turnRounds[0].prefixBroke).toBe(true);
  });

  it('clears the mark when a new turn starts', () => {
    applyContextStatusRound(ms, status(1, 100_000));
    markPrefixBreak(ms, { cache: { prefixStable: false } });
    applyContextStatusRound(ms, status(1, 150_000));
    expect(ms.turnRounds[0].prefixBroke).toBe(false);
  });
});
