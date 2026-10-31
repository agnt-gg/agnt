import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import { TeamRepository } from '../services/TeamRepository.js';
import { createTeamRouter } from './TeamRoutes.js';
import { mountTeamSpaceRoutes, cardTitle } from './TeamSpaceRoutes.js';
import { initializeTeamWorkspaces } from '../services/TeamWorkspaceRepository.js';
import { initializeTeamSpaces } from '../services/TeamSpaceRepository.js';

beforeEach(() => vi.stubEnv('AGNT_TENANT_SLUG', 'example'));
afterEach(() => vi.unstubAllEnvs());

/** The cloud: roles per user, per-workspace capability denials, and a record of every call. */
function cloudDouble(roles, denied = new Set()) {
  return {
    calls: [],
    access: vi.fn(async (token, id) => {
      const user = token?.replace('Bearer ', '');
      if (id !== 'team' || !roles.has(user)) throw Object.assign(new Error('Team not found'), { status: 404 });
      return { id: 'team', name: 'Example', role: roles.get(user), tenantSlug: 'example' };
    }),
    request: vi.fn(async function (token, path, options = {}) {
      this.calls.push(path);
      const user = token?.replace('Bearer ', '');
      if (path === '/team/members') return [...roles].map(([user_id, role]) => ({ user_id, role }));
      const access = path.match(/workspaces\/([^/]+)\/access\/(.+)$/);
      if (access && denied.has(user + '|' + access[1])) throw Object.assign(new Error('No access to this workspace'), { status: 403 });
      if (access) return { accessRevision: 1 };
      return {};
    }),
  };
}

async function fixture(run, { denied, extraRoles = [] } = {}) {
  const db = new sqlite3.Database(':memory:');
  const repository = new TeamRepository(db); await repository.ready;
  const roles = new Map([['owner', 'owner'], ['ana', 'member'], ['ben', 'member'], ['vic', 'viewer'], ...extraRoles]);
  const cloud = cloudDouble(roles, denied);
  cloud.request = cloud.request.bind(cloud);
  const app = express(); app.use(express.json());
  app.use('/teams', createTeamRouter(() => repository, (req, _res, next) => { const id = req.headers.authorization?.replace('Bearer ', ''); if (id) req.user = { id }; next(); }, cloud));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (path, method = 'GET', body, user = 'ana') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const ws = (await request('/team/workspaces', 'POST', { name: 'Sales' }, 'owner')).body.id;
    await run({ request, cloud, repository, ws });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve())));
  }
}

