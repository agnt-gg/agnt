/** Main-process additive migration. Triggers observe legacy writers too; comparing
 * timestamps or row values alone misses A->B->A changes within one millisecond.
 * Tombstone revisions intentionally survive deletion to fence ID reuse.
 */
export async function initializeGoalLifecycleVersions(db) {
  const run = sql => new Promise((resolve,reject)=>db.run(sql,error=>error?reject(error):resolve()));
  await run(`CREATE TABLE IF NOT EXISTS goal_lifecycle_versions (kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind,entity_id))`);
  for (const table of ['goals','tasks']) {
    const kind = table === 'goals' ? 'goal' : 'task';
    for (const event of ['INSERT','UPDATE','DELETE']) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      const bump = (type,id) => `INSERT INTO goal_lifecycle_versions(kind,entity_id,revision) VALUES('${type}',${id},1) ON CONFLICT(kind,entity_id) DO UPDATE SET revision=revision+1;`;
      await run(`CREATE TRIGGER IF NOT EXISTS lifecycle_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN
        ${bump(kind,`${row}.id`)}
        ${table==='tasks'?bump('goal',`${row}.goal_id`):''}
        ${table==='tasks'&&event==='UPDATE'?`INSERT INTO goal_lifecycle_versions(kind,entity_id,revision) SELECT 'goal',OLD.goal_id,1 WHERE OLD.goal_id IS NOT NEW.goal_id ON CONFLICT(kind,entity_id) DO UPDATE SET revision=revision+1;`:''}
      END`);
    }
  }
}
