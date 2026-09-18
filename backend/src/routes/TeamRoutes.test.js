import express from 'express';
import sqlite3 from 'sqlite3';
import {
  randomBytes
} from 'node:crypto';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';
import {
  createTeamRouter
} from './TeamRoutes.js';
import {
  TeamRepository
} from '../services/TeamRepository.js';
let server, base, db, repository;
const identities = new Map();
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  repository = new TeamRepository(db);
  await repository.ready;
  identities.clear();
  const app = express();
  app.use(express.json({
    limit: '250kb'
  }));
  const auth = (req, res, next) => {
    req.user = identities.get(req.headers.authorization);
    next()
  };
  app.use('/teams', createTeamRouter(() => repository, auth));
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  });
  base = 'http://127.0.0.1:' + server.address().port + '/teams'
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await repository.queue;
  await new Promise((r, j) => db.close(e => e ? j(e) : r()))
});

function identity(id, email = id + '@example.com') {
  const key = 'Bearer ' + randomBytes(16).toString('hex');
  identities.set(key, {
    id,
    email
  });
  return key
}
async function request(path = '', method = 'GET', body, auth) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? {
        Authorization: auth
      } : {}),
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: r.status,
    headers: r.headers,
    body: await r.json()
  }
}
describe('TeamRoutes over real HTTP', () => {
  it('requires identity even when middleware provides none', async () => {
    expect((await request()).status).toBe(401);
    expect((await request('', 'POST', {
      name: 'Team'
    })).status).toBe(401)
  });
  it('persists a two-user membership and shared asset edit flow; revocation stops direct-ID access', async () => {
    const owner = identity('owner'),
      editor = identity('editor'),
      stranger = identity('stranger');
    const team = (await request('', 'POST', {
      name: 'Engineering'
    }, owner)).body;
    const invitation = (await request('/' + team.id + '/invitations', 'POST', {
      email: 'editor@example.com',
      role: 'member'
    }, owner)).body;
    expect((await request('/accept', 'POST', {
      token: invitation.token
    }, stranger)).status).toBe(403);
    expect((await request('/accept', 'POST', {
      token: invitation.token
    }, editor)).status).toBe(200);
    const asset = (await request('/' + team.id + '/assets', 'POST', {
      name: 'Evidence',
      kind: 'markdown',
      content: '# v1'
    }, owner)).body;
    expect((await request('/' + team.id + '/assets/' + asset.id, 'GET', undefined, editor)).body.content).toBe('# v1');
    expect((await request('/' + team.id + '/assets', 'POST', {
      id: asset.id,
      name: 'Evidence',
      kind: 'markdown',
      content: '# v2',
      expectedRevision: 1
    }, editor)).status).toBe(200);
    expect((await request('/' + team.id + '/assets', 'POST', {
      id: asset.id,
      name: 'Evidence',
      kind: 'markdown',
      content: 'stale',
      expectedRevision: 1
    }, owner)).status).toBe(409);
    await request('/' + team.id + '/members/editor', 'DELETE', undefined, owner);
    expect((await request('/' + team.id + '/assets/' + asset.id, 'GET', undefined, editor)).status).toBe(404);
    expect((await request('/' + team.id + '/assets/' + asset.id, 'GET', undefined, owner)).body.content).toBe('# v2');
    expect((await request('/' + team.id + '/assets', 'GET', undefined, stranger)).status).toBe(404)
  });
  it('never sends invitation tokens in listings and disables response caching', async () => {
    const owner = identity('owner');
    const team = (await request('', 'POST', {
      name: 'A'
    }, owner)).body;
    const inv = (await request('/' + team.id + '/invitations', 'POST', {
      email: 'x@example.com',
      role: 'viewer'
    }, owner)).body;
    const list = await request('/' + team.id + '/invitations', 'GET', undefined, owner);
    expect(JSON.stringify(list.body)).not.toContain(inv.token);
    expect(JSON.stringify(list.body)).not.toContain('token_hash');
    expect(list.headers.get('cache-control')).toBe('no-store')
  });
});
