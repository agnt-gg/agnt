/**
 * Who made a resource in a team workspace.
 *
 * A teamspace's records are stored under the workspace's storage principal
 * (scope:…), so a row's created_by names the workspace, never the teammate.
 * "The person who made it, or an owner/admin, may delete it" (the rule board
 * cards and docs already follow) needs the person, so it is recorded here once,
 * at creation, from the VERIFIED scope request (ScopeApiMiddleware). Edits never
 * change it: INSERT OR IGNORE keeps the first writer.
 *
 * Rows made before this existed have no creator. Unknown is read as "not you",
 * so only an owner or admin can delete those: the safe reading.
 */
const ready = new WeakMap();

function initialize(repository) {
  if (!ready.has(repository)) {
    const pending = repository
      .run('CREATE TABLE IF NOT EXISTS scope_resource_creators(resource_table TEXT NOT NULL,resource_id TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(resource_table,resource_id))')
      .catch((error) => { ready.delete(repository); throw error; });
    ready.set(repository, pending);
  }
  return ready.get(repository);
}

/** Record `actorId` as the creator of `table`/`id`. A second call never overwrites the first. */
export async function recordCreator(repository, table, id, actorId) {
  if (!table || !id || !actorId) return;
  await initialize(repository);
  await repository.run('INSERT OR IGNORE INTO scope_resource_creators(resource_table,resource_id,actor_id) VALUES(?,?,?)', [table, id, actorId]);
}

/** The recorded creator's account id, or null when none was recorded. */
export async function creatorOf(repository, table, id) {
  if (!table || !id) return null;
  await initialize(repository);
  const row = await repository.get('SELECT actor_id FROM scope_resource_creators WHERE resource_table=? AND resource_id=?', [table, id]);
  return row?.actor_id || null;
}
