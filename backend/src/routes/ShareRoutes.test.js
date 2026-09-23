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

/** agnt.gg's share service, simulated: stores what it is sent, serves it back, forgets it on revoke. */
function fakeShareService() {
  const links = new Map();
  let next = 0;
  return {
    links,
    origin: 'https://agnt.gg',
    publish: vi.fn(async (authorization, payload) => { if (!authorization) throw Object.assign(new Error('Sign in'), { status: 401 }); const id = 'link' + String(++next).padStart(4, '0'); links.set(id, payload); return { id }; }),
    fetch: vi.fn(async id => { if (!links.has(id)) throw Object.assign(new Error('This share link no longer exists'), { status: 404 }); return { title: links.get(id).title, bundle: links.get(id).bundle }; }),
    revoke: vi.fn(async (_auth, id) => { links.delete(id); return {}; }),
  };
}

async function fixture(run, { role = 'member', legacyTeam = false } = {}) {
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
    // A team instance from before /shareable answers it the way express answers any unknown route.
    if (path === '/workspaces/general/shareable') { if (legacyTeam) throw Object.assign(new Error('Not found'), { status: 404 }); return [...tenant.data].map(([key, row]) => ({ kind: key.split(':')[0], id: key.split(':')[1], name: row.value.name || row.value.title })); }
    throw new Error('unexpected ' + path);
  });
  const publicShare = fakeShareService();
  const OPENAI = ['sk', 'proj', 'q'.repeat(40)].join('-');
  const outputs = { chat1: { id: 'chat1', user_id: 'alice', title: 'Launch plan', content: JSON.stringify({ messages: [{ role: 'user', content: 'Use ' + OPENAI + ' and show {{IMAGE_REF:img-1}}' }, { role: 'assistant', content: 'Plan ready.', toolCalls: [{ name: 'secret_tool', args: { path: 'C:/Users/alice' } }] }, { role: 'tool', content: 'raw tool output' }] }) }, bobs: { id: 'bobs', user_id: 'bob', content: '{"messages":[{"role":"user","content":"hi"}]}' } };
  const cloud = { access: vi.fn(async (_auth, id) => ({ id, name: 'Acme', role, tenantUrl: 'https://acme.agnt.gg' })) };
  const app = express(); app.use(express.json());
  app.use('/share', createShareRouter({ getRepository: () => repository, authenticate: (req, _res, next) => { req.user = { id: 'alice' }; next(); }, cloud, store: personal, instance, publicShare, readOutput: async id => outputs[id] || null }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (path, method = 'GET', body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/share${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json() }; };
  try { await run({ call, personal, tenant, instance, publicShare }); } finally {
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

describe('everything is shareable', () => {
  it('publishes the kind list clients render from', () => fixture(async ({ call }) => {
    const { body } = await call('/kinds');
    expect(body.map(k => k.kind)).toEqual(expect.arrayContaining(['agent', 'workflow', 'tool', 'skill', 'widget', 'goal', 'workspace']));
  }));

  it('copies a widget to the team like any other item', () => fixture(async ({ call, personal, tenant }) => {
    personal.data.set('widget:cw_aaaaaaaaaaaa', { owner: 'alice', value: { name: 'KPI board', source_code: '<b>ok</b>' } });
    const result = await call('/team/acme', 'POST', { items: ['widget:cw_aaaaaaaaaaaa'] });
    expect(result.status).toBe(200);
    expect([...tenant.data.keys()].find(key => key.startsWith('widget:'))).toMatch(/^widget:cw_[0-9a-f]{12}$/);
  }));

  it('still lists an older team that only knows the four original kinds', () => fixture(async ({ call }) => {
    await call('/team/acme', 'POST', { items: ['agent:a1'] });
    const { status, body } = await call('/team/acme/items');
    expect(status).toBe(200);
    expect(body.items.map(item => item.kind)).toEqual(['agent']);
  }, { legacyTeam: true }));
});

describe('share links', () => {
  it('publishes a sanitized bundle, never the secret, and remembers the link for the item', () => fixture(async ({ call, publicShare }) => {
    const created = await call('/link', 'POST', { items: ['agent:a1'] });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ url: 'https://agnt.gg/s/' + created.body.id, title: 'Researcher', root: { kind: 'agent', id: 'a1' }, needs: [{ provider: 'openai', reason: 'model' }] });
    const sent = publicShare.links.get(created.body.id);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
    expect(sent.summary.items).toEqual([{ kind: 'agent', name: 'Researcher', dependency: false }]);
    const listed = await call('/link?items=agent:a1');
    expect(listed.body).toEqual([expect.objectContaining({ id: created.body.id, stale: false })]);
  }));

  it('knows when the original changed since the link was made, and revokes it for everyone', () => fixture(async ({ call, personal, publicShare }) => {
    const { body: link } = await call('/link', 'POST', { items: ['agent:a1'] });
    personal.data.get('agent:a1').value.systemPrompt = 'Improved';
    expect((await call('/link?items=agent:a1')).body[0].stale).toBe(true);
    expect((await call('/link/' + link.id, 'DELETE')).status).toBe(200);
    expect(publicShare.links.has(link.id)).toBe(false);
    expect((await call('/link?items=agent:a1')).body).toEqual([]);
    expect((await call('/link/' + link.id, 'DELETE')).status).toBe(200);
    expect((await call('/link/not-mine', 'DELETE')).status).toBe(404);
  }));

  it('previews then installs a link as a fresh, re-sanitized copy, from an id or either link form', () => fixture(async ({ call, personal, publicShare }) => {
    // A hand-built hostile link: extra fields and a credential the sender never stripped.
    publicShare.links.set('gift0001', { title: 'Gift', bundle: { version: 1, items: [{ kind: 'agent', sourceId: 'x', definition: { name: 'Gift', provider: 'anthropic', systemPrompt: 'key ' + SECRET, apiKey: SECRET, created_by: 'mallory' } }] } });
    const preview = await call('/receive/preview', 'POST', { link: 'https://agnt.gg/s/gift0001' });
    expect(preview.body).toMatchObject({ id: 'gift0001', title: 'Gift', items: [{ kind: 'agent', name: 'Gift', stripped: 1 }], needs: [{ provider: 'anthropic', reason: 'model' }] });
    expect([...personal.data.keys()]).toEqual(['agent:a1']);
    const received = await call('/receive', 'POST', { link: 'agnt://shared?id=gift0001' });
    expect(received.status).toBe(200);
    const copy = personal.data.get('agent:' + received.body.installed[0].id);
    expect(copy.owner).toBe('alice');
    expect(JSON.stringify(copy)).not.toMatch(new RegExp(SECRET + '|mallory|apiKey'));
  }));

  it('shares a conversation as words only: no tool calls, no images, no credentials, never someone else\'s', () => fixture(async ({ call, publicShare }) => {
    const { status, body } = await call('/conversation-link', 'POST', { outputId: 'chat1' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ title: 'Launch plan', messages: 2, removed: 1 });
    const sent = publicShare.links.get(body.id);
    expect(sent.transcript.messages).toEqual([{ role: 'user', text: 'Use [removed] and show [image]' }, { role: 'assistant', text: 'Plan ready.' }]);
    expect(JSON.stringify(sent)).not.toMatch(/secret_tool|raw tool output|C:\/Users|IMAGE_REF/);
    expect((await call('/conversation-link?outputId=chat1')).body).toEqual([expect.objectContaining({ id: body.id })]);
    expect((await call('/conversation-link', 'POST', { outputId: 'bobs' })).status).toBe(404);
    expect((await call('/conversation-link', 'POST', { outputId: '../x' })).status).toBe(400);
  }));

  it('refuses anything that is not an AGNT share link before fetching', () => fixture(async ({ call, publicShare }) => {
    for (const link of ['https://evil.example/s/gift0001', 'http://agnt.gg/s/gift0001', '../../etc', 'javascript:alert(1)']) {
      expect((await call('/receive', 'POST', { link })).status).toBe(400);
    }
    expect(publicShare.fetch).not.toHaveBeenCalled();
    expect((await call('/receive', 'POST', { link: 'gone00001' })).status).toBe(404);
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
