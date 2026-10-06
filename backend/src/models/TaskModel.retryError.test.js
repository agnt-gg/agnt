// A task sent back to pending is a fresh attempt: the previous attempt's error
// must not survive it, or the goal gate rejects the task forever even after
// the retry succeeds (TASK_NOT_COMPLETED on a completed task).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sql = vi.hoisted(() => ({ statements: [] }));
vi.mock('./database/index.js', () => ({
  default: {
    run: (query, params, callback) => {
      sql.statements.push({ query, params });
      callback.call({ changes: 1 }, null);
    },
  },
}));

const { default: TaskModel } = await import('./TaskModel.js');

beforeEach(() => { sql.statements.length = 0; });

describe('TaskModel.updateStatus error lifecycle', () => {
  it('Given a reset to pending, Then the stale error is cleared', async () => {
    await TaskModel.updateStatus('t', 'pending', 0);
    expect(sql.statements[0].query).toContain('error = NULL');
  });
  it('Given a failure with a reason, Then the reason is written', async () => {
    await TaskModel.updateStatus('t', 'failed', 0, null, null, null, null, 'why');
    expect(sql.statements[0].query).toContain('error = ?');
    expect(sql.statements[0].params).toContain('why');
  });
  it.each(['running', 'completed', 'failed'])('Given %s without a reason, Then the error is left alone', async (status) => {
    await TaskModel.updateStatus('t', status);
    expect(sql.statements[0].query).not.toContain('error');
  });
});
