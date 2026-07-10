import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks: avoid DB.
const settingsMock = {
  autonomy: {
    enabled: false,
    minConfidence: 0.8,
    minDelta: 0.05,
    maxBlastRadius: 0.5,
    requireGateAbove: 0.45,
    dailyBudget: 20,
    allowedCategories: ['memory', 'prompt_refinement'],
  },
};

vi.mock('../../models/EvolutionSettingsModel.js', () => ({
  default: {
    get: vi.fn(async () => settingsMock),
    update: vi.fn(async (_uid, patch) => ({ ...settingsMock, ...patch, autonomy: { ...settingsMock.autonomy, ...(patch.autonomy || {}) } })),
  },
}));

vi.mock('../../models/InsightModel.js', () => ({
  default: {
    create: vi.fn(async () => 'insight-1'),
    findByUserId: vi.fn(async (_uid, opts) => {
      if (opts?.status !== 'pending') return [];
      return [
        { category: 'memory', target_type: 'memory', confidence: 0.95, blast_radius: 0.1 },
        { category: 'prompt_refinement', target_type: 'agent', confidence: 0.85, blast_radius: 0.3 },
      ];
    }),
  },
}));

// CoreEvolutionSystem no longer updates settings directly on apply=true.
// It routes a parameter_tune insight through the existing router.
vi.mock('./InsightAutonomyRouter.js', () => ({
  default: {
    route: vi.fn(async () => ({ decision: 'skip', reason: 'autonomy_disabled', applied: false })),
  },
}));

vi.mock('./PerformanceMonitor.js', () => ({
  default: {
    snapshotUser: vi.fn(async () => ({ insights: { pending: 2 }, tools: { successRate: 0.9 } })),
  },
}));

// One receipt per run: create() writes it, markApplied() stamps routing outcome on the same row.
vi.mock('../../models/EvolutionCoreRunModel.js', () => ({
  default: {
    create: vi.fn(async () => 'run-1'),
    markApplied: vi.fn(async () => true),
  },
}));

// Import after mocks
const CoreEvolutionSystem = (await import('./CoreEvolutionSystem.js')).default;
const EvolutionCoreRunModel = (await import('../../models/EvolutionCoreRunModel.js')).default;

describe('CoreEvolutionSystem.runForUser', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
  });

  it('returns a recommendation with baseline + best + delta', async () => {
    const r = await CoreEvolutionSystem.runForUser('u1', { generations: 2, populationSize: 10, eliteCount: 4, apply: false });
    expect(r.schema).toBe('AGNT_CORE_EVOLUTION_RECOMMENDATION.v0.1');
    expect(r.baseline).toBeTruthy();
    expect(r.best).toBeTruthy();
    expect(typeof r.delta).toBe('number');
    expect(r.applied).toBe(false);
    // should not flip enabled
    expect(r.best.genome.enabled).toBe(false);
  });

  it('routes apply requests through the autonomy router (no direct settings write)', async () => {
    const r = await CoreEvolutionSystem.runForUser('u1', { generations: 2, populationSize: 10, eliteCount: 4, apply: true });
    expect(r.applied).toBe(false);
    expect(r.applyInsightId).toBe('insight-1');
    expect(r.applyRouted.decision).toBe('skip');
    expect(r.applyRouted.reason).toBe('autonomy_disabled');
  });

  it('writes exactly one receipt per applied run and stamps the routing outcome on it', async () => {
    EvolutionCoreRunModel.create.mockClear();
    EvolutionCoreRunModel.markApplied.mockClear();

    const r = await CoreEvolutionSystem.runForUser('u1', { generations: 2, populationSize: 10, eliteCount: 4, apply: true });

    expect(EvolutionCoreRunModel.create).toHaveBeenCalledTimes(1);
    expect(EvolutionCoreRunModel.markApplied).toHaveBeenCalledTimes(1);
    expect(EvolutionCoreRunModel.markApplied).toHaveBeenCalledWith('run-1', expect.objectContaining({
      applied: false,
      notes: expect.stringContaining('routed:skip'),
    }));
    // block reason reflects the router decision, not a numeric delta gate
    expect(r.apply_blocked).toBe(true);
    expect(r.apply_block_reason).toContain('router:skip');
  });

  it('writes exactly one receipt and never calls markApplied when apply=false', async () => {
    EvolutionCoreRunModel.create.mockClear();
    EvolutionCoreRunModel.markApplied.mockClear();

    await CoreEvolutionSystem.runForUser('u1', { generations: 2, populationSize: 10, eliteCount: 4, apply: false });

    expect(EvolutionCoreRunModel.create).toHaveBeenCalledTimes(1);
    expect(EvolutionCoreRunModel.markApplied).not.toHaveBeenCalled();
  });
});
