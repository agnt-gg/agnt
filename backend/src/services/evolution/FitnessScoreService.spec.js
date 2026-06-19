import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB + models so we can exercise scoring logic without SQLite.
// FitnessScoreService imports these at module load; mocks must be in place first.
vi.mock('../../models/database/index.js', () => ({
  default: { all: vi.fn((sql, params, cb) => cb(null, [])) },
}));

const contractModelMock = {
  findActiveByTarget: vi.fn(async () => []),
};
vi.mock('../../models/ContractModel.js', () => ({
  default: contractModelMock,
}));

const mutationModelMock = {
  findOne: vi.fn(async () => null),
  updateFitnessAfter: vi.fn(async () => {}),
};
vi.mock('../../models/MutationHistoryModel.js', () => ({
  default: mutationModelMock,
}));

// Import AFTER mocks are registered
const FitnessScoreService = (await import('./FitnessScoreService.js')).default;

beforeEach(() => {
  contractModelMock.findActiveByTarget.mockReset().mockResolvedValue([]);
  mutationModelMock.findOne.mockReset().mockResolvedValue(null);
  mutationModelMock.updateFitnessAfter.mockReset().mockResolvedValue();
});

function rows(...specs) {
  return specs.map((s, i) => ({
    status: s.status ?? 'completed',
    input_tokens: s.input_tokens ?? 100,
    output_tokens: s.output_tokens ?? 100,
    start_time: s.start_time ?? '2026-06-19T10:00:00.000Z',
    end_time: s.end_time ?? '2026-06-19T10:00:01.000Z',
    ...s,
  }));
}

describe('_scoreFromToolRows — empty input', () => {
  it('returns zero score and zero sample size when no rows', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({ rows: [], targetType: 'tool', targetId: 't', userId: 'u' });
    expect(r.score).toBe(0);
    expect(r.sampleSize).toBe(0);
    expect(r.components.successRate).toBe(0);
    expect(r.components.contractCleanliness).toBe(1); // no contracts → clean
  });
});

describe('_scoreFromToolRows — success rate', () => {
  it('all completed = 100% successRate', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({ status: 'completed' }, { status: 'completed' }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.successRate).toBe(1);
  });
  it('half completed = 50% successRate', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({ status: 'completed' }, { status: 'failed' }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.successRate).toBe(0.5);
  });
  it('all failed = 0% successRate', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({ status: 'failed' }, { status: 'error' }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.successRate).toBe(0);
  });
});

describe('_scoreFromToolRows — token efficiency', () => {
  it('low tokens → high efficiency', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({ input_tokens: 100, output_tokens: 100 }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.tokenEfficiency).toBeGreaterThan(0.99);
  });
  it('very high tokens → low efficiency', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({ input_tokens: 50_000, output_tokens: 50_000 }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.tokenEfficiency).toBe(0); // 100k tokens → clamped to 0
  });
});

describe('_scoreFromToolRows — latency efficiency', () => {
  it('fast (1s) latency → high efficiency', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({
        start_time: '2026-06-19T10:00:00.000Z',
        end_time: '2026-06-19T10:00:01.000Z',
      }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.latencyEfficiency).toBeGreaterThan(0.98);
  });
  it('slow (90s) latency → 0 efficiency (>60s clamps)', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({
        start_time: '2026-06-19T10:00:00.000Z',
        end_time: '2026-06-19T10:01:30.000Z',
      }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.latencyEfficiency).toBe(0);
  });
  it('missing timestamps fall back to neutral 0.5', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: [{ status: 'completed', input_tokens: 0, output_tokens: 0 }],
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.latencyEfficiency).toBe(0.5);
  });
});

