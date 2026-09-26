import fs from 'node:fs';
import {CloudTeamClient} from '../services/CloudTeamClient.js';
import {TEAM_ASSET_APIS} from '../services/authorization/ScopeApiPolicy.js';
import pathManager from '../utils/PathManager.js';

/**
 * A TEAM'S INSTANCE IS ONLY EVER THAT TEAM.
 *
 * The team scope used to be opt-in: a page opened with `?team=<id>` sent
 * X-AGNT-Team-ID and got the team's assets; the same instance opened without it
 * served the caller's own, personal ones. So one team instance was two spaces
 * on one server, the address bar picked between them, and signing in at
 * bravo.t1.agnt.gg landed in a "Personal" that belonged to nobody's plan.
 *
 * Here, a request on a hosted instance that names no team is given the
 * instance's own team, when it has one. ScopeApiMiddleware then applies every
 * check it applies to `?team` requests: membership, role, project, audit.
 * Chats and memory are untouched; they stay private to their author inside a
 * team (ScopeApiPolicy.PRIVATE_IN_TEAM_APIS).
 *
 * WHICH TEAM. The control plane is the authority, asked with the caller's own
 * token: their team whose instance is this one. Answers are cached per token
 * for a minute. The instance's team never changes, so once learned it is
 * remembered on disk, which keeps two things true across sleep and wake:
 *   - someone who is not on the team gets no personal mode here (403);
 *   - an outage of the control plane cannot quietly turn this instance
 *     personal: with the team known, requests stay scoped and the scope
 *     middleware reports the outage itself.
 * An instance that has never been seen to have a team is a personal one, and
 * passes through untouched.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

export function fileInstanceTeamStore(file = pathManager.getDataPath('instance-team.json')) {
 return {
  read(slug) {
   try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); return saved?.slug === slug && typeof saved.teamId === 'string' ? saved.teamId : null; }
   catch { return null; }
  },
  write(slug, teamId) {
   try { fs.writeFileSync(file, JSON.stringify({slug, teamId})); }
   catch (error) { console.warn('[team instance] could not remember this instance\'s team:', error.message); }
  },
 };
}

export function createTeamInstanceScope({cloud = new CloudTeamClient(), store = fileInstanceTeamStore(), now = Date.now} = {}) {
 const byToken = new Map();
 let known = null;
 const slug = () => process.env.AGNT_TENANT_SLUG;
 const instanceTeam = () => (known ??= store.read(slug()) || null);

 /** The caller's team on this instance, or null. Throws when the control plane cannot answer. */
 async function callerTeam(authorization) {
  const hit = byToken.get(authorization);
  if (hit && hit.until > now()) return hit.teamId;
  const teams = await cloud.request(authorization, '');
  const team = Array.isArray(teams) ? teams.find(t => t?.tenantSlug === slug()) : null;
  const teamId = typeof team?.id === 'string' ? team.id : null;
  if (byToken.size >= CACHE_MAX) byToken.delete(byToken.keys().next().value);
  byToken.set(authorization, {teamId, until: now() + CACHE_TTL_MS});
  return teamId;
 }

 return async (req, res, next) => {
  if (!slug() || req.headers['x-agnt-team-id']) return next();
  if (!TEAM_ASSET_APIS.has(req.path.split('/')[1])) return next();
  const authorization = req.headers.authorization;
  // No credential: nothing to scope. The route's own guard refuses it.
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return next();
  let teamId;
  try {
   teamId = await callerTeam(authorization);
  } catch (error) {
   if (error.status === 401) return next(); // a bad token; authentication downstream says so
   const team = instanceTeam();
   if (team) { req.headers['x-agnt-team-id'] = team; return next(); }
   console.warn('[team instance] control plane unavailable; instance has no known team:', error.message);
   return next();
  }
  if (teamId) {
   if (instanceTeam() !== teamId) { known = teamId; store.write(slug(), teamId); }
   req.headers['x-agnt-team-id'] = teamId;
   return next();
  }
  if (instanceTeam()) return res.status(403).json({error: 'You are not a member of this workspace', code: 'not_workspace_member'});
  return next();
 };
}