describe('teamspace routes through the real team router', () => {
  it('new teamspace: owners and admins can create one; members and guests are refused with the reason', () => fixture(async ({ request }) => {
    expect((await request('/team/workspaces', 'POST', { name: 'Product' }, 'owner')).status).toBe(200);
    const byAdmin = await request('/team/workspaces', 'POST', { name: 'Ops' }, 'ada');
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.name).toBe('Ops');
    for (const user of ['ana', 'vic']) {
      const refused = await request('/team/workspaces', 'POST', { name: 'Nope' }, user);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('Only owners and admins can create a teamspace');
    }
  }, { extraRoles: [['ada', 'admin']] }));

  it('chat: a member posts, a teammate sees it, and the mention lands in their inbox on this instance', () => fixture(async ({ request, cloud, ws }) => {
    const posted = await request(`/team/workspaces/${ws}/messages`, 'POST', { body: 'hi @ben', mentions: [{ kind: 'person', id: 'ben' }] });
    expect(posted.status).toBe(200);
    expect((await request(`/team/workspaces/${ws}/messages`, 'GET', null, 'ben')).body.map((m) => m.body)).toEqual(['hi @ben']);
    const inbox = await request('/team/inbox', 'GET', null, 'ben');
    expect(inbox.status).toBe(200);
    expect(inbox.body.map((i) => i.kind)).toEqual(['mention']);
    // The inbox is served here, never proxied to the cloud's own routes.
    expect(cloud.calls).not.toContain('/team/inbox');
  }));

  it('only teammates can be mentioned or assigned', () => fixture(async ({ request, ws }) => {
    expect((await request(`/team/workspaces/${ws}/messages`, 'POST', { body: 'hi', mentions: [{ kind: 'person', id: 'stranger' }] })).status).toBe(400);
    expect((await request(`/team/workspaces/${ws}/tasks`, 'POST', { title: 'x', assignee: { kind: 'person', id: 'stranger' } })).status).toBe(400);
  }));

  it('a viewer reads but cannot write; a non-member gets nothing', () => fixture(async ({ request, ws }) => {
    expect((await request(`/team/workspaces/${ws}/messages`, 'GET', null, 'vic')).status).toBe(200);
    expect((await request(`/team/workspaces/${ws}/messages`, 'POST', { body: 'hi' }, 'vic')).status).toBe(403);
    expect((await request(`/team/workspaces/${ws}/tasks`, 'GET', null, 'mallory')).status).toBe(404);
    expect((await request('/team/inbox', 'GET', null, 'mallory')).status).toBe(404);
  }));

  it('board: create, move with revision, conflict on a stale move', () => fixture(async ({ request, ws }) => {
    const task = (await request(`/team/workspaces/${ws}/tasks`, 'POST', { title: 'Call Northwind', assignee: { kind: 'person', id: 'ben' } })).body;
    expect(task).toMatchObject({ status: 'todo', revision: 1, assignee: { kind: 'person', id: 'ben' } });
    expect((await request('/team/inbox', 'GET', null, 'ben')).body.map((i) => i.kind)).toEqual(['assigned']);
    expect((await request(`/team/workspaces/${ws}/tasks/${task.id}`, 'PATCH', { status: 'doing', expectedRevision: 1 }, 'ben')).status).toBe(200);
    const stale = await request(`/team/workspaces/${ws}/tasks/${task.id}`, 'PATCH', { status: 'done', expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('revision_conflict');
  }));

  it('docs: made in a teamspace, hidden from the team library', () => fixture(async ({ request, ws }) => {
    const doc = (await request(`/team/workspaces/${ws}/docs`, 'POST', { name: 'Playbook', content: '# Hello' })).body;
    expect((await request(`/team/workspaces/${ws}/docs/${doc.id}`)).body.content).toBe('# Hello');
    expect((await request('/team/assets')).body.map((a) => a.id)).not.toContain(doc.id);
    expect((await request(`/team/assets/${doc.id}`)).status).toBe(404);
    expect((await request(`/team/workspaces/${ws}/docs/${doc.id}`, 'PUT', { content: 'v2', expectedRevision: 1 }, 'ben')).body.revision).toBe(2);
  }));

});

describe('cardTitle', () => {
  it('removes the agent\u2019s whole name and nothing else', () => {
    expect(cardTitle('@Writer draft the launch post', ['Writer'])).toBe('draft the launch post');
    expect(cardTitle('@Proposal Agent, pricing for Globex', ['Proposal Agent'])).toBe('pricing for Globex');
    expect(cardTitle('ask @Proposal Agent about @Proposal', ['Proposal', 'Proposal Agent'])).toBe('ask about');
  });
});

describe('per-workspace access', () => {
  it('a member the cloud denies on this workspace gets 403 on every teamspace route', async () => {
    // Workspace ids are random, so deny by user for any workspace.
    const db = new sqlite3.Database(':memory:');
    const repository = new TeamRepository(db); await repository.ready;
    const roles = new Map([['owner', 'owner'], ['ben', 'member']]);
    const cloud = cloudDouble(roles);
    const inner = cloud.request;
    cloud.request = async (token, path, options) => {
      if (token === 'Bearer ben' && /\/access\//.test(path)) throw Object.assign(new Error('No access to this workspace'), { status: 403 });
      return inner.call(cloud, token, path, options);
    };
    const app = express(); app.use(express.json());
    app.use('/teams', createTeamRouter(() => repository, (req, _res, next) => { const id = req.headers.authorization?.replace('Bearer ', ''); if (id) req.user = { id }; next(); }, cloud));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const call = async (path, method = 'GET', body, user = 'ben') => (await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user }, ...(body ? { body: JSON.stringify(body) } : {}) })).status;
    try {
      const ws = (await (await fetch(`http://127.0.0.1:${server.address().port}/teams/team/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ name: 'Private' }) })).json()).id;
      expect(await call(`/team/workspaces/${ws}/messages`)).toBe(403);
      expect(await call(`/team/workspaces/${ws}/docs`)).toBe(403);
      expect(await call(`/team/workspaces/${ws}/tasks`, 'POST', { title: 'x' })).toBe(403);
      expect(await call(`/team/workspaces/${ws}/messages`, 'GET', null, 'owner')).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => db.close(() => resolve()));
    }
  });
});

describe('agents on cards (stubbed executor, real routes and repository)', () => {
  async function agentFixture(run, executor, annie = async () => { throw new Error('Annie was not asked'); }) {
    const db = new sqlite3.Database(':memory:');
    const repository = new TeamRepository(db); await repository.ready;
    await initializeTeamWorkspaces(repository); await initializeTeamSpaces(repository);
    await repository.run("INSERT INTO teams VALUES('team','T','owner','now')");
    await repository.run("INSERT INTO shared_workspaces(id,team_id,name,created_by) VALUES('ws','team','Sales','owner')");
    const roles = new Map([['ana', 'member'], ['ben', 'member']]);
    const pending = [];
    const annieCalls = [];
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.headers.authorization.replace('Bearer ', '') }; next(); });
    const router = express.Router();
    const handler = (fn) => async (req, res) => {
      const scoped = Object.create(repository);
      scoped.transaction = repository.transaction.bind(repository);
      scoped.member = async (teamId, userId, allowed) => {
        const role = roles.get(userId);
        if (teamId !== 'team' || !role) throw Object.assign(new Error('Team not found'), { status: 404 });
        if (allowed && !allowed.includes(role)) throw Object.assign(new Error('Forbidden'), { status: 403 });
        return { role };
      };
      try { res.json(await fn(scoped, req, req.user.id)); } catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code }); }
    };
    const realtime = { members: async () => [...roles.keys()], space: vi.fn(async () => {}), inbox: vi.fn() };
    mountTeamSpaceRoutes(router, {
      handler, realtime,
      workspaceAgents: async () => [{ id: 'proposal', name: 'Proposal Agent', kind: 'agent', status: 'published' }],
      agentExecutor: () => executor,
      schedule: (fn) => pending.push(fn()),
      askAnnie: (input) => (annieCalls.push(input), annie(input)),
    });
    app.use('/teams', router);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const request = async (path, method = 'GET', body, user = 'ana') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + user }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    try { await run({ request, settle: () => Promise.all(pending.splice(0)), realtime, annieCalls }); } finally {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => db.close(() => resolve()));
    }
  }

  it('@agent in chat → card → run → Review with the result → approval in the poster\u2019s inbox → approve saves a doc', () => agentFixture(async ({ request, settle }) => {
    const posted = await request('/team/workspaces/ws/messages', 'POST', { body: '@Proposal Agent draft pricing for Globex', mentions: [{ kind: 'agent', id: 'proposal' }] });
    expect(posted.status).toBe(200);
    await settle();
    const [task] = (await request('/team/workspaces/ws/tasks')).body;
    expect(task).toMatchObject({ status: 'review', agentState: 'waiting', assignee: { kind: 'agent', id: 'proposal' }, result: 'Pricing: $1,500/mo', sourceMessageId: posted.body.id });
    const messages = (await request('/team/workspaces/ws/messages')).body;
    expect(messages.map((m) => m.author.kind)).toEqual(['person', 'agent']);
    expect((await request('/team/inbox')).body.map((i) => [i.kind, i.state])).toEqual([['approval', 'pending']]);
    const decided = await request(`/team/workspaces/ws/tasks/${task.id}/approve`, 'POST', { saveAsDoc: true });
    expect(decided.body.task.status).toBe('done');
    expect((await request('/team/workspaces/ws/docs')).body.map((d) => d.name)).toEqual(['draft pricing for Globex']);
  }, async (input) => {
    expect(input).toMatch(/Task: draft pricing for Globex/);
    return { runId: 'r1', status: 'completed', result: { content: 'Pricing: $1,500/mo' } };
  }));

  it('an @agent that is not in this teamspace is refused, and nothing is posted or run', () => agentFixture(async ({ request, settle }) => {
    const result = await request('/team/workspaces/ws/messages', 'POST', { body: '@Ghost do it', mentions: [{ kind: 'agent', id: 'ghost' }] });
    expect(result.status).toBe(400);
    await settle();
    expect((await request('/team/workspaces/ws/messages')).body).toEqual([]);
    expect((await request('/team/workspaces/ws/tasks')).body).toEqual([]);
  }, async () => { throw new Error('must not run'); }));

  it('an unpublished agent leaves the card blocked with a plain explanation, not a stack trace', () => agentFixture(async ({ request, settle }) => {
    const task = (await request('/team/workspaces/ws/tasks', 'POST', { title: 'Draft', assignee: { kind: 'agent', id: 'proposal' } })).body;
    await settle();
    const detail = (await request(`/team/workspaces/ws/tasks/${task.id}`)).body;
    expect(detail).toMatchObject({ status: 'todo', agentState: 'blocked' });
    expect(detail.comments.at(-1).body).toMatch(/not published/);
  }, async () => { throw Object.assign(new Error('Publish this before running it'), { status: 409, code: 'publish_required' }); }));

  // @Annie answers in the chat as the person who tagged her, with the chat as context; she makes no card.
  it('@Annie answers in the teamspace chat as the person who tagged her, with no card', () => agentFixture(async ({ request, settle, annieCalls }) => {
    await request('/team/workspaces/ws/messages', 'POST', { body: 'we need a Globex follow-up' }, 'ben');
    const posted = await request('/team/workspaces/ws/messages', 'POST', { body: '@Annie draft a two-line follow-up to Globex', mentions: [{ kind: 'agent', id: 'annie' }] });
    expect(posted.status).toBe(200);
    await settle();
    expect(annieCalls).toHaveLength(1);
    expect(annieCalls[0]).toMatchObject({ userId: 'ana', authToken: 'Bearer ana' });
    expect(annieCalls[0].prompt).toMatch(/we need a Globex follow-up/);
    expect(annieCalls[0].prompt).toMatch(/The request: @Annie draft a two-line follow-up to Globex/);
    const messages = (await request('/team/workspaces/ws/messages')).body;
    expect(messages.at(-1)).toMatchObject({ author: { kind: 'agent', id: 'annie' }, body: 'Hi Globex, following up on Tuesday.' });
    expect((await request('/team/workspaces/ws/tasks')).body).toEqual([]);
  }, async () => { throw new Error('no agent runs'); }, async () => 'Hi Globex, following up on Tuesday.'));

  it('if Annie cannot answer, the chat says so plainly', () => agentFixture(async ({ request, settle }) => {
    await request('/team/workspaces/ws/messages', 'POST', { body: '@Annie hi', mentions: [{ kind: 'agent', id: 'annie' }] });
    await settle();
    expect((await request('/team/workspaces/ws/messages')).body.at(-1).body).toMatch(/could not answer/);
  }, async () => { throw new Error('no agent runs'); }, async () => { throw new Error('model down'); }));

  it('sending a result back runs the agent again with the note', () => agentFixture(async ({ request, settle }) => {
    const task = (await request('/team/workspaces/ws/tasks', 'POST', { title: 'Draft', assignee: { kind: 'agent', id: 'proposal' } })).body;
    await settle();
    await request(`/team/workspaces/ws/tasks/${task.id}/send-back`, 'POST', { note: 'shorter please' });
    await settle();
    const detail = (await request(`/team/workspaces/ws/tasks/${task.id}`)).body;
    expect(detail.status).toBe('review');
    expect(detail.comments.map((c) => c.body)).toContain('Sent back: shorter please');
  }, (() => { let n = 0; return async (input) => ({ status: 'completed', result: { content: ++n === 1 ? 'long draft' : input.includes('shorter please') ? 'short draft' : 'no note seen' } }); })()));
});
