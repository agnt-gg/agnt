import { describe, it, expect } from 'vitest';
import VerifierGate, { calculateComposite, DEFAULT_MIN_DELTA } from './VerifierGate.js';

const STRUCTURED = '# Heading\n1. Step one\n2. Step two\n';

describe('calculateComposite', () => {
  it('weights correctness 0.5, procedure 0.3, conciseness 0.2', () => {
    const c = calculateComposite({ correctness: 1, procedureFollowing: 1, conciseness: 1 });
    expect(c).toBe(1);
  });
  it('handles missing dimensions as 0', () => {
    expect(calculateComposite({})).toBe(0);
    expect(calculateComposite({ correctness: 1 })).toBe(0.5);
  });
  it('rounds to 3 decimal places', () => {
    const c = calculateComposite({ correctness: 0.333, procedureFollowing: 0.333, conciseness: 0.333 });
    expect(c).toBeCloseTo(0.333, 3);
  });
});

describe('VerifierGate.validateConstraints — size + growth + structure', () => {
  it('passes when candidate is under size limit', () => {
    const r = VerifierGate.validateConstraints(STRUCTURED, null, { requireStructure: true });
    const sizeGate = r.find((g) => g.name === 'size_limit');
    expect(sizeGate.passed).toBe(true);
  });
  it('fails when candidate exceeds size limit', () => {
    const big = '# x\n1. a\n' + 'x'.repeat(20_000);
    const r = VerifierGate.validateConstraints(big, null, { sizeLimit: 15360 });
    const sizeGate = r.find((g) => g.name === 'size_limit');
    expect(sizeGate.passed).toBe(false);
  });
  it('fails growth check when candidate is 50% larger than baseline (>20% default)', () => {
    const base = '# h\n1. step\n';
    const cand = base + 'x'.repeat(base.length); // doubled
    const r = VerifierGate.validateConstraints(cand, base);
    const growthGate = r.find((g) => g.name === 'growth_limit');
    expect(growthGate.passed).toBe(false);
  });
  it('passes growth check when candidate is within 20%', () => {
    const base = '# h\n1. step\n' + 'x'.repeat(100);
    const cand = base + 'y'.repeat(10); // ~9% growth
    const r = VerifierGate.validateConstraints(cand, base);
    const growthGate = r.find((g) => g.name === 'growth_limit');
    expect(growthGate.passed).toBe(true);
  });
  it('fails non_empty for whitespace-only', () => {
    const r = VerifierGate.validateConstraints('   \n\t  ', null, { requireStructure: false });
    expect(r.find((g) => g.name === 'non_empty').passed).toBe(false);
  });
  it('fails structure when missing headers', () => {
    const r = VerifierGate.validateConstraints('1. step\n2. step\n', null);
    expect(r.find((g) => g.name === 'structure').passed).toBe(false);
  });
  it('fails structure when missing numbered/bulleted steps', () => {
    const r = VerifierGate.validateConstraints('# title only', null);
    expect(r.find((g) => g.name === 'structure').passed).toBe(false);
  });
  it('passes structure with # heading + bullet (-) list', () => {
    const r = VerifierGate.validateConstraints('# heading\n- bullet\n', null);
    expect(r.find((g) => g.name === 'structure').passed).toBe(true);
  });
  it('skips structure when requireStructure=false', () => {
    const r = VerifierGate.validateConstraints('just plain prose', null, { requireStructure: false });
    expect(r.find((g) => g.name === 'structure')).toBeUndefined();
  });
});

