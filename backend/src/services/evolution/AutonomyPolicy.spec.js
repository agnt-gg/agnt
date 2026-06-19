import { describe, it, expect } from 'vitest';
import AutonomyPolicy, { DEFAULTS } from './AutonomyPolicy.js';

const enabled = { autonomy: { enabled: true } };
const insightOk = {
  category: 'memory',
  target_type: 'memory',
  confidence: 0.95,
};

describe('AutonomyPolicy.blastRadiusOf', () => {
  it('uses explicit blast_radius when present', () => {
    expect(AutonomyPolicy.blastRadiusOf({ blast_radius: 0.85 })).toBe(0.85);
  });
  it('falls back to category lookup', () => {
    expect(AutonomyPolicy.blastRadiusOf({ category: 'memory' })).toBe(0.1);
    expect(AutonomyPolicy.blastRadiusOf({ category: 'parameter_tune' })).toBe(0.7);
  });
  it('falls back to target_type when category unknown', () => {
    expect(AutonomyPolicy.blastRadiusOf({ category: 'unknown', target_type: 'workflow' })).toBe(0.7);
    expect(AutonomyPolicy.blastRadiusOf({ category: 'unknown', target_type: 'tool' })).toBe(0.9);
  });
  it('defaults to 0.5 when nothing matches', () => {
    expect(AutonomyPolicy.blastRadiusOf({})).toBe(0.5);
  });
});

describe('AutonomyPolicy.merged', () => {
  it('returns defaults when no settings', () => {
    expect(AutonomyPolicy.merged()).toEqual(DEFAULTS);
    expect(AutonomyPolicy.merged({}).enabled).toBe(false);
  });
  it('overrides per field', () => {
    const merged = AutonomyPolicy.merged({ autonomy: { enabled: true, minConfidence: 0.9 } });
    expect(merged.enabled).toBe(true);
    expect(merged.minConfidence).toBe(0.9);
    expect(merged.maxBlastRadius).toBe(DEFAULTS.maxBlastRadius); // untouched
  });
  it('preserves DEFAULTS.allowedCategories when user omits it', () => {
    const merged = AutonomyPolicy.merged({ autonomy: { enabled: true } });
    expect(merged.allowedCategories).toEqual(DEFAULTS.allowedCategories);
  });
});

describe('AutonomyPolicy.evaluate — safety gates', () => {
  it('SKIPS everything when autonomy is disabled (default)', () => {
    const r = AutonomyPolicy.evaluate(insightOk, {});
    expect(r.decision).toBe('skip');
    expect(r.reason).toBe('autonomy_disabled');
  });

  it('ESCALATES when category not in allowedCategories', () => {
    const r = AutonomyPolicy.evaluate(
      { ...insightOk, category: 'bottleneck' },
      { autonomy: { enabled: true, allowedCategories: ['memory'] } }
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toMatch(/category_not_allowed/);
  });

  it('ESCALATES when confidence below minConfidence', () => {
    const r = AutonomyPolicy.evaluate(
      { ...insightOk, confidence: 0.5 },
      { autonomy: { enabled: true, minConfidence: 0.7 } }
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toMatch(/low_confidence/);
  });

  it('treats missing confidence as 0 → escalates', () => {
    const r = AutonomyPolicy.evaluate(
      { category: 'memory', target_type: 'memory' },
      enabled
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toMatch(/low_confidence/);
  });

  it('ESCALATES when blast radius exceeds maxBlastRadius', () => {
    const r = AutonomyPolicy.evaluate(
      { ...insightOk, blast_radius: 0.9 },
      enabled
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toMatch(/over_blast_radius/);
  });

  it('ESCALATES when daily budget exhausted', () => {
    const r = AutonomyPolicy.evaluate(insightOk, enabled, { budgetExhausted: true });
    expect(r.decision).toBe('escalate');
    expect(r.reason).toBe('daily_budget_exhausted');
  });

  it('GATES (sandbox) when blast radius >= requireGateAbove', () => {
    const r = AutonomyPolicy.evaluate(
      { ...insightOk, blast_radius: 0.5, category: 'skill_recommendation' },
      enabled
    );
    expect(r.decision).toBe('gated');
  });

  it('DIRECT-applies when low blast + high confidence + allowed category', () => {
    const r = AutonomyPolicy.evaluate(
      { ...insightOk, blast_radius: 0.1 }, // memory category, tiny radius
      enabled
    );
    expect(r.decision).toBe('direct');
    expect(r.reason).toBe('low_blast_high_confidence');
  });

  it('returns blastRadius in every response (for telemetry)', () => {
    const r1 = AutonomyPolicy.evaluate(insightOk, {});
    const r2 = AutonomyPolicy.evaluate(insightOk, enabled);
    expect(typeof r1.blastRadius).toBe('number');
    expect(typeof r2.blastRadius).toBe('number');
  });
});

describe('AutonomyPolicy.evaluate — gate ordering', () => {
  it('disabled check wins over everything', () => {
    const dangerous = { category: 'parameter_tune', target_type: 'tool', confidence: 0.99, blast_radius: 0.95 };
    expect(AutonomyPolicy.evaluate(dangerous, { autonomy: { enabled: false } }).decision).toBe('skip');
  });

  it('category filter wins over confidence check', () => {
    const r = AutonomyPolicy.evaluate(
      { category: 'bottleneck', target_type: 'agent', confidence: 0.05 },
      { autonomy: { enabled: true, allowedCategories: ['memory'] } }
    );
    expect(r.reason).toMatch(/category_not_allowed/);
  });

  it('budget exhaustion wins over the direct-apply path', () => {
    const r = AutonomyPolicy.evaluate(insightOk, enabled, { budgetExhausted: true });
    expect(r.decision).toBe('escalate');
  });
});

describe('AutonomyPolicy.DEFAULTS — production safety', () => {
  it('ships disabled by default', () => {
    expect(DEFAULTS.enabled).toBe(false);
  });
  it('requires high confidence by default', () => {
    expect(DEFAULTS.minConfidence).toBeGreaterThanOrEqual(0.7);
  });
  it('caps maxBlastRadius below the most dangerous categories', () => {
    expect(DEFAULTS.maxBlastRadius).toBeLessThan(BLAST_DANGEROUS);
  });
  it('does not allow tool-level mutations by category default', () => {
    expect(DEFAULTS.allowedCategories).not.toContain('parameter_tune');
    expect(DEFAULTS.allowedCategories).not.toContain('bottleneck');
  });
});

const BLAST_DANGEROUS = 0.7; // local threshold for the safety assertion above
