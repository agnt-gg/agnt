// Iteration history must be writable on every database the app can have.
// Regression: create() writes the legacy `state` column, which the CREATE
// TABLE lacked, so on a database created from it every insert failed (caught
// as "non-fatal") and goals recorded no round history at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('./database/index.js', async () => {
  const sqlite3 = (await import('sqlite3')).default;
  return { default: new sqlite3.Database(':memory:') };
});

const { default: db } = await import('./database/index.js');
const { default: GoalIterationModel } = await import('./GoalIterationModel.js');

const schemaSource = readFileSync(fileURLToPath(new URL('./database/index.js', import.meta.url)), 'utf8');
const createTable = schemaSource.match(/CREATE TABLE IF NOT EXISTS goal_iterations \([\s\S]*?\n\s*\)/)[0];
const migrationBlock = schemaSource.match(/const goalIterationColumns = \[([\s\S]*?)\];/)[1];
const migrationColumns = [...migrationBlock.matchAll(/name: '(\w+)', type: '([^']+)'/g)].map(([, name, type]) => ({ name, type }));

const exec = (sql) => new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
const alter = (sql) => new Promise((resolve) => db.run(sql, () => resolve()));

async function migrate() {
  for (const col of migrationColumns) await alter(`ALTER TABLE goal_iterations ADD COLUMN ${col.name} ${col.type}`);
}

async function recordAndRead() {
  const id = await GoalIterationModel.create('g', 1, 3.3, false, { lastScore: 3.3 }, [], 120, [{ id: 't1', title: 'Research', error: 'Did not pass review' }]);
  await GoalIterationModel.setReplannedTasks(id, [{ id: 't1', title: 'Research v2', previous: { title: 'Research' } }]);
  return GoalIterationModel.findByGoalId('g');
}

beforeEach(async () => {
  await exec('DROP TABLE IF EXISTS goal_iterations; DROP TABLE IF EXISTS goals; CREATE TABLE goals (id TEXT PRIMARY KEY);');
});

describe('iteration history on every schema', () => {
  it('Given a database created from the current schema, Then an iteration is recorded and read back', async () => {
    await exec(createTable);
    await migrate();
    const [row] = await recordAndRead();
    expect(row).toMatchObject({ goal_id: 'g', iteration_number: 1, evaluation_score: 3.3, evaluation_passed: false });
    expect(row.task_snapshot).toEqual([{ id: 't1', title: 'Research', error: 'Did not pass review' }]);
    expect(row.replanned_tasks).toEqual([{ id: 't1', title: 'Research v2', previous: { title: 'Research' } }]);
  });

  it('Given a database already created without the state column, Then the migration repairs it', async () => {
    await exec(createTable.replace(/\n\s*state TEXT,/, ''));
    await migrate();
    expect(await recordAndRead()).toHaveLength(1);
  });

  it('Given a legacy database where state is NOT NULL, Then inserts still satisfy it', async () => {
    await exec('CREATE TABLE goal_iterations (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, iteration_number INTEGER NOT NULL, state TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    await migrate();
    expect(await recordAndRead()).toHaveLength(1);
  });
});
