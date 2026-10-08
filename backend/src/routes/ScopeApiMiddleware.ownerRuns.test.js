import { it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { createScopeApiMiddleware } from './ScopeApiMiddleware.js';

vi.mock('../models/database/index.js', () => ({ default: {}, dbReady: Promise.resolve() }));
vi.mock('../services/authorization/ScopeRepository.js', () => ({
  databaseRepository: () => ({ run: async () => ({}), get: async () => null, all: async () => [] }),
  ensureSharedScope: async (_repository, teamId, workspaceId) => ({ id: 'workspace:' + workspaceId, team_id: teamId, resourceOwnerId: 'scope:' + workspaceId }),
}));
vi.mock('../services/CloudTeamClient.js', () => ({ CloudTeamClient: class { async request() { return { accessRevision: 1 }; } async access(_token, id) { return { id, role: 'owner' }; } } }));
afterEach(() => vi.unstubAllEnvs());

// Reported 2026-10-08 on a Business instance: the OWNER clicking Start on a workflow got
// 409 "Publish this in Team → Projects, then run it from there".
async function serve(actor) {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  const app = express();
  app.use('/api', createScopeApiMiddleware((req, _res, next) => { req.user = { id: actor, userId: actor }; next(); }, async (id) => ({ id, team_id: 'team' }), async () => ({ id: 'general' })));
  app.post('/api/workflows/:id/start', (req, res) => res.json({ ranAs: req.user.userId }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const start = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/wf-1/start`, { method: 'POST', headers: { Authorization: 'Bearer t', 'X-AGNT-Team-ID': 'team' } }); return { status: r.status, body: await r.json() }; };
  return { start, close: () => new Promise((resolve) => server.close(resolve)) };
}

it('the instance owner starts a workspace workflow directly, as the workspace', async () => {
  const { start, close } = await serve('owner-1');
  try {
    const result = await start();
    expect(result.status).toBe(200);
    expect(result.body.ranAs).toBe('scope:general');
  } finally { await close(); }
});

it('a member still has to publish before running', async () => {
  const { start, close } = await serve('member-2');
  try {
    const result = await start();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('publish_required');
  } finally { await close(); }
});
