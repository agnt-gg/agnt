/**
 * Copy to team and copy to personal, run from the PERSONAL backend.
 *
 * Direction is always initiated here, where the user's own items live: this
 * backend builds a sanitized bundle and hands it to the team's instance over
 * HTTPS with the user's own sign-in, and the team re-sanitizes and re-checks
 * the user's project access before installing. The reverse asks the team for
 * a sanitized export and installs it for the user. Team pages never reach this
 * machine.
 *
 * /api/share is deliberately NOT a team-scoped API (ScopeApiPolicy), so a team
 * header can never turn this into a copy of someone else's items.
 */
import express from 'express';
import { authenticateToken } from './Middleware.js';
import { CloudTeamClient } from '../services/CloudTeamClient.js';
import { buildBundle, installBundle, contentHash, sanitize } from '../services/sharing/TeamBundle.js';
import { nativeStore, nodeProvider } from '../services/sharing/nativeStore.js';

const refuse = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
const ITEM = /^(agent|workflow|tool|skill):([A-Za-z0-9_.:-]{1,200})$/;
/** Accepts [{kind,id}], ["kind:id"] or "kind:id,kind:id". Anything malformed rejects the whole request. */
export function parseItems(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
  return entries.map(entry => {
    const text = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? entry.kind + ':' + entry.id : '';
    const match = ITEM.exec(text);
    if (!match) refuse(400, 'Invalid item reference');
    return { kind: match[1], id: match[2] };
  });
}

/** The only way this backend talks to a team: its own https origin, the user's own bearer, no redirects. */
export function teamInstanceClient({ fetchImpl = fetch } = {}) {
  return async function call(team, path, authorization, options = {}) {
    if (!team?.tenantUrl) refuse(409, 'This team has no instance yet');
    const base = new URL(team.tenantUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !loopback) refuse(502, 'The team instance address is not secure');
    const response = await fetchImpl(base.origin + '/api/teams/' + encodeURIComponent(team.id) + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) refuse(response.status, result.error || 'The team instance refused the request', { code: result.code });
    return result;
  };
}

/** Where copies went, so the original can offer "Update team copy". Lives with the personal data. */
async function linkStore(getRepository) {
  const repository = getRepository();
  await repository.ready;
  if (!repository.shareLinksReady) repository.shareLinksReady = repository.run('CREATE TABLE IF NOT EXISTS team_copy_links(kind TEXT NOT NULL,source_id TEXT NOT NULL,owner_id TEXT NOT NULL,team_id TEXT NOT NULL,project_id TEXT NOT NULL,team_item_id TEXT NOT NULL,source_hash TEXT NOT NULL,copied_at TEXT NOT NULL,PRIMARY KEY(kind,source_id,owner_id,team_id,project_id))');
  await repository.shareLinksReady;
  return {
    forItems: (ownerId, items) => Promise.all(items.map(item => repository.all('SELECT * FROM team_copy_links WHERE kind=? AND source_id=? AND owner_id=?', [item.kind, item.id, ownerId]))).then(rows => rows.flat()),
    replaces: async (ownerId, teamId, projectId) => Object.fromEntries((await repository.all('SELECT kind,source_id,team_item_id FROM team_copy_links WHERE owner_id=? AND team_id=? AND project_id=?', [ownerId, teamId, projectId])).map(row => [row.kind + ':' + row.source_id, row.team_item_id])),
    record: (ownerId, teamId, projectId, installed, hashes) => Promise.all(installed.map(item => {
      const [kind, ...rest] = item.source.split(':');
      return repository.run('INSERT INTO team_copy_links VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(kind,source_id,owner_id,team_id,project_id) DO UPDATE SET team_item_id=excluded.team_item_id,source_hash=excluded.source_hash,copied_at=excluded.copied_at', [kind, rest.join(':'), ownerId, teamId, projectId, item.id, hashes.get(item.source) || item.hash, new Date().toISOString()]);
    })),
  };
}

