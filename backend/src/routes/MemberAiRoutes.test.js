import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createMemberAiRouter } from './MemberAiRoutes.js';
import { useBillingStore } from '../services/auth/memberAi.js';

let billing;
let server;
let base;

async function start(userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/instance/member-ai', createMemberAiRouter({ authenticate: (req, _res, next) => { req.user = { id: userId }; next(); } }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/instance/member-ai`;
}
const put = (billingValue) => fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billing: billingValue }) });

beforeEach(() => {
  billing = null;
  useBillingStore({ read: () => billing, write: (value) => { billing = value; } });
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  useBillingStore(null);
  await new Promise((resolve) => server.close(resolve));
});

describe("who pays for members' AI", () => {
  it('the owner reads it and changes it', async () => {
    await start('owner-1');
    expect(await (await fetch(base)).json()).toEqual({ hosted: true, isOwner: true, billing: 'team' });
    const response = await put('member');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ billing: 'member' });
    expect(billing).toBe('member');
  });

  it('a member reads it but cannot change it', async () => {
    await start('member-2');
    expect(await (await fetch(base)).json()).toEqual({ hosted: true, isOwner: false, billing: 'team' });
    expect((await put('member')).status).toBe(403);
    expect(billing).toBeNull();
  });

  it('a desktop has no members to decide for', async () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    await start('anyone');
    expect(await (await fetch(base)).json()).toMatchObject({ hosted: false });
    expect((await put('member')).status).toBe(404);
  });

  it('rejects a value that is neither team nor member', async () => {
    await start('owner-1');
    expect((await put('everyone')).status).toBe(400);
  });
});
