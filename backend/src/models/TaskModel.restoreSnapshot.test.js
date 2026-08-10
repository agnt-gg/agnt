// Task restore for revert-to-iteration: writes a captured snapshot back onto
// the tasks table, scoped to the owning goal so a stale snapshot can never
// touch another goal's rows.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const run = vi.fn((sql, params, cb) => cb && cb.call({ changes: 1, lastID: 1 }, null));
const get = vi.fn((sql, params, cb) => cb(null, null));
const all = vi.fn((sql, params, cb) => cb(null, []));

vi.mock('./database/index.js', () => ({ default: { run: (...a) => run(...a), get: (...a) => get(...a), all: (...a) => all(...a) } }));

const { default: TaskModel } = await import('./TaskModel.js');

beforeEach(() => {
  run.mockClear();
  run.mockImplementation((sql, params, cb) => cb && cb.call({ changes: 1, lastID: 1 }, null));
});

describe('restoreSnapshot', () => {
  it('updates each snapshotted task, scoped to the goal', async () => {
    const restored = await TaskModel.restoreSnapshot('g1', [
      { id: 't1', title: 'A', description: 'da', status: 'completed', progress: 100, output: '{"x":1}', error: null },
      { id: 't2', title: 'B', description: 'db', status: 'pending', progress: 0, output: null, error: 'boom' },
    ]);

    expect(restored).toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
    for (const [sql] of run.mock.calls) {
      expect(sql).toMatch(/WHERE id = \? AND goal_id = \?/);
    }
    // Output is written back verbatim — captured as stored, not re-serialized
    const [, params] = run.mock.calls[0];
    expect(params).toContain('{"x":1}');
    expect(params[params.length - 1]).toBe('g1');
  });

  it('counts only rows that actually matched', async () => {
    run.mockImplementation((sql, params, cb) => cb.call({ changes: 0 }, null));
    const restored = await TaskModel.restoreSnapshot('g1', [{ id: 'ghost' }]);
    expect(restored).toBe(0);
  });

  it('tolerates a missing or malformed snapshot', async () => {
    expect(await TaskModel.restoreSnapshot('g1', null)).toBe(0);
    expect(await TaskModel.restoreSnapshot('g1', undefined)).toBe(0);
    expect(await TaskModel.restoreSnapshot('g1', 'not-an-array')).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });
});
