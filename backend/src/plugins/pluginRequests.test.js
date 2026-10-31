import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import { PluginInstallRequests, memberInstallGrant, POLICY_DEFAULTS } from './PluginInstallRequests.js';
import { mountPluginRequestRoutes, canDecide } from './pluginRequestRoutes.js';

const youtube = { success: true, trustTier: 'official', integrityState: 'verified', valid: true, detected: { filesystem: {}, 'env-access': {}, network: {} }, declared: ['network'] };

describe('what a member may add without asking', () => {
  it('member-safe always; otherwise only what the owner allowed', () => {
    expect(memberInstallGrant('gmail-plugin', { ...youtube, detected: {} }, POLICY_DEFAULTS, true)).toBe('member-safe');
    expect(memberInstallGrant('youtube-plugin', youtube, POLICY_DEFAULTS, false)).toBe(null);
    expect(memberInstallGrant('youtube-plugin', youtube, { ...POLICY_DEFAULTS, preApproved: ['youtube-plugin'] }, false)).toBe('pre-approved');
    expect(memberInstallGrant('youtube-plugin', youtube, { ...POLICY_DEFAULTS, membersAllOfficial: true }, false)).toBe('all-official');
  });
  it('never a tampered download, whatever the policy; "all official" means official and verified', () => {
    const open = { preApproved: ['x'], adminsCanApprove: true, membersAllOfficial: true };
    expect(memberInstallGrant('x', { ...youtube, integrityState: 'mismatch' }, open, false)).toBe(null);
    expect(memberInstallGrant('y', { ...youtube, trustTier: 'verified' }, open, false)).toBe(null);
    expect(memberInstallGrant('y', { ...youtube, integrityState: 'tofu' }, open, false)).toBe(null);
  });
  it('the owner always decides; an admin only when the owner allows it; a member never', () => {
    expect(canDecide('owner', POLICY_DEFAULTS)).toBe(true);
    expect(canDecide('admin', POLICY_DEFAULTS)).toBe(false);
    expect(canDecide('admin', { ...POLICY_DEFAULTS, adminsCanApprove: true })).toBe(true);
    expect(canDecide('member', { ...POLICY_DEFAULTS, adminsCanApprove: true })).toBe(false);
  });
});