describe('VerifierGate.verify — decision matrix', () => {
  const goodControl = { correctness: 0.5, procedureFollowing: 0.5, conciseness: 0.5 };
  const goodTreatment = { correctness: 0.8, procedureFollowing: 0.7, conciseness: 0.7 };

  it('KEEPs when delta > minDelta and gates pass (or no gates)', () => {
    const r = VerifierGate.verify({
      controlMetrics: goodControl,
      treatmentMetrics: goodTreatment,
    });
    expect(r.delta).toBeGreaterThan(DEFAULT_MIN_DELTA);
    expect(r.decision).toBe('keep');
    expect(r.pass).toBe(true);
  });

  it('DISCARDs when delta is zero or negative', () => {
    const r = VerifierGate.verify({
      controlMetrics: goodTreatment,
      treatmentMetrics: goodControl, // regression
    });
    expect(r.delta).toBeLessThan(0);
    expect(r.decision).toBe('discard');
    expect(r.pass).toBe(false);
  });

  it('DISCARDs when delta is positive but below minDelta', () => {
    const tinyImprovement = { correctness: 0.51, procedureFollowing: 0.51, conciseness: 0.51 };
    const r = VerifierGate.verify({
      controlMetrics: goodControl,
      treatmentMetrics: tinyImprovement,
      minDelta: 0.05,
    });
    expect(r.delta).toBeLessThan(0.05);
    expect(r.decision).toBe('discard');
  });

  it('ITERATEs when score improves but constraint gates fail', () => {
    const r = VerifierGate.verify({
      controlMetrics: goodControl,
      treatmentMetrics: goodTreatment,
      candidateText: '   ', // fails non_empty
      baselineText: STRUCTURED,
    });
    expect(r.delta).toBeGreaterThan(DEFAULT_MIN_DELTA);
    expect(r.allGatesPass).toBe(false);
    expect(r.decision).toBe('iterate');
    expect(r.pass).toBe(false);
  });

  it('honors a custom minDelta threshold', () => {
    const r = VerifierGate.verify({
      controlMetrics: goodControl,
      treatmentMetrics: goodTreatment,
      minDelta: 0.5, // raise the bar above the actual improvement
    });
    expect(r.decision).toBe('discard');
  });

  it('averages runs when metrics not pre-computed', () => {
    const r = VerifierGate.verify({
      controlRuns: [{ metrics: goodControl }, { metrics: goodControl }],
      treatmentRuns: [{ metrics: goodTreatment }, { metrics: goodTreatment }],
    });
    expect(r.decision).toBe('keep');
    expect(r.controlMetrics.correctness).toBe(goodControl.correctness);
  });

  it('confidence rises with sample size, capped at 1', () => {
    const small = VerifierGate.verify({
      controlRuns: [{ metrics: goodControl }],
      treatmentRuns: [{ metrics: goodTreatment }],
    });
    const large = VerifierGate.verify({
      controlRuns: Array(20).fill({ metrics: goodControl }),
      treatmentRuns: Array(20).fill({ metrics: goodTreatment }),
    });
    expect(small.confidence).toBeLessThan(large.confidence);
    expect(large.confidence).toBeLessThanOrEqual(1);
  });

  it('returns per-dimension deltas', () => {
    const r = VerifierGate.verify({
      controlMetrics: goodControl,
      treatmentMetrics: goodTreatment,
    });
    expect(r.perDimension.correctness.delta).toBeCloseTo(0.3, 5);
    expect(r.perDimension.procedure.delta).toBeCloseTo(0.2, 5);
    expect(r.perDimension.conciseness.delta).toBeCloseTo(0.2, 5);
  });

  it('handles empty inputs without throwing', () => {
    const r = VerifierGate.verify({});
    expect(r.decision).toBe('discard');
    expect(r.delta).toBe(0);
  });
});

describe('VerifierGate.verify — gate ordering invariants', () => {
  it('decision=keep ⇒ pass=true', () => {
    const r = VerifierGate.verify({
      controlMetrics: { correctness: 0, procedureFollowing: 0, conciseness: 0 },
      treatmentMetrics: { correctness: 1, procedureFollowing: 1, conciseness: 1 },
    });
    expect(r.decision).toBe('keep');
    expect(r.pass).toBe(true);
  });
  it('decision=iterate ⇒ pass=false (so router does not promote)', () => {
    // NOTE: empty string '' is falsy and skips constraint validation entirely
    // (see `candidateText ? validate : []` in source). Use whitespace to make
    // constraints actually run and fail non_empty.
    const r = VerifierGate.verify({
      controlMetrics: { correctness: 0, procedureFollowing: 0, conciseness: 0 },
      treatmentMetrics: { correctness: 1, procedureFollowing: 1, conciseness: 1 },
      candidateText: '   ',
      baselineText: STRUCTURED,
    });
    expect(r.decision).toBe('iterate');
    expect(r.pass).toBe(false);
  });
  it('decision=discard ⇒ pass=false', () => {
    const r = VerifierGate.verify({
      controlMetrics: { correctness: 1, procedureFollowing: 1, conciseness: 1 },
      treatmentMetrics: { correctness: 0, procedureFollowing: 0, conciseness: 0 },
    });
    expect(r.decision).toBe('discard');
    expect(r.pass).toBe(false);
  });
});
