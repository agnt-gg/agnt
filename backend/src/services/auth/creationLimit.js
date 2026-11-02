/**
 * The free plan makes FREE_LIMITS.agents agents and FREE_LIMITS.workflows
 * workflows. A paid plan or the referral trial lifts both
 * (planEntitlements.liftsFreeLimits).
 *
 * Called by every path a PERSON creates one through: the editor, Annie's
 * tools, import, installing a shared item, duplicate. Never on an update, and
 * never by internal writes (team execution, agent evolution), which create
 * nothing the user asked for. Nothing that already exists is touched: an
 * account over the cap (made before it, or during a trial) keeps everything,
 * and only making one more is refused.
 *
 * What counts: live rows the account made. Soft-deleted rows do not (deleting
 * one frees a slot), nor does the built-in orchestrator row (status 'system'),
 * nor anything a plugin installed (source_plugin): a plugin brings its own
 * agents as part of what it is, and refusing an install halfway would leave
 * it broken.
 */
import db from '../../models/database/index.js';
import { FREE_LIMITS } from './planLimits.js';
import { isEnforcing, liftsFreeLimits } from './planEntitlements.js';
import { PlanLimitError } from './connectionLimit.js';

const KINDS = Object.freeze({
  agent: {
    limit: 'agents',
    plural: 'agents',
    sql: `SELECT COUNT(*) AS n FROM agents
           WHERE created_by = ? AND deleted_at IS NULL AND source_plugin IS NULL
             AND COALESCE(status, '') != 'system'`,
  },
  workflow: {
    limit: 'workflows',
    plural: 'workflows',
    sql: `SELECT COUNT(*) AS n FROM workflows
           WHERE user_id = ? AND deleted_at IS NULL AND source_plugin IS NULL`,
  },
});

const get = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row))));

/** How many of `kind` this account has made, as the cap counts them. */
export async function countOwned(kind, userId) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`creationLimit: unknown kind '${kind}'`);
  return Number((await get(spec.sql, [userId]))?.n || 0);
}

/**
 * Throws PlanLimitError (403, code PLAN_LIMIT) when a free account would make
 * one `kind` past the cap.
 *
 * @param {'agent'|'workflow'} kind
 * @param {string} userId the account the new row will belong to
 * @param {{ count?: number }} [options] count: create this many at once (an import)
 */
export async function assertCanCreate(kind, userId, { count = 1, liftsLimits = liftsFreeLimits, countExisting = countOwned } = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`creationLimit: unknown kind '${kind}'`);
  if (!isEnforcing() || !userId) return;
  const cap = FREE_LIMITS[spec.limit];
  if ((await countExisting(kind, userId)) + count <= cap) return;
  if (await liftsLimits(userId)) return;
  throw new PlanLimitError(`The free plan makes ${cap} ${spec.plural}. Delete one, or upgrade to AGNT Pro to make more.`, spec.limit);
}

/**
 * The 403 body for a PlanLimitError: the shape the frontend turns into an
 * upgrade prompt (requiredFeature), never a 401 or a bare 500.
 */
export function planLimitResponse(error) {
  return {
    error: 'Upgrade required',
    message: error.message,
    code: 'PLAN_LIMIT',
    limit: error.limit,
    requiredFeature: error.limit,
  };
}

/** Is this the refusal assertCanCreate (or assertCanConnect) throws? */
export function isPlanLimitError(error) {
  return error instanceof PlanLimitError || error?.code === 'PLAN_LIMIT';
}
