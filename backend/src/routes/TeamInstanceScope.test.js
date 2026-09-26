/**
 * A team's instance is only ever that team.
 *
 * Measured 2026-09-26 on bravo (a Business instance, the "bravo" team): opened
 * without `?team`, it served its owner a personal space on the team's server,
 * labelled "Personal", and chats made there showed up in the team view too.
 */
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import { createTeamInstanceScope } from './TeamInstanceScope.js';

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

function memoryStore(initial = null) {
 const saved = { value: initial };
 return { saved, read: slug => (saved.value?.slug === slug ? saved.value.teamId : null), write: (slug, teamId) => { saved.value = { slug, teamId }; } };
}

async function serve({ teamsFor, store = memoryStore(), slug = 'bravo' } = {}) {
 if (slug) vi.stubEnv('AGNT_TENANT_SLUG', slug); else vi.stubEnv('AGNT_TENANT_SLUG', '');
 const cloud = { request: vi.fn(async auth => { const answer = teamsFor(auth); if (answer instanceof Error) throw answer; return answer; }) };
 const clock = { t: 0 };
 const app = express();
 app.use('/api', createTeamInstanceScope({ cloud, store, now: () => clock.t }));
 app.all('/api/*', (req, res) => res.json({ team: req.headers['x-agnt-team-id'] || null }));
 const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
 const call = async (path, { token = 'Bearer member', headers = {} } = {}) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { headers: { ...(token ? { Authorization: token } : {}), ...headers } });
  return { status: r.status, body: await r.json() };
 };
 return { call, cloud, clock, store, close: () => new Promise(resolve => server.close(resolve)) };
}

const BRAVO_TEAM = [{ id: 'team-bravo', tenantSlug: 'bravo' }, { id: 'team-other', tenantSlug: 'other' }];

it('scopes asset requests on a team instance to that team, without the page asking', async () => {
 const s = await serve({ teamsFor: () => BRAVO_TEAM });
 try {
  expect((await s.call('/agents')).body.team).toBe('team-bravo');
  expect((await s.call('/workflows/abc')).body.team).toBe('team-bravo');
  expect(s.store.saved.value).toEqual({ slug: 'bravo', teamId: 'team-bravo' });
 } finally { await s.close(); }
});

it('leaves chats, memory and non-asset APIs alone: they stay the caller\'s own', async () => {
 const s = await serve({ teamsFor: () => BRAVO_TEAM });
 try {
  for (const path of ['/content-outputs', '/memory', '/users/me', '/health']) expect((await s.call(path)).body.team, path).toBeNull();
 } finally { await s.close(); }
});

it('never overrides a team the request already names', async () => {
 const s = await serve({ teamsFor: () => BRAVO_TEAM });
 try {
  expect((await s.call('/agents', { headers: { 'X-AGNT-Team-ID': 'explicit' } })).body.team).toBe('explicit');
  expect(s.cloud.request).not.toHaveBeenCalled();
 } finally { await s.close(); }
});

it('a personal instance is untouched', async () => {
 const s = await serve({ slug: 'goku', teamsFor: () => BRAVO_TEAM });
 try { expect(await s.call('/agents')).toEqual({ status: 200, body: { team: null } }); } finally { await s.close(); }
});

it('a desktop install never asks the control plane', async () => {
 const s = await serve({ slug: '', teamsFor: () => BRAVO_TEAM });
 try {
  expect((await s.call('/agents')).body.team).toBeNull();
  expect(s.cloud.request).not.toHaveBeenCalled();
 } finally { await s.close(); }
});

it('once the instance is known to be a team, a non-member gets no personal mode on it', async () => {
 const s = await serve({ teamsFor: auth => (auth === 'Bearer member' ? BRAVO_TEAM : []) });
 try {
  await s.call('/agents');
  expect(await s.call('/agents', { token: 'Bearer outsider' })).toEqual({ status: 403, body: { error: 'You are not a member of this workspace', code: 'not_workspace_member' } });
 } finally { await s.close(); }
});

it('remembers its team across restarts, so a control-plane outage cannot turn it personal', async () => {
 const store = memoryStore({ slug: 'bravo', teamId: 'team-bravo' });
 const s = await serve({ store, teamsFor: () => Object.assign(new Error('api down'), { status: 503 }) });
 try { expect((await s.call('/goals')).body.team).toBe('team-bravo'); } finally { await s.close(); }
});

it('a remembered team from another slug is ignored', async () => {
 const s = await serve({ store: memoryStore({ slug: 'someone-else', teamId: 'x' }), teamsFor: () => [] });
 try { expect((await s.call('/agents')).body.team).toBeNull(); } finally { await s.close(); }
});

it('asks the control plane once per token per minute', async () => {
 const s = await serve({ teamsFor: () => BRAVO_TEAM });
 try {
  await s.call('/agents'); await s.call('/goals'); await s.call('/skills');
  expect(s.cloud.request).toHaveBeenCalledTimes(1);
  s.clock.t += 60_001;
  await s.call('/agents');
  expect(s.cloud.request).toHaveBeenCalledTimes(2);
 } finally { await s.close(); }
});

it('a bad or missing token is left for authentication to refuse', async () => {
 const s = await serve({ teamsFor: () => Object.assign(new Error('bad token'), { status: 401 }) });
 try {
  expect((await s.call('/agents', { token: 'Bearer junk' })).body.team).toBeNull();
  expect((await s.call('/agents', { token: null })).body.team).toBeNull();
 } finally { await s.close(); }
});
