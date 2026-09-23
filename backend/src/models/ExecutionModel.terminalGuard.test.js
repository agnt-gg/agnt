import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A finished execution keeps its own receipt.
 *
 * Stop and deactivate race the engine's final write. Without a guard the later
 * write won, so a run that genuinely completed was relabelled 'stopped' and its
 * credits overwritten with the stopper's total — the evidence of what actually
 * happened was destroyed by a bookkeeping write that arrived second.
 *
 * Real sqlite3 against an in-memory database: the guard is a SQL predicate, so
 * a mocked driver would prove nothing about it.
 */

vi.mock('./database/index.js', async () => {
  const { default: sqlite3 } = await import('sqlite3');
  return { default: new sqlite3.Database(':memory:'), dbRunWithRetry: (fn) => fn() };
});

const { default: db } = await import('./database/index.js');
const { default: ExecutionModel } = await import('./ExecutionModel.js');

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const get = (id) => new Promise((resolve, reject) => db.get('SELECT * FROM workflow_executions WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row))));

beforeEach(async () => {
  await run('DROP TABLE IF EXISTS workflow_executions');
  await run('CREATE TABLE workflow_executions (id TEXT PRIMARY KEY, status TEXT, log TEXT, end_time TEXT, credits_used REAL)');
});

afterAll(() => new Promise((resolve) => db.close(resolve)));

describe('ExecutionModel.update — terminal rows finalize once', () => {
  it('refuses a late stop over a completed run and keeps its credits', async () => {
    await run("INSERT INTO workflow_executions VALUES ('run-1', 'completed', 'original log', '2026-01-01T00:00:00.000Z', 7)");

    const changes = await ExecutionModel.update('run-1', 'stopped', 'late stop log', 0);

    const row = await get('run-1');
    expect(changes).toBe(0);
    expect(row.status).toBe('completed');
    expect(row.log).toBe('original log');
    expect(row.credits_used).toBe(7);
  });

  it.each(['completed', 'error', 'stopped', 'insufficient-credits'])('refuses a second write to a %s row', async (terminal) => {
    await run('INSERT INTO workflow_executions VALUES (?, ?, ?, ?, ?)', ['run-2', terminal, 'original log', null, 2]);

    const changes = await ExecutionModel.update('run-2', 'stopped', 'second log', 99);

    const row = await get('run-2');
    expect(changes).toBe(0);
    expect(row.status).toBe(terminal);
    expect(row.credits_used).toBe(2);
  });

  it('still lets a running execution reach its terminal status', async () => {
    await run("INSERT INTO workflow_executions VALUES ('run-3', 'running', '', NULL, 0)");

    const changes = await ExecutionModel.update('run-3', 'completed', 'final log', 4);

    const row = await get('run-3');
    expect(changes).toBe(1);
    expect(row.status).toBe('completed');
    expect(row.log).toBe('final log');
    expect(row.credits_used).toBe(4);
    expect(row.end_time).toEqual(expect.any(String));
  });

  it('defaults a missing status to stopped rather than writing null', async () => {
    await run("INSERT INTO workflow_executions VALUES ('run-4', 'started', '', NULL, 0)");

    await ExecutionModel.update('run-4', undefined, 'log', 0);

    expect((await get('run-4')).status).toBe('stopped');
  });
});