export function createShareRouter({ getRepository, authenticate = authenticateToken, cloud = new CloudTeamClient(), store = nativeStore, instance = teamInstanceClient() }) {
  const router = express.Router();
  router.use(authenticate);
  const userOf = req => req.user?.id || req.user?.userId;
  const handler = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!userOf(req)) refuse(401, 'Sign in required');
      res.json(await fn(req, userOf(req)));
    } catch (error) {
      if (!error.status) console.error('[Share]', error);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Sharing failed', code: error.code, missing: error.missing });
    }
  };
  const teamFor = async req => {
    const team = await cloud.access(req.headers.authorization, req.params.teamId);
    if (team.role === 'viewer') refuse(403, 'Guests cannot add to this team');
    return team;
  };
  const projectFor = async (team, req, projectId) => projectId || (await instance(team, '/workspaces/default', req.headers.authorization)).id;

  /** What would be copied: items, dependencies, what was removed, and which connections it needs. */
  router.post('/preview', handler(async (req, user) => {
    const items = parseItems(req.body?.items);
    const { preview } = await buildBundle(store, user, items, { includeDependencies: req.body?.includeDependencies !== false, nodeProvider });
    return preview;
  }));

  router.post('/team/:teamId', handler(async (req, user) => {
    const items = parseItems(req.body?.items);
    const team = await teamFor(req);
    const { bundle, preview } = await buildBundle(store, user, items, { includeDependencies: req.body?.includeDependencies !== false, nodeProvider });
    const projectId = await projectFor(team, req, typeof req.body?.projectId === 'string' ? req.body.projectId : null);
    const links = await linkStore(getRepository);
    const replaces = await links.replaces(user, team.id, projectId);
    const result = await instance(team, '/workspaces/' + encodeURIComponent(projectId) + '/install', req.headers.authorization, { method: 'POST', body: JSON.stringify({ bundle, replaces }) });
    await links.record(user, team.id, projectId, result.installed || [], new Map(bundle.items.map(item => [item.kind + ':' + item.sourceId, item.hash])));
    return { team: { id: team.id, name: team.name }, projectId, installed: result.installed || [], needs: preview.needs, removed: preview.removed };
  }));

  /** Where each item was copied, and whether the original changed since. */
  router.get('/links', handler(async (req, user) => {
    const items = parseItems(req.query.items);
    const rows = await (await linkStore(getRepository)).forItems(user, items);
    const current = new Map();
    for (const item of items) {
      const row = await store.read(item.kind, item.id, user);
      if (row) { try { current.set(item.kind + ':' + item.id, contentHash(sanitize(item.kind, row).definition)); } catch { /* unshareable now: never stale */ } }
    }
    return rows.map(row => ({ kind: row.kind, id: row.source_id, teamId: row.team_id, projectId: row.project_id, teamItemId: row.team_item_id, copiedAt: row.copied_at, stale: current.has(row.kind + ':' + row.source_id) && current.get(row.kind + ':' + row.source_id) !== row.source_hash }));
  }));

  /** What the team has, for "Copy to personal". */
  router.get('/team/:teamId/items', handler(async req => {
    const team = await cloud.access(req.headers.authorization, req.params.teamId);
    const projectId = await projectFor(team, req, typeof req.query.projectId === 'string' ? req.query.projectId : null);
    const items = await instance(team, '/workspaces/' + encodeURIComponent(projectId) + '/native', req.headers.authorization);
    return { projectId, items: Array.isArray(items) ? items : [] };
  }));

  router.post('/import/:teamId', handler(async (req, user) => {
    const items = parseItems(req.body?.items);
    const team = await cloud.access(req.headers.authorization, req.params.teamId);
    const projectId = await projectFor(team, req, typeof req.body?.projectId === 'string' ? req.body.projectId : null);
    const query = encodeURIComponent(items.map(item => item.kind + ':' + item.id).join(','));
    const bundle = await instance(team, '/workspaces/' + encodeURIComponent(projectId) + '/export?items=' + query, req.headers.authorization);
    return installBundle(store, user, bundle);
  }));

  return router;
}
