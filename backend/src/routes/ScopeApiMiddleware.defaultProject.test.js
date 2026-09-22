import { it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { createScopeApiMiddleware } from './ScopeApiMiddleware.js';

vi.mock('../models/database/index.js', () => ({ default: {}, dbReady: Promise.resolve() }));
vi.mock('../services/authorization/ScopeRepository.js', () => ({
  databaseRepository: () => ({ run: async () => ({}), get: async () => null, all: async () => [] }),
  ensureSharedScope: async (_repository, teamId, workspaceId) => ({ id: 'workspace:' + workspaceId, team_id: teamId, resourceOwnerId: 'scope:' + workspaceId }),
}));
vi.mock('../services/CloudTeamClient.js', () => ({ CloudTeamClient: class { async request() { return { accessRevision: 1 }; } async access(_token, id) { return { id, role: 'member' }; } } }));
afterEach(() => vi.unstubAllEnvs());

async function serve(getDefault) {
  vi.stubEnv('AGNT_TENANT_SLUG', 'example');
  const projects = { general: { id: 'general', team_id: 'team' }, other: { id: 'other', team_id: 'team' }, foreign: { id: 'foreign', team_id: 'elsewhere' } };
  const app = express();
  app.use('/api', createScopeApiMiddleware((req, _res, next) => { req.user = { id: 'alice' }; next(); }, async id => projects[id] || null, getDefault));
  app.get('/api/goals', (req, res) => res.json({ owner: req.user.id }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (headers) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/goals`, { headers: { Authorization: 'Bearer t', 'X-AGNT-Team-ID': 'team', ...headers } }); return { status: r.status, body: await r.json() }; };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

it('uses the default project when none is named, and never overrides an explicit one', async () => {
  const { call, close } = await serve(async () => ({ id: 'general' }));
  try {
    expect((await call({})).body.owner).toBe('scope:general');
    expect((await call({ 'X-AGNT-Workspace-ID': 'other' })).body.owner).toBe('scope:other');
    expect((await call({ 'X-AGNT-Workspace-ID': 'foreign' })).status).toBe(404);
  } finally { await close(); }
});

it('explains a team with no project yet instead of a bare refusal', async () => {
  const { call, close } = await serve(async () => null);
  try {
    const result = await call({});
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/no project yet/);
  } finally { await close(); }
});
