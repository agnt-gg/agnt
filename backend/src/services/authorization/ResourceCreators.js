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
import { runActorFor, isWorkspacePrincipal } from './runActor.js';
import { withToolActor, issueToolToken, TOOL_TOKEN_MAX_TTL_SECONDS } from '../security/toolRunAuthority.js';
import { isNonOwnerMember } from '../security/memberIsolation.js';

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

/**
 * Who switched a teamspace item on, so work that outlives the request (a listening workflow's triggers,
 * a restore after restart, a schedule) keeps acting as that person (runActor.js) instead of becoming the
 * workspace, which acts for the owner. Unlike the creator, the latest activation wins.
 * Both tables are classified in OwnershipInventory: startup refuses unclassified tables.
 */
const runActorsReady = new WeakMap();
function initializeRunActors(repository) {
  if (!runActorsReady.has(repository)) {
    const pending = repository
      .run('CREATE TABLE IF NOT EXISTS scope_run_actors(resource_table TEXT NOT NULL,resource_id TEXT NOT NULL,actor_id TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(resource_table,resource_id))')
      .catch((error) => { runActorsReady.delete(repository); throw error; });
    runActorsReady.set(repository, pending);
  }
  return runActorsReady.get(repository);
}

export async function recordRunActor(repository, table, id, actorId) {
  if (!table || !id || !actorId) return;
  await initializeRunActors(repository);
  await repository.run('INSERT INTO scope_run_actors(resource_table,resource_id,actor_id) VALUES(?,?,?) ON CONFLICT(resource_table,resource_id) DO UPDATE SET actor_id=excluded.actor_id,updated_at=CURRENT_TIMESTAMP', [table, id, actorId]);
}

/** Record the person behind this teamspace change or run (runActor.js), when one is known. */
export async function recordTeamRunner(repository, table, id, userId) {
  if (!isWorkspacePrincipal(userId)) return;
  const actor = runActorFor(userId);
  if (actor !== userId) await recordRunActor(repository, table, id, actor);
}

/**
 * Run `operation` as the person recorded for this teamspace item, for work that starts without a request
 * (a schedule, a resumed goal). A teammate's run gets a run-scoped token so its tool calls can prove who
 * they are. Nothing recorded, or not a teamspace item: runs unchanged.
 */
export async function asRecordedRunner(repository, table, id, userId, operation) {
  if (!isWorkspacePrincipal(userId)) return operation();
  const actor = await runActorOf(repository, table, id);
  if (!actor || actor === userId) return operation();
  const authorization = isNonOwnerMember(actor) ? 'Bearer ' + issueToolToken(actor, { ttlSeconds: TOOL_TOKEN_MAX_TTL_SECONDS }) : null;
  return withToolActor(actor, operation, authorization);
}

/** Who last switched it on, or null (never recorded: the owner's own work from before this existed). */
export async function runActorOf(repository, table, id) {
  if (!table || !id) return null;
  await initializeRunActors(repository);
  const row = await repository.get('SELECT actor_id FROM scope_run_actors WHERE resource_table=? AND resource_id=?', [table, id]);
  return row?.actor_id || null;
}

/** The recorded creator's account id, or null when none was recorded. */
export async function creatorOf(repository, table, id) {
  if (!table || !id) return null;
  await initialize(repository);
  const row = await repository.get('SELECT actor_id FROM scope_resource_creators WHERE resource_table=? AND resource_id=?', [table, id]);
  return row?.actor_id || null;
}
