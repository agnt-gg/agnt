// The pure chooser in simpleStarters.js. (Named apart from SimpleStarters.spec.js,
// the component's test: on a case-insensitive filesystem the two would be one file.)
import { describe, it, expect } from 'vitest';
import { LANES, STARTERS, STARTER_SLOTS, starterAt, createStarterRotation } from './simpleStarters.js';

// Deterministic PRNG so a failure reproduces.
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const lanesOf = (indices) => indices.map((i) => STARTERS[i][0]);

describe('starter data', () => {
  it('every starter names a known lane and has a one-line label and a real prompt', () => {
    expect(STARTERS.length).toBe(37);
    for (const [lane, label, prompt] of STARTERS) {
      expect(LANES[lane], lane).toBeTruthy();
      expect(label.length).toBeLessThanOrEqual(32);
      expect(prompt.length).toBeGreaterThan(label.length);
    }
  });

  it('starterAt shapes one for rendering', () => {
    const s = starterAt(0);
    expect(s).toMatchObject({ index: 0, lane: 'build', laneLabel: 'Build', label: 'Make me an agent' });
    expect(s.icon).toContain('<path');
  });
});

describe('createStarterRotation', () => {
  it('fills three distinct cards from three different lanes', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const shown = createStarterRotation({ random: seeded(seed) }).fill();
      expect(shown).toHaveLength(STARTER_SLOTS);
      expect(new Set(shown).size).toBe(STARTER_SLOTS);
      expect(new Set(lanesOf(shown)).size).toBe(STARTER_SLOTS);
    }
  });

  it('swapOne changes one card at a time, round-robin, and keeps lanes distinct', () => {
    const r = createStarterRotation({ random: seeded(7) });
    let before = r.fill();
    for (let step = 0; step < 60; step++) {
      const { slot, index } = r.swapOne();
      expect(slot).toBe(step % STARTER_SLOTS);
      const after = r.shown();
      expect(after[slot]).toBe(index);
      after.forEach((v, s) => {
        if (s !== slot) expect(v).toBe(before[s]); // the other two stay put
      });
      expect(new Set(after).size).toBe(STARTER_SLOTS);
      expect(new Set(lanesOf(after)).size).toBe(STARTER_SLOTS);
      before = after;
    }
  });

  it('every idea comes round (regression: the demo skipped lane-clashes for a whole lap, 23 of 37 seen)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = createStarterRotation({ random: seeded(seed) });
      const seen = new Set(r.fill());
      for (let i = 0; i < STARTERS.length * 2; i++) seen.add(r.swapOne().index);
      expect(seen.size, `seed ${seed}`).toBe(STARTERS.length);
    }
  });

  it('different visits get different mixes', () => {
    const a = createStarterRotation({ random: seeded(1) }).fill();
    const b = createStarterRotation({ random: seeded(2) }).fill();
    expect(a).not.toEqual(b);
  });

  it('swapOne before fill still produces a full, valid set', () => {
    const r = createStarterRotation({ random: seeded(9) });
    r.swapOne();
    expect(r.shown()).toHaveLength(STARTER_SLOTS);
  });
});
