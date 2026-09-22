import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import { TeamRepository } from '../services/TeamRepository.js';
import { createTeamRouter } from './TeamRoutes.js';

beforeEach(() => vi.stubEnv('AGNT_TENANT_SLUG', 'example'));
afterEach(() => vi.unstubAllEnvs());

/** A cloud double that records grants, so assertions are about what the cloud would enforce. */
function cloudDouble(roles) {
  const grants = new Set();
  const registered = new Set();
  return {
    grants, registered,
    access: vi.fn(async (token, id) => {
      const user = token?.replace('Bearer ', '');
      if (id !== 'team' || !roles.has(user)) throw Object.assign(new Error('Team not found'), { status: 404 });
      return { id: 'team', name: 'Example', role: roles.get(user), tenantSlug: 'example' };
    }),
    request: vi.fn(async (_token, path, options = {}) => {
      const method = options.method || 'GET';
      if (path === '/team/members') return [...roles].map(([user_id, role]) => ({ user_id, role }));
      const capability = path.match(/workspaces\/([^/]+)\/members\/([^/]+)\/capabilities\/([^/]+)$/);
      if (capability) { const key = capability.slice(1).join('|'); method === 'PUT' ? grants.add(key) : grants.delete(key); return {}; }
      const project = path.match(/workspaces\/([^/]+)$/);
      if (project && method === 'PUT') { registered.add(project[1]); return {}; }
      if (path.includes('/access/')) return { accessRevision: 1 };
      return {};
    }),
  };
}

async function fixture(run) {
  const db = new sqlite3.Database(':memory:');
  const repository = new TeamRepository(db); await repository.ready;
  const roles = new Map([['owner', 'owner'], ['member', 'member'], ['guest', 'viewer']]);
  const cloud = cloudDouble(roles);
  const app = express(); app.use(express.json());
  app.use('/teams', createTeamRouter(() => repository, (req, _res, next) => { const id = req.headers.authorization?.replace('Bearer ', ''); if (id) req.user = { id }; next(); }, cloud));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (path, method = 'GET', body, user = 'owner') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ request, roles, cloud, repository }); } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise((resolve, reject) => db.close(e => (e ? reject(e) : resolve())));
  }
}

const granted = (cloud, project, user) => [...cloud.grants].filter(key => key.startsWith(project + '|' + user + '|')).map(key => key.split('|')[2]).sort();

describe('team projects', () => {
  it('a non-owner opening a new team gets a clear answer instead of an empty scope', () => fixture(async ({ request }) => {
    const result = await request('/team/workspaces/default', 'GET', null, 'member');
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/owner/);
  }));

  it('the owner opening the team creates exactly one General project, even under concurrent loads', () => fixture(async ({ request, cloud }) => {
    const results = await Promise.all([request('/team/workspaces/default'), request('/team/workspaces/default'), request('/team/workspaces')]);
    expect(results.every(r => r.status === 200)).toBe(true);
    const list = (await request('/team/workspaces')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'General', is_default: true });
    expect(cloud.registered.size).toBe(1);
  }));

  it('grants the whole team access by role when a project is created', () => fixture(async ({ request, cloud }) => {
    const project = (await request('/team/workspaces/default')).body;
    expect(granted(cloud, project.id, 'owner')).toContain('access.manage');
    expect(granted(cloud, project.id, 'member')).toContain('resources.write');
    expect(granted(cloud, project.id, 'member')).not.toContain('access.manage');
    expect(granted(cloud, project.id, 'guest')).toEqual(['files.read', 'resources.read', 'runs.read']);
  }));

  it('keeps an advanced exception through a role re-sync, and reset returns to the role', () => fixture(async ({ request, cloud }) => {
    const project = (await request('/team/workspaces/default')).body;
    expect((await request(`/team/workspaces/${project.id}/members/guest/capabilities/resources.write`, 'PUT')).status).toBe(200);
    expect((await request('/team/access/sync', 'POST', {})).status).toBe(200);
    expect(granted(cloud, project.id, 'guest')).toContain('resources.write');
    expect((await request(`/team/workspaces/${project.id}/members/guest/overrides`)).body).toEqual([{ capability: 'resources.write', granted: true }]);
    expect((await request(`/team/workspaces/${project.id}/members/guest/overrides`, 'DELETE')).status).toBe(200);
    expect(granted(cloud, project.id, 'guest')).not.toContain('resources.write');
  }));

  it('only owners and admins manage access, and only known capabilities', () => fixture(async ({ request }) => {
    const project = (await request('/team/workspaces/default')).body;
    expect((await request('/team/access/sync', 'POST', {}, 'member')).status).toBe(403);
    expect((await request(`/team/workspaces/${project.id}/members/guest/capabilities/resources.write`, 'PUT', null, 'member')).status).toBe(403);
    expect((await request(`/team/workspaces/${project.id}/members/guest/capabilities/root`, 'PUT')).status).toBe(400);
  }));
});
