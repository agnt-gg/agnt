import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

vi.mock('../services/auth/AuthManager.js', () => ({ default: { getConnectedApps: async () => [] } }));
const { createMemberAiRouter } = await import('./MemberAiRoutes.js');
const { useSettingsStore } = await import('../services/auth/memberAi.js');

let settings;
let server;
let base;
const ownerConnected = [{ providerId: 'claude-code' }, { providerId: 'openai-codex' }, { providerId: 'openai' }];

async function start(userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/instance/member-ai', createMemberAiRouter({
    authenticate: (req, _res, next) => { req.user = { id: userId }; next(); },
    listConnected: async () => ownerConnected,
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/instance/member-ai`;
}
const put = (body) => fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  settings = {};
  useSettingsStore({ read: () => settings, write: (value) => { settings = value; } });
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  useSettingsStore(null);
  await new Promise((resolve) => server.close(resolve));
});

describe("members' AI settings", () => {
  it('the owner sees who pays and the subscriptions they could share', async () => {
    await start('owner-1');
    expect(await (await fetch(base)).json()).toEqual({
      hosted: true, isOwner: true, billing: 'team',
      subscriptions: [{ id: 'claude-code', name: 'Claude Code', shared: false }, { id: 'openai-codex', name: expect.any(String), shared: false }],
    });
  });

  it('the owner changes who pays, and shares a subscription', async () => {
    await start('owner-1');
    expect((await put({ billing: 'member' })).status).toBe(200);
    const shared = await (await put({ sharedSubscriptions: ['claude-code'] })).json();
    expect(shared.billing).toBe('member');
    expect(shared.subscriptions.find((s) => s.id === 'claude-code').shared).toBe(true);
    expect(settings).toMatchObject({ billing: 'member', sharedSubscriptions: ['claude-code'] });
  });

  it('a member sees only what is shared, and cannot change anything', async () => {
    settings = { sharedSubscriptions: ['openai-codex'] };
    await start('member-2');
    const view = await (await fetch(base)).json();
    expect(view).toMatchObject({ hosted: true, isOwner: false, billing: 'team' });
    expect(view.subscriptions.map((s) => s.id)).toEqual(['openai-codex']);
    expect((await put({ sharedSubscriptions: ['claude-code'] })).status).toBe(403);
    expect(settings).toEqual({ sharedSubscriptions: ['openai-codex'] });
  });

  it('a desktop has no members to decide for', async () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    await start('anyone');
    expect(await (await fetch(base)).json()).toMatchObject({ hosted: false, subscriptions: [] });
    expect((await put({ billing: 'member' })).status).toBe(404);
  });

  it('rejects bad values without saving any part of the change', async () => {
    await start('owner-1');
    expect((await put({ billing: 'everyone' })).status).toBe(400);
    expect((await put({ billing: 'member', sharedSubscriptions: ['gmail'] })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(settings).toEqual({});
  });
});