describe('plugin requests through the routes', () => {
  let db, store, server, base, installs, added, notes, reloads, listing, installResult;
  const roles = { own: 'owner', adm: 'admin', ana: 'member', ben: 'member' };
  beforeAll(() => new Promise((resolve) => {
    const app = express().use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] }; next(); });
    const router = express.Router();
    mountPluginRequestRoutes(router, {
      requests: { policy: () => store.policy(), setPolicy: (p) => store.setPolicy(p), pending: () => store.pending(), mine: (u) => store.mine(u), find: (i) => store.find(i), pendingFor: (n) => store.pendingFor(n), decide: (...a) => store.decide(...a), markSeen: (...a) => store.markSeen(...a), grantToMembers: (n) => store.grantToMembers(n) },
      installer: { getAvailablePlugins: async () => ({ plugins: [listing] }), installFromMarketplace: async (name, _v, opts) => { installs.push({ name, opts }); return installResult; } },
      accounts: { add: async (name, user) => added.push(`${name}:${user}`) },
      reload: async () => { reloads++; },
      notify: (user, payload) => notes.push(`${user}:${payload.status}`),
      roleOf: async (req) => roles[req.user.id] || 'member',
      restricted: () => true,
    });
    app.use('/plugins', router);
    server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}/plugins`; resolve(); });
  }));
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(async () => {
    db = new sqlite3.Database(':memory:'); store = new PluginInstallRequests(db); await store.ready();
    installs = []; added = []; notes = []; reloads = 0; listing = { name: 'youtube-plugin', price: 0 }; installResult = { success: true };
  });
  afterEach(() => new Promise((resolve) => db.close(() => resolve())));
  const call = async (method, path, user, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-user': user }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };

  it('a request shows in the owner’s queue, approving installs it for everyone who asked and tells them', async () => {
    const one = (await store.request('youtube-plugin', 'ana', youtube)).request;
    await store.request('youtube-plugin', 'ben', youtube);
    expect((await store.request('youtube-plugin', 'ana', youtube)).created).toBe(false);
    const queue = (await call('GET', '/requests', 'own')).body;
    expect(queue.canDecide).toBe(true);
    expect(queue.pending.map((r) => r.requesterId).sort()).toEqual(['ana', 'ben']);
    expect(queue.pending[0].report.reaches).toEqual(['filesystem', 'env-access', 'network']);
    expect((await call('GET', '/requests', 'ana')).body).toMatchObject({ canDecide: false, pending: [] });
    const approved = await call('POST', `/requests/${one.id}/approve`, 'own');
    expect(approved.status).toBe(200);
    expect(approved.body.approved).toBe(2);
    expect(installs).toHaveLength(1);
    expect(added.sort()).toEqual(['youtube-plugin:ana', 'youtube-plugin:ben']);
    expect(notes.sort()).toEqual(['ana:approved', 'ben:approved']);
    expect(reloads).toBe(1);
    expect((await call('POST', `/requests/${one.id}/approve`, 'own')).status).toBe(409);
    const mine = (await call('GET', '/requests', 'ana')).body.mine;
    expect(mine[0]).toMatchObject({ status: 'approved', seen: false });
    await call('POST', `/requests/${one.id}/seen`, 'ana');
    expect((await call('GET', '/requests', 'ana')).body.mine).toEqual([]);
  });

  // THE BUG: approving installed the plugin for the member, but never let them USE it. YouTube reaches the
  // filesystem and env, so with the default policy its tools stayed refused to the person it was approved for.
  it('approving a plugin lets members use it, not only have it installed', async () => {
    const r = (await store.request('youtube-plugin', 'ana', youtube)).request;
    expect(memberInstallGrant('youtube-plugin', youtube, await store.policy(), false)).toBe(null);
    await call('POST', `/requests/${r.id}/approve`, 'own');
    const policy = await store.policy();
    expect(policy.preApproved).toEqual(['youtube-plugin']);
    expect(memberInstallGrant('youtube-plugin', youtube, policy, false)).toBe('pre-approved');
  });

  it('the owner\u2019s block wins: a blocked plugin cannot be approved, by the owner or an admin', async () => {
    await store.setPolicy({ blockedPlugins: ['youtube-plugin'], adminsCanApprove: true });
    const r = (await store.request('youtube-plugin', 'ana', youtube)).request;
    for (const who of ['adm', 'own']) expect((await call('POST', `/requests/${r.id}/approve`, who)).body.code).toBe('plugin_blocked');
    expect(installs).toEqual([]);
    expect((await store.policy()).preApproved).toEqual([]);
  });

  it('plugins approved before this fix are granted once on upgrade, and only once', async () => {
    const legacy = new sqlite3.Database(':memory:');
    const run = (sql, p = []) => new Promise((res, rej) => legacy.run(sql, p, (e) => (e ? rej(e) : res())));
    // The schema as it was, with an approval that never granted use.
    await run("CREATE TABLE plugin_install_requests(id TEXT PRIMARY KEY, plugin_name TEXT NOT NULL, requester_id TEXT NOT NULL, status TEXT NOT NULL, report_json TEXT NOT NULL DEFAULT '{}', decided_by TEXT, decided_at TEXT, error TEXT, seen_at TEXT, created_at TEXT NOT NULL)");
    await run("INSERT INTO plugin_install_requests VALUES('1','youtube-plugin','ana','approved','{}','own','now',NULL,NULL,'now'),('2','x-plugin','ben','declined','{}','own','now',NULL,NULL,'now')");
    const upgraded = new PluginInstallRequests(legacy);
    expect((await upgraded.policy()).preApproved).toEqual(['youtube-plugin']);
    // The owner removes it later; restarting must not grant it again.
    await upgraded.setPolicy({ preApproved: [] });
    expect((await new PluginInstallRequests(legacy).policy()).preApproved).toEqual([]);
    await new Promise((resolve) => legacy.close(resolve));
  });

  it('members and (by default) admins cannot decide; the owner can let admins', async () => {
    const r = (await store.request('youtube-plugin', 'ana', youtube)).request;
    expect((await call('POST', `/requests/${r.id}/approve`, 'ana')).status).toBe(403);
    expect((await call('POST', `/requests/${r.id}/approve`, 'adm')).status).toBe(403);
    expect((await call('PUT', '/install-policy', 'adm', { adminsCanApprove: true })).status).toBe(403);
    expect((await call('PUT', '/install-policy', 'own', { adminsCanApprove: true })).body.policy.adminsCanApprove).toBe(true);
    expect((await call('POST', `/requests/${r.id}/decline`, 'adm')).body.request.status).toBe('declined');
    expect(notes).toEqual(['ana:declined']);
    expect(installs).toEqual([]);
  });

  it('a paid plugin is never approved on the approver’s purchase', async () => {
    listing = { name: 'youtube-plugin', price: 9 };
    const r = (await store.request('youtube-plugin', 'ana', youtube)).request;
    expect((await call('POST', `/requests/${r.id}/approve`, 'own')).body.code).toBe('paid_plugin');
    expect(installs).toEqual([]);
  });

  it('a failed install records the failure and tells the requester', async () => {
    const r = (await store.request('youtube-plugin', 'ana', youtube)).request;
    installResult = { success: false, error: 'npm failed' };
    const res = await call('POST', `/requests/${r.id}/approve`, 'own');
    expect(res.status).toBe(502);
    expect(res.body.request).toMatchObject({ status: 'failed', error: 'npm failed' });
    expect(added).toEqual([]);
    expect(notes).toEqual(['ana:failed']);
  });

  it('the policy refuses anything malformed and keeps strict defaults', async () => {
    expect((await call('GET', '/install-policy', 'ana')).body).toMatchObject({ policy: POLICY_DEFAULTS, canEdit: false, canDecide: false });
    expect((await call('PUT', '/install-policy', 'own', { preApproved: ['../etc'] })).status).toBe(400);
    expect((await call('PUT', '/install-policy', 'own', { membersAllOfficial: 'yes' })).status).toBe(400);
    const set = (await call('PUT', '/install-policy', 'own', { preApproved: ['youtube-plugin', 'youtube-plugin'], membersAllOfficial: true })).body.policy;
    expect(set).toEqual({ ...POLICY_DEFAULTS, preApproved: ['youtube-plugin'], adminsCanApprove: false, membersAllOfficial: true });
  });
});
