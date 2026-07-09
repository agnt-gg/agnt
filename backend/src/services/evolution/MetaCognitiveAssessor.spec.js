import { describe, it, expect } from 'vitest';
import MetaCognitiveAssessor from './MetaCognitiveAssessor.js';

const settings = { autonomy: { enabled: false, minConfidence: 0.8, maxBlastRadius: 0.5, requireGateAbove: 0.45, dailyBudget: 20, minDelta: 0.05 } };

describe('MetaCognitiveAssessor.assess', () => {
  it('returns weights + biases + rationale', () => {
    const r = MetaCognitiveAssessor.assess({
      performanceSnapshot: { insights: { pending: 10 }, tools: { successRate: 0.9 } },
      currentSettings: settings,
    });
    expect(r.weights).toBeTruthy();
    expect(r.biases).toBeTruthy();
    expect(r.rationale).toBeTruthy();
  });

  it('tightens safety when reliability is low', () => {
    const r = MetaCognitiveAssessor.assess({
      performanceSnapshot: { insights: { pending: 10 }, tools: { successRate: 0.4 } },
      currentSettings: settings,
    });
    expect(r.weights.safety).toBeGreaterThan(1.1);
    expect(r.biases.maxBlastRadius).toBeLessThanOrEqual(settings.autonomy.maxBlastRadius);
  });

  it('raises dailyBudget when backlog is high and reliability is ok', () => {
    const r = MetaCognitiveAssessor.assess({
      performanceSnapshot: { insights: { pending: 500 }, tools: { successRate: 0.9 } },
      currentSettings: settings,
    });
    expect(r.biases.dailyBudget).toBeGreaterThanOrEqual(settings.autonomy.dailyBudget);
  });
});
