// DB-backed iteration checkpoints (replacing the git checkpoint layer).
//
// Background: _gitCheckpoint used to commit world-state JSON onto a
// goal/<id> branch in process.cwd() — which, on a source install, is the
// product repo. The commit hash was stored and never read. The DB row
// already carried the same world state, so the git layer was a redundant
// write path in the wrong location. These tests pin the DB-only contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const run = vi.fn((sql, params, cb) => cb && cb.call({ changes: 1, lastID: 1 }, null));
const get = vi.fn((sql, params, cb) => cb(null, null));
const all = vi.fn((sql, params, cb) => cb(null, []));

vi.mock('./database/index.js', () => ({ default: { run: (...a) => run(...a), get: (...a) => get(...a), all: (...a) => all(...a) } }));

const { default: GoalIterationModel } = await import('./GoalIterationModel.js');

beforeEach(() => {
  run.mockClear(); get.mockClear(); all.mockClear();
  run.mockImplementation((sql, params, cb) => cb && cb.call({ changes: 1, lastID: 1 }, null));
  get.mockImplementation((sql, params, cb) => cb(null, null));
  all.mockImplementation((sql, params, cb) => cb(null, []));
});

describe('create', () => {
  it('stores the task snapshot and no git hash', async () => {
    const snapshot = [{ id: 't1', title: 'Task', status: 'completed' }];
    await GoalIterationModel.create('g1', 3, 88, false, { a: 1 }, [{ id: 't1' }], 1234, snapshot);

    const insert = run.mock.calls.find(([sql]) => /INSERT INTO goal_iterations/.test(sql));
    expect(insert).toBeDefined();
    const [sql, params] = insert;
    expect(sql).toContain('task_snapshot');
    expect(sql).not.toContain('git_commit_hash');
    // (goal_id, iteration, score, passed, world_state, replanned, task_snapshot, duration, state)
    expect(params[6]).toBe(JSON.stringify(snapshot));
    expect(params[7]).toBe(1234);
  });

  it('stores NULL when no snapshot is provided', async () => {
    await GoalIterationModel.create('g1', 1, 50, false, {}, [], 100);
    const [, params] = run.mock.calls.find(([sql]) => /INSERT INTO goal_iterations/.test(sql));
    expect(params[6]).toBeNull();
  });
});

describe('ordering is by id, not iteration_number', () => {
  // Iteration numbers restart at 1 every run; a goal on a daily schedule has
  // dozens of rows with iteration_number=1. Only id is chronologically correct.
  it('findByGoalId orders by id ASC', async () => {
    await GoalIterationModel.findByGoalId('g1');
    const [sql] = all.mock.calls[0];
    expect(sql).toMatch(/ORDER BY id ASC/);
    expect(sql).not.toMatch(/ORDER BY iteration_number/);
  });

  it('getLatest takes the newest row by id', async () => {
    await GoalIterationModel.getLatest('g1');
    const [sql] = get.mock.calls[0];
    expect(sql).toMatch(/ORDER BY id DESC LIMIT 1/);
  });

  it('findOne takes the most recent occurrence of a repeated iteration number', async () => {
    await GoalIterationModel.findOne('g1', 2);
    const [sql] = get.mock.calls[0];
    expect(sql).toMatch(/iteration_number = \?/);
    expect(sql).toMatch(/ORDER BY id DESC LIMIT 1/);
  });
});

describe('row parsing', () => {
  it('parses task_snapshot JSON and leaves missing snapshots null', async () => {
    all.mockImplementation((sql, params, cb) => cb(null, [
      { id: 1, evaluation_passed: 1, world_state_snapshot: '{"a":1}', replanned_tasks: '[]', task_snapshot: '[{"id":"t1"}]' },
      { id: 2, evaluation_passed: 0, world_state_snapshot: null, replanned_tasks: null, task_snapshot: null },
    ]));
    const rows = await GoalIterationModel.findByGoalId('g1');
    expect(rows[0].task_snapshot).toEqual([{ id: 't1' }]);
    expect(rows[0].world_state_snapshot).toEqual({ a: 1 });
    expect(rows[1].task_snapshot).toBeNull();
  });
});

describe('prune', () => {
  it('keeps the newest window plus the best-scoring row', async () => {
    await GoalIterationModel.prune('g1');
    const [sql, params] = run.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM goal_iterations/);
    expect(sql).toMatch(/ORDER BY id DESC LIMIT \?/);           // recency window
    expect(sql).toMatch(/ORDER BY evaluation_score DESC, id DESC LIMIT 1/); // best row protected
    expect(params).toEqual(['g1', 'g1', GoalIterationModel.RETAIN_PER_GOAL, 'g1']);
  });

  it('honours a custom keep count', async () => {
    await GoalIterationModel.prune('g1', 5);
    const [, params] = run.mock.calls[0];
    expect(params[2]).toBe(5);
  });
});