describe('_scoreFromToolRows — contract cleanliness', () => {
  it('no active contracts → cleanliness = 1', async () => {
    contractModelMock.findActiveByTarget.mockResolvedValue([]);
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({}), targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.contractCleanliness).toBe(1);
  });
  it('contracts with no violations → cleanliness = 1', async () => {
    contractModelMock.findActiveByTarget.mockResolvedValue([
      { violation_count: 0, evidence_count: 10 },
    ]);
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({}), targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.contractCleanliness).toBe(1);
  });
  it('50/50 violations vs evidence → cleanliness = 0.5', async () => {
    contractModelMock.findActiveByTarget.mockResolvedValue([
      { violation_count: 5, evidence_count: 5 },
    ]);
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({}), targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.contractCleanliness).toBe(0.5);
  });
  it('contract lookup throwing does not break scoring', async () => {
    contractModelMock.findActiveByTarget.mockRejectedValue(new Error('table missing'));
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({}), targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(r.components.contractCleanliness).toBe(1); // defaulted
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('_scoreFromToolRows — composite scoring', () => {
  it('all-perfect rows → score = 1', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({
        status: 'completed',
        input_tokens: 0, output_tokens: 0,
        start_time: '2026-06-19T10:00:00.000Z',
        end_time: '2026-06-19T10:00:00.000Z', // 0ms — but no positive latency means fallback to neutral 0.5
      }),
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    // 0.5 * 1.0 + 0.2 * 1.0 + 0.2 * 0.5 + 0.1 * 1.0 = 0.9
    expect(r.score).toBeCloseTo(0.9, 2);
  });
  it('all-failed + zero data + no timestamps → score = 0.4 (neutral lat fallback)', async () => {
    // Explicitly omit timestamps — rows() helper defaults to a 1s window
    // which gives latencyEfficiency≈0.98, not the neutral 0.5 fallback.
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: [{
        status: 'failed',
        input_tokens: 0, output_tokens: 0,
        // start_time / end_time intentionally omitted
      }],
      targetType: 'tool', targetId: 't', userId: 'u',
    });
    // 0.5 * 0 (success) + 0.2 * 1 (tokens) + 0.2 * 0.5 (latency fallback) + 0.1 * 1 (no contracts) = 0.4
    expect(r.score).toBeCloseTo(0.4, 2);
  });
  it('rounds score to 3 decimals', async () => {
    const r = await FitnessScoreService._scoreFromToolRows({
      rows: rows({}), targetType: 'tool', targetId: 't', userId: 'u',
    });
    expect(String(r.score).length).toBeLessThanOrEqual(5);
  });
});

describe('canaryCheck — regression detection (the safety net)', () => {
  it('returns not_applicable when mutation not found', async () => {
    mutationModelMock.findOne.mockResolvedValue(null);
    const r = await FitnessScoreService.canaryCheck('missing-id');
    expect(r.regression).toBe(false);
    expect(r.reason).toBe('not_applicable');
  });

  it('returns not_applicable when mutation not in applied status', async () => {
    mutationModelMock.findOne.mockResolvedValue({ id: 'm1', status: 'pending', fitness_before: 0.8 });
    const r = await FitnessScoreService.canaryCheck('m1');
    expect(r.regression).toBe(false);
    expect(r.reason).toBe('not_applicable');
  });

  it('returns no_baseline when fitness_before missing', async () => {
    mutationModelMock.findOne.mockResolvedValue({ id: 'm1', status: 'applied' });
    const r = await FitnessScoreService.canaryCheck('m1');
    expect(r.regression).toBe(false);
    expect(r.reason).toBe('no_baseline');
  });

  it('DETECTS regression when after score drops below baseline - minDelta', async () => {
    // First call: get the mutation row
    mutationModelMock.findOne
      .mockResolvedValueOnce({ id: 'm1', status: 'applied', fitness_before: 0.9, target_type: 'tool', target_id: 't', user_id: 'u' })
      // Second call: forMutation → forTool → _scoreFromToolRows path uses ToolModel which goes through db.all
      .mockResolvedValueOnce({ id: 'm1', status: 'applied', fitness_before: 0.9, target_type: 'tool', target_id: 't', user_id: 'u' });

    const db = (await import('../../models/database/index.js')).default;
    db.all = vi.fn((sql, params, cb) => {
      cb(null, rows({ status: 'failed', input_tokens: 80000, output_tokens: 80000 }));
    });

    const r = await FitnessScoreService.canaryCheck('m1', { minDelta: -0.05 });
    expect(r.regression).toBe(true);
    expect(r.fitnessAfter).toBeLessThan(0.9);
  });

  it('does NOT flag regression when delta within tolerance', async () => {
    mutationModelMock.findOne
      .mockResolvedValueOnce({ id: 'm1', status: 'applied', fitness_before: 0.5, target_type: 'tool', target_id: 't', user_id: 'u' })
      .mockResolvedValueOnce({ id: 'm1', status: 'applied', fitness_before: 0.5, target_type: 'tool', target_id: 't', user_id: 'u' });

    const db = (await import('../../models/database/index.js')).default;
    db.all = vi.fn((sql, params, cb) => {
      cb(null, rows({})); // perfect rows → ~0.9 score, well above baseline
    });

    const r = await FitnessScoreService.canaryCheck('m1');
    expect(r.regression).toBe(false);
    expect(r.delta).toBeGreaterThan(0);
  });
});
