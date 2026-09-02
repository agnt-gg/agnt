import { describe, expect, it } from 'vitest';

import { conflictGraph, packWaves } from './wave-pack.mjs';

const t = (id, footprint, extra = {}) => ({ id, footprint, score: 1, ...extra });

const noSharedFiles = (wave) => {
  const seen = new Set();
  for (const x of wave) for (const f of x.footprint ?? []) {
    if (seen.has(f)) return false;
    seen.add(f);
  }
  return true;
};

describe('packWaves', () => {
  it('puts disjoint tickets in one wave', () => {
    const { waves } = packWaves([t('a', ['x.js']), t('b', ['y.js']), t('c', ['z.js'])]);
    expect(waves.length).toBe(1);
    expect(waves[0].map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('defers a ticket that shares a file with one already admitted', () => {
    const { waves } = packWaves([t('a', ['x.js'], { score: 3 }), t('b', ['x.js', 'y.js'], { score: 2 }), t('c', ['z.js'], { score: 1 })]);
    expect(waves.map((w) => w.map((x) => x.id))).toEqual([['a', 'c'], ['b']]);
    for (const w of waves) expect(noSharedFiles(w)).toBe(true);
  });

  it('admits in score order so the best work goes first', () => {
    const { waves } = packWaves([t('low', ['x.js'], { score: 1 }), t('high', ['x.js'], { score: 9 })]);
    expect(waves[0][0].id).toBe('high');
  });

  it('never packs two tickets that both touch a chokepoint, even different ones', () => {
    const chokepoints = new Set(['hot1.js', 'hot2.js']);
    const { waves } = packWaves([t('a', ['hot1.js']), t('b', ['hot2.js']), t('c', ['cold.js'])], { chokepoints });
    expect(waves.map((w) => w.map((x) => x.id))).toEqual([['a', 'c'], ['b']]);
  });

  it('runs an unknown footprint alone — unknown means everything', () => {
    const { waves } = packWaves([t('known', ['x.js'], { score: 1 }), t('unknown', [], { score: 5 })]);
    expect(waves.map((w) => w.map((x) => x.id))).toEqual([['unknown'], ['known']]);
  });

  it('runs high-risk work alone', () => {
    const { waves } = packWaves([t('a', ['x.js'], { score: 5 }), t('auth', ['auth.js'], { risk: 'high', score: 4 }), t('b', ['y.js'], { score: 3 })]);
    expect(waves.map((w) => w.map((x) => x.id))).toEqual([['a', 'b'], ['auth']]);
  });

  it('holds back a ticket whose blocker has not landed', () => {
    const { waves, deferred } = packWaves([t('a', ['x.js']), t('b', ['y.js'], { blockedBy: ['a'] }), t('c', ['z.js'], { blockedBy: ['landed-1'] })], {
      landed: new Set(['landed-1']),
    });
    expect(waves[0].map((x) => x.id)).toEqual(['a', 'c']);
    expect(deferred).toEqual([{ id: 'b', blockedBy: ['a'] }]);
  });

  it('respects a wave cap', () => {
    const { waves } = packWaves([t('a', ['1']), t('b', ['2']), t('c', ['3'])], { maxWave: 2 });
    expect(waves.map((w) => w.length)).toEqual([2, 1]);
  });

  it('every ticket lands in exactly one wave', () => {
    const tickets = Array.from({ length: 40 }, (_, i) => t(`t${i}`, [`f${i % 7}.js`, `g${i % 11}.js`], { score: i % 5 }));
    const { waves } = packWaves(tickets);
    const ids = waves.flat().map((x) => x.id).sort();
    expect(ids).toEqual(tickets.map((x) => x.id).sort());
    for (const w of waves) expect(noSharedFiles(w)).toBe(true);
  });
});

describe('conflictGraph', () => {
  it('one edge per colliding pair, naming the shared files', () => {
    const edges = conflictGraph([t('a', ['x.js', 'y.js']), t('b', ['y.js']), t('c', ['z.js'])]);
    expect(edges).toEqual([{ a: 'a', b: 'b', shared: ['y.js'] }]);
  });
});
