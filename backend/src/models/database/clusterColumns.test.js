/**
 * The multi-node migration, proved against a real sqlite file.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A SOURCE SCAN
 * ────────────────────────────────────────────────────
 * The failure this guards against is not "someone deleted the migration". It
 * is the one schemaOrder.test.js was written for after it happened four
 * times: DDL that is present in the source, reads correctly, and does not
 * execute — because it names a column that does not exist yet, or because a
 * callback-less db.run turned a schema error into an uncaught exception at
 * boot. Only a real database can tell those apart from success.
 *
 * The suite's data dir is redirected to a temp sandbox by
 * tests/setup/isolate-data-dir.mjs, so importing the database module here
 * builds a throwaway database and runs the entire boot chain against it —
 * createTables, then runMigrations, then createIndexes, in that order. That
 * is the same sequence a fresh install runs, which is what makes the result
 * meaningful.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import db, { dbReady } from './index.js';

const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

/** Column name -> declared type, for one table. */
async function columnsOf(table) {
  const rows = await all(`PRAGMA table_info(${table})`);
  return Object.fromEntries(rows.map((r) => [r.name, { type: r.type, dflt: r.dflt_value }]));
}

beforeAll(async () => {
  await dbReady;
});

describe('cluster columns exist after the boot chain', () => {
  it('tasks carries the claim lease', async () => {
    const cols = await columnsOf('tasks');

    expect(cols.claimed_by, 'no claimed_by: two nodes cannot tell whose task this is').toBeTruthy();
    expect(cols.claimed_by.type).toBe('TEXT');

    // Epoch millis, deliberately. A DATETIME string would be compared
    // lexicographically against Date.now() somewhere and be silently wrong.
    expect(cols.claim_expires_at, 'no claim_expires_at: a dead node holds its tasks forever').toBeTruthy();
    expect(cols.claim_expires_at.type).toBe('INTEGER');

    expect(cols.attempt_count, 'no attempt_count: a poison task recirculates the fleet forever').toBeTruthy();
    expect(cols.attempt_count.type).toBe('INTEGER');
    expect(cols.attempt_count.dflt).toBe('0');
  });

  it('the ledger tables carry node attribution', async () => {
    expect((await columnsOf('llm_calls')).node_id?.type).toBe('TEXT');
    expect((await columnsOf('agent_executions')).node_id?.type).toBe('TEXT');
  });

  it('node_id defaults to NULL, never to a stand-in value', async () => {
    // The ledger's existing rule is NULL-never-zero: an unpriced call reports
    // null rather than 0 because "free" and "unknown" must stay
    // distinguishable. Attribution follows the same rule — a row written
    // before this migration genuinely has no node, and a DEFAULT of 'local'
    // would make the fleet breakdown confidently wrong instead of visibly
    // incomplete.
    const cols = await columnsOf('llm_calls');
    expect(cols.node_id.dflt).toBeNull();
  });
});

describe('the claim index was actually built', () => {
  it('idx_tasks_claimable exists', async () => {
    // The point of the assertion: this index names claim_expires_at, a column
    // added by a migration. Declared inline in createTables() it would build
    // on a fresh database and throw `no such column` on every upgrading
    // install. Its presence here proves it ran AFTER the migration.
    const row = await get(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`, [
      'idx_tasks_claimable',
    ]);
    expect(row?.name).toBe('idx_tasks_claimable');
  });

  it('the planner actually uses it to find claimable work', async () => {
    // An index that exists but is never chosen is decoration. This is the
    // exact shape of the claim query.
    const plan = await all(
      `EXPLAIN QUERY PLAN
       SELECT id FROM tasks
       WHERE status = 'pending' AND (claim_expires_at IS NULL OR claim_expires_at < ?)`,
      [Date.now()]
    );
    expect(plan.map((r) => r.detail).join(' ')).toContain('idx_tasks_claimable');
  });
});

describe('the migration is re-runnable', () => {
  it('adding a cluster column a second time is a no-op, not an error', async () => {
    // Every boot after the first re-executes this ALTER. The migration
    // swallows exactly `duplicate column name` and nothing else; this proves
    // the error text it matches on is the text sqlite actually produces,
    // which is the assumption the whole idiom rests on.
    await expect(run(`ALTER TABLE tasks ADD COLUMN claimed_by TEXT`)).rejects.toThrow(/duplicate column name/);
  });
});

describe('the new columns do not disturb the existing shape', () => {
  it('tasks keeps every column the queue logic already depends on', async () => {
    const cols = await columnsOf('tasks');
    for (const required of ['id', 'goal_id', 'status', 'order_index', 'dependencies', 'agent_id', 'output']) {
      expect(cols[required], `tasks.${required} disappeared`).toBeTruthy();
    }
  });
});
