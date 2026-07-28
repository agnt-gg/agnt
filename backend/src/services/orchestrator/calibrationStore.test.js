import { describe, it, expect, beforeEach, vi } from 'vitest';

// The store owns a module-level cache, so the db mock has to exist before the
// module is imported and the cache has to be reset between tests.
const rows = [];
const runs = [];
vi.mock('../../models/database/index.js', () => ({
  default: {
    all: (_sql, _p, cb) => cb(null, rows),
    prepare: () => ({
      run: (params, cb) => { runs.push(params); cb(null); },
      finalize: (cb) => cb && cb(),
    }),
  },
}));

const {
  loadCalibrations,
  getCalibration,
  recordCalibration,
  listCalibrations,
  flushCalibrations,
  __resetCalibrationCache,
} = await import('./calibrationStore.js');

beforeEach(() => {
  __resetCalibrationCache();
  rows.length = 0;
  runs.length = 0;
});

describe('getCalibration', () => {
  it('returns null — not 1 — when nothing is known', async () => {
    await loadCalibrations();
    // null and 1 mean different things: "no data" must not be reported as
    // "measured, and there is no drift".
    expect(getCalibration('anthropic', 'claude-opus-5')).toBeNull();
  });

  it('withholds a ratio until enough samples agree', async () => {
    rows.push({ provider: 'anthropic', model: 'm', ratio: 1.3, samples: 2 });
    await loadCalibrations();
    expect(getCalibration('anthropic', 'm')).toBeNull();
  });

  it('returns a learned ratio once it is trustworthy', async () => {
    rows.push({ provider: 'anthropic', model: 'm', ratio: 1.3, samples: 9 });
    await loadCalibrations();
    expect(getCalibration('anthropic', 'm')).toBeCloseTo(1.3, 6);
  });

  it('is case-insensitive on provider and model', async () => {
    rows.push({ provider: 'Claude-Code', model: 'claude-opus-5', ratio: 1.42, samples: 5 });
    await loadCalibrations();
    expect(getCalibration('claude-code', 'CLAUDE-OPUS-5')).toBeCloseTo(1.42, 6);
  });

  it('keys on provider AND model, never bleeding between them', async () => {
    rows.push({ provider: 'p', model: 'a', ratio: 1.1, samples: 5 });
    rows.push({ provider: 'p', model: 'b', ratio: 2.4, samples: 5 });
    await loadCalibrations();
    expect(getCalibration('p', 'a')).toBeCloseTo(1.1, 6);
    expect(getCalibration('p', 'b')).toBeCloseTo(2.4, 6);
    expect(getCalibration('q', 'a')).toBeNull();
  });

  it('survives a failing database instead of breaking chat', async () => {
    __resetCalibrationCache();
    const mod = await import('./calibrationStore.js');
    // Even with no rows loaded the lookup must answer, not throw.
    await expect(mod.loadCalibrations()).resolves.toBeUndefined();
    expect(mod.getCalibration('x', 'y')).toBeNull();
  });
});

describe('recordCalibration', () => {
  it('learns from the first observation', () => {
    recordCalibration('p', 'm', 1.5);
    expect(listCalibrations()).toEqual([{ provider: 'p', model: 'm', ratio: 1.5, samples: 1 }]);
  });

  it('converges toward a stable value rather than chasing the last turn', () => {
    for (let i = 0; i < 30; i++) recordCalibration('p', 'm', 1.3);
    const v = listCalibrations()[0];
    expect(v.ratio).toBeCloseTo(1.3, 2);
    expect(v.samples).toBe(30);

    // A single outlier must not whipsaw a well-established value.
    recordCalibration('p', 'm', 3);
    expect(listCalibrations()[0].ratio).toBeLessThan(1.5);
  });

  it('still moves when the provider genuinely changes', () => {
    for (let i = 0; i < 40; i++) recordCalibration('p', 'm', 1.2);
    for (let i = 0; i < 200; i++) recordCalibration('p', 'm', 2.0);
    // The weight floor (0.1) is what keeps this from freezing permanently.
    expect(listCalibrations()[0].ratio).toBeGreaterThan(1.9);
  });

  it('clamps absurd observations at the persistence boundary', () => {
    recordCalibration('p', 'm', 99);
    expect(listCalibrations()[0].ratio).toBe(3);
    __resetCalibrationCache();
    recordCalibration('p', 'm', 0.01);
    expect(listCalibrations()[0].ratio).toBe(0.5);
  });

  it('ignores unusable observations', () => {
    recordCalibration('p', 'm', 0);
    recordCalibration('p', 'm', -1);
    recordCalibration('p', 'm', NaN);
    recordCalibration('p', 'm', undefined);
    expect(listCalibrations()).toHaveLength(0);
  });
});

describe('flushCalibrations', () => {
  it('writes dirty rows and then stops rewriting them', async () => {
    recordCalibration('p', 'm', 1.4);
    const n = await flushCalibrations();
    expect(n).toBe(1);
    expect(runs[0][0]).toBe('p');
    expect(runs[0][1]).toBe('m');
    expect(runs[0][2]).toBeCloseTo(1.4, 6);

    runs.length = 0;
    expect(await flushCalibrations()).toBe(0);
    expect(runs).toHaveLength(0);
  });

  it('is a no-op when nothing has been learned', async () => {
    expect(await flushCalibrations()).toBe(0);
  });
});
