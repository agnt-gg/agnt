import { describe, it, expect } from 'vitest';
import { computeResidualDrift, updateEstimateCalibration } from './contextManager.js';

/**
 * The distinction these tests protect:
 *
 *   calibration = how much we correct the estimate by  (can be 1.3, 2.5, whatever
 *                 the provider's hidden preamble costs)
 *   residual    = how wrong we STILL are after correcting (should sit at ~1.0)
 *
 * The panel reported the first number as "drift", which told the user their
 * figures were 30% wrong while displaying figures that had already been
 * corrected by exactly that 30%.
 */

const usage = (real) => ({ prompt_tokens: real });

describe('computeResidualDrift', () => {
  it('is 1.0 when the applied calibration was exactly right', () => {
    // We estimated 100k, corrected by 1.3 => predicted 130k, provider counted 130k.
    expect(computeResidualDrift(1.3, usage(130_000), 100_000)).toBeCloseTo(1, 6);
  });

  it('stays at 1.0 no matter how large the correction is', () => {
    // A CLI provider injecting a huge preamble needs a 2.5x correction. Once
    // that correction is applied and accurate, there is no drift to report.
    expect(computeResidualDrift(2.5, usage(250_000), 100_000)).toBeCloseTo(1, 6);
    expect(computeResidualDrift(1.05, usage(105_000), 100_000)).toBeCloseTo(1, 6);
  });

  it('reports the leftover when the correction under-shoots', () => {
    // Corrected to 130k, provider counted 143k => 10% still unaccounted for.
    expect(computeResidualDrift(1.3, usage(143_000), 100_000)).toBeCloseTo(1.1, 6);
  });

  it('reports below 1.0 when we over-estimate, since that is drift too', () => {
    expect(computeResidualDrift(1.3, usage(117_000), 100_000)).toBeCloseTo(0.9, 6);
  });

  it('treats a missing or unusable prior as no correction applied', () => {
    expect(computeResidualDrift(undefined, usage(130_000), 100_000)).toBeCloseTo(1.3, 6);
    expect(computeResidualDrift(null, usage(130_000), 100_000)).toBeCloseTo(1.3, 6);
    expect(computeResidualDrift(0, usage(130_000), 100_000)).toBeCloseTo(1.3, 6);
    expect(computeResidualDrift(NaN, usage(130_000), 100_000)).toBeCloseTo(1.3, 6);
  });

  it('ignores rounds too small to carry signal', () => {
    // Fixed per-message overhead dominates below this, so the ratio is noise.
    expect(computeResidualDrift(1.3, usage(4_000), 100_000)).toBeNull();
    expect(computeResidualDrift(1.3, usage(130_000), 4_000)).toBeNull();
    expect(computeResidualDrift(1.3, null, 100_000)).toBeNull();
  });

  it('clamps degenerate values instead of propagating them', () => {
    expect(computeResidualDrift(1, usage(99_000_000), 10_000)).toBe(3);
    expect(computeResidualDrift(1, usage(10_000), 99_000_000)).toBe(0.33);
  });
});

describe('calibration and residual converge together', () => {
  it('drives residual to ~1 as calibration learns a steady provider overhead', () => {
    // A provider whose real requests are consistently 1.6x our raw estimate.
    const RAW = 100_000;
    const REAL = 160_000;

    let calibration;
    let residual = computeResidualDrift(calibration, usage(REAL), RAW);
    // Turn one: no correction applied yet, so the full error shows.
    expect(residual).toBeCloseTo(1.6, 6);

    for (let i = 0; i < 12; i++) {
      calibration = updateEstimateCalibration(calibration, usage(REAL), RAW);
      residual = computeResidualDrift(calibration, usage(REAL), RAW);
    }

    // Calibration has absorbed the overhead...
    expect(calibration).toBeCloseTo(1.6, 2);
    // ...so there is essentially nothing left to report as drift.
    expect(residual).toBeGreaterThan(0.99);
    expect(residual).toBeLessThan(1.01);
  });
});
