import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import db, { dbReady } from '../models/database/index.js';
import AgentModel from '../models/AgentModel.js';
import { TeamRepository } from '../services/TeamRepository.js';
import { createTeamRouter } from './TeamRoutes.js';
import { databaseRepository, ensureSharedScope } from '../services/authorization/ScopeRepository.js';
import { migrateOwnership } from '../services/authorization/OwnershipMigration.js';
import { OWNERSHIP_INVENTORY } from '../services/authorization/OwnershipInventory.js';
import { installOwnershipTriggers } from '../services/authorization/OwnershipTriggers.js';

/**
 * "Visible to" for a team agent: it moves to another teamspace through the real
 * router, the real native tables and the real ownership triggers (owner and scope
 * are immutable, so a move must be install-then-retire, never an UPDATE of the owner).
 */
beforeEach(() => vi.stubEnv('AGNT_TENANT_SLUG', 'example'));
afterEach(() => vi.unstubAllEnvs());

function cloudDouble(roles, deniedSpaces) {
  return {
    calls: [],
    async access(token, id) {
      const user = token?.replace('Bearer ', '');
      if (id !== 'team' || !roles.has(user)) throw Object.assign(new Error('Team not found'), { status: 404 });
      return { id: 'team', name: 'Example', role: roles.get(user), tenantSlug: 'example' };
    },
    async request(token, path) {
      this.calls.push(path);
      if (path === '/team/members') return [...roles].map(([user_id, role]) => ({ user_id, role }));
      const access = path.match(/workspaces\/([^/]+)\/access\/(.+)$/);
      if (access && deniedSpaces.has(access[1])) throw Object.assign(new Error('No access to this workspace'), { status: 403 });
      return access ? { accessRevision: 1 } : {};
    },
  };
}

it('owners move a team agent between teamspaces; members cannot; a denied destination changes nothing', async () => {
  await dbReady;
  const native = databaseRepository(db);
  await migrateOwnership(native);
  await installOwnershipTriggers(native, OWNERSHIP_INVENTORY);
  const teamDb = new sqlite3.Database(':memory:');
  const repository = new TeamRepository(teamDb);
  await repository.ready;
  const denied = new Set();
  const cloud = cloudDouble(new Map([['owner', 'owner'], ['ana', 'member']]), denied);
  const app = express();
  app.use(express.json());
  app.use('/teams', createTeamRouter(() => repository, (req, _res, next) => { req.user = { id: req.headers.authorization?.replace('Bearer ', '') }; next(); }, cloud));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (path, method = 'GET', body, user = 'owner') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const sales = (await call('/team/workspaces', 'POST', { name: 'Sales' })).body.id;
    const ops = (await call('/team/workspaces', 'POST', { name: 'Ops' })).body.id;
    const source = await ensureSharedScope(native, 'team', sales);
    const agentId = 'move-me-' + Date.now();
    await AgentModel.createOrUpdate(agentId, { name: 'Closer', status: 'active', provider: 'groq', model: 'm', systemPrompt: 'Close deals', assignedTools: [] }, source.resourceOwnerId);
    const names = async (ws) => (await call(`/team/workspaces/${ws}/native`)).body.filter((i) => i.kind === 'agent').map((i) => i.name);

    expect((await call(`/team/workspaces/${sales}/native/agent/${agentId}/move`, 'POST', { to: ops }, 'ana')).status).toBe(403);
    denied.add(ops);
    expect((await call(`/team/workspaces/${sales}/native/agent/${agentId}/move`, 'POST', { to: ops })).status).toBe(403);
    expect(await names(sales)).toEqual(['Closer']);
    denied.delete(ops);

    const moved = await call(`/team/workspaces/${sales}/native/agent/${agentId}/move`, 'POST', { to: ops });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({ moved: true, to: ops });
    expect(await names(sales)).toEqual([]);
    expect(await names(ops)).toEqual(['Closer']);
    expect(cloud.calls).toContain(`/team/instances/example/workspaces/${ops}/access/resources.write`);
    // A plain action route is unaffected: "move" never reached the execution handler.
    expect((await call(`/team/workspaces/${sales}/native/tool/x/move`, 'POST', { to: ops })).status).toBe(400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => teamDb.close(() => resolve()));
  }
});
