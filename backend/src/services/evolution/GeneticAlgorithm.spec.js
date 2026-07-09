import { describe, it, expect, vi } from 'vitest';
import GeneticAlgorithm from './GeneticAlgorithm.js';

const baseSettings = {
  autonomy: {
    enabled: false,
    minConfidence: 0.8,
    minDelta: 0.05,
    maxBlastRadius: 0.5,
    requireGateAbove: 0.45,
    dailyBudget: 20,
    allowedCategories: ['memory'],
  }
};

describe('GeneticAlgorithm.normalizeGenome', () => {
  it('never flips enabled to true', () => {
    const g = GeneticAlgorithm.normalizeGenome({ enabled: true }, baseSettings.autonomy);
    expect(g.enabled).toBe(false);
  });

  it('clamps parameters into conservative bounds', () => {
    const g = GeneticAlgorithm.normalizeGenome({
      minConfidence: 0.1,
      minDelta: 9,
      maxBlastRadius: 9,
      requireGateAbove: -1,
      dailyBudget: 9999,
    }, baseSettings.autonomy);

    expect(g.minConfidence).toBeGreaterThanOrEqual(0.65);
    expect(g.minConfidence).toBeLessThanOrEqual(0.95);
    expect(g.maxBlastRadius).toBeLessThanOrEqual(0.7);
    expect(g.requireGateAbove).toBeGreaterThanOrEqual(0.25);
    expect(g.dailyBudget).toBeLessThanOrEqual(200);
  });

  it('enforces requireGateAbove <= maxBlastRadius', () => {
    const g = GeneticAlgorithm.normalizeGenome({
      maxBlastRadius: 0.3,
      requireGateAbove: 0.6,
    }, baseSettings.autonomy);
    expect(g.requireGateAbove).toBeLessThanOrEqual(g.maxBlastRadius);
  });
});

describe('GeneticAlgorithm.fitness', () => {
  it('returns a stable schema (score + components) for empty insights', () => {
    const r = GeneticAlgorithm.fitness({ genome: baseSettings.autonomy, baseSettings, insights: [] });
    expect(typeof r.score).toBe('number');
    expect(r.components).toBeTruthy();
    expect(r.counts.total).toBe(1); // guarded
  });

  it('prefers lower avgBlast when throughput equal', () => {
    const insights = [
      { category: 'memory', target_type: 'memory', confidence: 0.95, blast_radius: 0.1 },
      { category: 'memory', target_type: 'memory', confidence: 0.95, blast_radius: 0.6 },
    ];

    const conservative = GeneticAlgorithm.fitness({
      genome: { ...baseSettings.autonomy, maxBlastRadius: 0.3, requireGateAbove: 0.25, minConfidence: 0.8 },
      baseSettings,
      insights,
    });

    const permissive = GeneticAlgorithm.fitness({
      genome: { ...baseSettings.autonomy, maxBlastRadius: 0.7, requireGateAbove: 0.65, minConfidence: 0.8 },
      baseSettings,
      insights,
    });

    expect(conservative.components.avgBlast).toBeLessThanOrEqual(permissive.components.avgBlast);
  });
});

describe('GeneticAlgorithm.evolve', () => {
  it('returns a best candidate without throwing', () => {
    // Make randomness deterministic for test stability.
    vi.spyOn(Math, 'random').mockReturnValue(0.42);

    const best = GeneticAlgorithm.evolve({
      baseSettings,
      insights: [
        { category: 'memory', target_type: 'memory', confidence: 0.95, blast_radius: 0.1 },
        { category: 'memory', target_type: 'memory', confidence: 0.8, blast_radius: 0.2 },
      ],
      populationSize: 12,
      generations: 3,
      eliteCount: 4,
    });

    expect(best).toBeTruthy();
    expect(typeof best.score).toBe('number');
    expect(best.genome.enabled).toBe(false);

    Math.random.mockRestore();
  });
});
