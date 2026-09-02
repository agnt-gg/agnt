import { describe, expect, it } from 'vitest';

import { buildModel, expandFootprint, hotFiles, touchRateOf } from './cochange.mjs';

// 10 commits: a.js in 5 of them, b.js always alongside a.js, c.js alone.
const history = [['a.js', 'b.js'], ['a.js', 'b.js'], ['a.js', 'b.js'], ['a.js', 'b.js', 'x.js'], ['a.js', 'b.js'], ['c.js'], ['c.js'], ['d.js'], ['e.js'], ['f.js']];

describe('cochange model', () => {
  const model = buildModel(history);

  it('touchRate is touches over commits', () => {
    const rate = touchRateOf(model);
    expect(rate('a.js')).toBe(0.5);
    expect(rate('c.js')).toBe(0.2);
    expect(rate('never.js')).toBe(0);
  });

  it('hotFiles ranks by rate above a floor', () => {
    expect(hotFiles(model, { minRate: 0.3 }).map((h) => h.file)).toEqual(['a.js', 'b.js']);
  });

  it('expands a footprint with what history says moves together', () => {
    const r = expandFootprint(['a.js'], model);
    expect(r.footprint).toEqual(['a.js', 'b.js']);
    expect(r.added).toEqual([{ file: 'b.js', because: 'a.js', p: 1 }]);
  });

  it('does not expand on a weak or under-supported signal', () => {
    // x.js rode along once in five: p = 0.2, below threshold.
    expect(expandFootprint(['a.js'], model).footprint).not.toContain('x.js');
    // d.js has one observation; nothing is inferred from a single commit.
    expect(expandFootprint(['d.js'], model).added).toEqual([]);
  });

  it('ignores sweeping commits when learning pairs', () => {
    const sweep = Array.from({ length: 50 }, (_, i) => `s${i}.js`);
    const m = buildModel([sweep, sweep, sweep, ['s1.js']]);
    expect(expandFootprint(['s1.js'], m).added).toEqual([]);
    expect(touchRateOf(m)('s1.js')).toBe(1); // but the touch count still counts
  });
});
