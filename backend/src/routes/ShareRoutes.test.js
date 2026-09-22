import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import { TeamRepository } from '../services/TeamRepository.js';
import { createShareRouter, teamInstanceClient } from './ShareRoutes.js';
import { installBundle, buildBundle } from '../services/sharing/TeamBundle.js';

// Assembled at runtime: a credential-shaped literal in source is exactly what secret scanners (rightly) block.
const SECRET = ['sk', 'proj', 'a'.repeat(40)].join('-');
function memoryStore(rows = {}) {
  const data = new Map(Object.entries(rows));
  return {
    data,
    read: async (kind, id, owner) => { const row = data.get(kind + ':' + id); return row && row.owner === owner ? row.value : null; },
    write: async (kind, id, value, owner) => { data.set(kind + ':' + id, { owner, value }); },
    customToolIds: async () => [],
  };
}

async function fixture(run, { role = 'member' } = {}) {
  const db = new sqlite3.Database(':memory:');
  const repository = new TeamRepository(db); await repository.ready;
  const personal = memoryStore({ 'agent:a1': { owner: 'alice', value: { name: 'Researcher', provider: 'openai', systemPrompt: 'key ' + SECRET, apiKey: SECRET } } });
  const tenant = memoryStore();
  // The team instance, simulated: default project, install and export, each owner-scoped exactly like the real routes.
  const instance = vi.fn(async (team, path, _auth, options = {}) => {
    if (path === '/workspaces/default') return { id: 'general' };
    if (path === '/workspaces/general/install') { const body = JSON.parse(options.body); return installBundle(tenant, 'scope:general', body.bundle, { replaces: body.replaces }); }
    if (path.startsWith('/workspaces/general/export')) return (await buildBundle(tenant, 'scope:general', decodeURIComponent(path.split('items=')[1]).split(',').map(s => ({ kind: s.split(':')[0], id: s.split(':')[1] })))).bundle;
    if (path === '/workspaces/general/native') return [...tenant.data].map(([key, row]) => ({ kind: key.split(':')[0], id: key.split(':')[1], name: row.value.name }));
    throw new Error('unexpected ' + path);
  });
  const cloud = { access: vi.fn(async (_auth, id) => ({ id, name: 'Acme', role, tenantUrl: 'https://acme.agnt.gg' })) };
  const app = express(); app.use(express.json());
  app.use('/share', createShareRouter({ getRepository: () => repository, authenticate: (req, _res, next) => { req.user = { id: 'alice' }; next(); }, cloud, store: personal, instance }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (path, method = 'GET', body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/share${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  try { await run({ call, personal, tenant, instance }); } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise((resolve, reject) => db.close(e => (e ? reject(e) : resolve())));
  }
}

describe('copy to team', () => {
  it('previews what would go, including what it needs and what was removed', () => fixture(async ({ call }) => {
    const { status, body } = await call('/preview', 'POST', { items: [{ kind: 'agent', id: 'a1' }] });
    expect(status).toBe(200);
    // apiKey is not a shareable agent field at all (allowlist); the key inside the prompt is what gets removed.
    expect(body.items).toEqual([{ kind: 'agent', id: 'a1', name: 'Researcher', dependency: false, stripped: 1 }]);
    expect(body.needs).toEqual([{ provider: 'openai', reason: 'model' }]);
  }));

  it('copies into the default project, never carrying the secret, and the original stays untouched', () => fixture(async ({ call, personal, tenant }) => {
    const result = await call('/team/acme', 'POST', { items: ['agent:a1'] });
    expect(result.status).toBe(200);
    expect(result.body.projectId).toBe('general');
    expect(JSON.stringify([...tenant.data.values()])).not.toContain(SECRET);
    expect(personal.data.get('agent:a1').value.apiKey).toBe(SECRET);
  }));

  it('updates the same team copy on re-share, and knows when the original changed', () => fixture(async ({ call, personal, tenant }) => {
    await call('/team/acme', 'POST', { items: ['agent:a1'] });
    expect((await call('/links?items=agent:a1')).body[0]).toMatchObject({ teamId: 'acme', projectId: 'general', stale: false });
    personal.data.get('agent:a1').value.systemPrompt = 'A better prompt';
    expect((await call('/links?items=agent:a1')).body[0].stale).toBe(true);
    await call('/team/acme', 'POST', { items: ['agent:a1'] });
    expect([...tenant.data.keys()].filter(k => k.startsWith('agent:'))).toHaveLength(1);
    expect((await call('/links?items=agent:a1')).body[0].stale).toBe(false);
  }));

  it('guests cannot add to a team', () => fixture(async ({ call }) => {
    expect((await call('/team/acme', 'POST', { items: ['agent:a1'] })).status).toBe(403);
  }, { role: 'viewer' }));

  it('rejects malformed item references before touching anything', () => fixture(async ({ call, instance }) => {
    expect((await call('/team/acme', 'POST', { items: ['wallet:w1'] })).status).toBe(400);
    expect((await call('/links?items=agent:../../x')).status).toBe(400);
    expect(instance).not.toHaveBeenCalled();
  }));
});

describe('copy to personal', () => {
  it('lists what the team has and installs a sanitized copy for the user with a fresh id', () => fixture(async ({ call, personal }) => {
    await call('/team/acme', 'POST', { items: ['agent:a1'] });
    const listed = (await call('/team/acme/items')).body;
    const teamAgent = listed.items.find(item => item.kind === 'agent');
    const imported = await call('/import/acme', 'POST', { items: ['agent:' + teamAgent.id] });
    expect(imported.status).toBe(200);
    const newId = imported.body.installed[0].id;
    expect(newId).not.toBe('a1');
    expect(personal.data.get('agent:' + newId)).toMatchObject({ owner: 'alice', value: { name: 'Researcher' } });
  }));
});

describe('team instance client', () => {
  it('only talks to https team origins, with no redirects', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: 1 }) }));
    const call = teamInstanceClient({ fetchImpl });
    await call({ id: 't', tenantUrl: 'https://acme.agnt.gg/ignored' }, '/workspaces/default', 'Bearer x');
    expect(fetchImpl).toHaveBeenCalledWith('https://acme.agnt.gg/api/teams/t/workspaces/default', expect.objectContaining({ redirect: 'error' }));
    await expect(call({ id: 't', tenantUrl: 'http://acme.agnt.gg' }, '/x', 'Bearer x')).rejects.toMatchObject({ status: 502 });
  });
});
