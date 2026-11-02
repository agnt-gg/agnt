import { it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { createScopeApiMiddleware } from './ScopeApiMiddleware.js';
import { currentScopeRequest } from '../services/authorization/ScopeRequestContext.js';

const cloudState = vi.hoisted(() => ({ policy: null, denied: new Set(), requests: [] }));
vi.mock('../models/database/index.js', () => ({ default: {}, dbReady: Promise.resolve() }));
vi.mock('../services/authorization/ScopeRepository.js', () => ({
  databaseRepository: () => ({ run: async () => ({}), get: async () => null, all: async () => [] }),
  ensureSharedScope: async (_repository, teamId, workspaceId) => ({ id: 'workspace:' + workspaceId, team_id: teamId, resourceOwnerId: 'scope:' + workspaceId }),
}));
vi.mock('../services/CloudTeamClient.js', () => ({ CloudTeamClient: class {
  async request(_token, route) { cloudState.requests.push(route); const capability = route.split('/').pop(); if (cloudState.denied.has(capability)) throw Object.assign(new Error('Not allowed: ' + capability), { status: 403 }); return { accessRevision: 1 }; }
  async access(_token, id) { return { id, role: 'member', policy: cloudState.policy }; }
} }));
afterEach(() => { vi.unstubAllEnvs(); cloudState.policy = null; cloudState.denied.clear(); cloudState.requests.length = 0; });

// 2026-10-08: the OWNER got 409 publish_required on Start. Nov 2026: members still did, so they could
// build workflows and agents but never run them. Members now run as themselves (runActor.js), under the
// owner's settings.
async function serve(actor) {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  const app = express();
  app.use('/api', createScopeApiMiddleware((req, _res, next) => { req.user = { id: actor, userId: actor }; next(); }, async (id) => ({ id, team_id: 'team' }), async () => ({ id: 'general' })));
  app.post('/api/workflows/:id/start', (req, res) => res.json({ ranAs: req.user.userId, actor: currentScopeRequest()?.actorId }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const start = async () => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/wf-1/start`, { method: 'POST', headers: { Authorization: 'Bearer t', 'X-AGNT-Team-ID': 'team' } }); return { status: r.status, body: await r.json() }; };
  return { start, close: () => new Promise((resolve) => server.close(resolve)) };
}

it('the instance owner starts a workspace workflow directly, as the workspace', async () => {
  const { start, close } = await serve('owner-1');
  try {
    const result = await start();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ranAs: 'scope:general', actor: 'owner-1' });
  } finally { await close(); }
});

it("a member starts it directly too, the data stays the workspace's and the run knows it is the member", async () => {
  const { start, close } = await serve('member-2');
  try {
    const result = await start();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ranAs: 'scope:general', actor: 'member-2' });
    expect(cloudState.requests.filter((route) => /\/access\/(runs\.execute|connections\.use)$/.test(route)).map((route) => route.split('/').pop())).toEqual(['runs.execute', 'connections.use']);
  } finally { await close(); }
});

it("the owner's \"Run workflows and agents\" setting turned off refuses members, naming the setting", async () => {
  cloudState.policy = { permissions: { 'workflows.run': false } };
  const { start, close } = await serve('member-2');
  try {
    const result = await start();
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'team_policy_denied', permission: 'workflows.run' });
    expect(result.body.error).toMatch(/Run workflows and agents/);
  } finally { await close(); }
});

it("a member without connections.use in this teamspace cannot spend its connections", async () => {
  cloudState.denied.add('connections.use');
  const { start, close } = await serve('member-2');
  try {
    expect((await start()).status).toBe(403);
  } finally { await close(); }
});
