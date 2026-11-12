/** The objectives a person's goals serve. Additive: a new table and a nullable link on goals. */
export async function initializeGoalObjectives(db) {
  const run = (sql) => new Promise((resolve, reject) => db.run(sql, (error) => (error ? reject(error) : resolve())));
  const all = (sql) => new Promise((resolve, reject) => db.all(sql, (error, rows) => (error ? reject(error) : resolve(rows))));
  await run(`CREATE TABLE IF NOT EXISTS goal_objectives (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '', current TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)`);
  await run('CREATE INDEX IF NOT EXISTS goal_objectives_user ON goal_objectives(user_id, archived_at)');
  const columns = await all('PRAGMA table_info(goals)');
  if (!columns.some((column) => column.name === 'objective_id')) await run('ALTER TABLE goals ADD COLUMN objective_id TEXT');
  await run('CREATE INDEX IF NOT EXISTS goals_objective ON goals(objective_id)');
}
