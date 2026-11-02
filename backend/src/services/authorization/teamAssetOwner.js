import db from '../../models/database/index.js';
import { databaseRepository, ensureSharedScope } from './ScopeRepository.js';
import { fileInstanceTeamStore } from '../../routes/TeamInstanceScope.js';
import { isWorkspacePrincipal } from './runActor.js';

/**
 * Whose library a team instance's REST API reads, for a tool that touches the database directly.
 *
 * On a team's instance every asset API request is the team's (TeamInstanceScope): with no workspace named
 * it lands in the team's default workspace, stored under that workspace's principal (ScopeApiMiddleware).
 * Tools that go through the REST client agreed with that; tools that read or wrote the database with the
 * caller's own id did not, so the same widget or custom tool lived in two places: list_widgets saw a
 * widget GET /widget-definitions could not, and /tools/:name/execute could not find a custom tool the
 * caller had just saved (bravo retest, Nov 2026).
 *
 * Returns the team default workspace's principal on a team instance, else null (a personal instance, or
 * the caller already IS a workspace principal). Cached for a minute; the default workspace rarely changes.
 */
const TTL_MS = 60_000;
let cached = { at: 0, owner: null };

export async function teamAssetOwnerFor(userId, { now = Date.now, store = fileInstanceTeamStore() } = {}) {
  if (!process.env.AGNT_TENANT_SLUG || !userId || isWorkspacePrincipal(userId)) return null;
  if (now() - cached.at < TTL_MS) return cached.owner;
  let owner = null;
  try {
    const teamId = store.read(process.env.AGNT_TENANT_SLUG);
    if (teamId) {
      const { getTeamRepository } = await import('../../routes/TeamRoutes.js');
      const teams = getTeamRepository(); await teams.ready;
      const workspace = await teams.get('SELECT w.* FROM shared_workspace_defaults d JOIN shared_workspaces w ON w.id=d.workspace_id WHERE d.team_id=? AND w.archived_at IS NULL', [teamId]).catch(() => null);
      if (workspace) owner = (await ensureSharedScope(databaseRepository(db), teamId, workspace.id)).resourceOwnerId;
    }
  } catch (error) {
    console.warn('[team assets] could not resolve the team workspace:', error.message);
    return null; // not cached: try again next call
  }
  cached = { at: now(), owner };
  return owner;
}

/** Every library this caller's tools may read: their own, then the team's (where new things are saved). */
export async function assetOwnersFor(userId, options) {
  const team = await teamAssetOwnerFor(userId, options);
  return team && team !== userId ? [userId, team] : [userId];
}

/** Test seam. */
export function _resetTeamAssetOwner() { cached = { at: 0, owner: null }; }
