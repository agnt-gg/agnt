import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A hosted TEAM instance pools quota on its owner's plan but never per-person
 * things (inboxes). A call made for a team member names that member with
 * X-AGNT-Actor, signed with the instance key: only the instance may say which
 * member it acts for, never whoever happens to be signed in. The owner, team
 * workspace work and every desktop call exactly as before.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer owner-session' }), getSessionToken: () => 'owner-session' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: async () => true, isEnforcing: () => false }));
vi.mock('./auth/planDenial.js', () => ({ planDenialMessageFor: () => 'upgrade' }));

const KEY = 'agnt_ik_' + 'c'.repeat(64);
const ENV = ['AGNT_TENANT_SLUG', 'AGNT_TENANT_OWNER', 'AGNT_INSTANCE_KEY', 'AGNT_TENANT_MEMBERS'];
const ok = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' });

async function headersFor(actor, env) {
  for (const name of ENV) delete process.env[name];
  Object.assign(process.env, env);
  const fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  const { callService } = await import('./agntServices.js');
  await callService('mail', '/inboxes', { actor, retries: 0 });
  return fetchMock.mock.calls[0][1].headers;
}

const hosted = { AGNT_TENANT_SLUG: 'genii', AGNT_TENANT_OWNER: 'owner-1', AGNT_INSTANCE_KEY: KEY };

describe('callService acts for a team member', () => {
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of ENV) (saved[name] === undefined ? delete process.env[name] : (process.env[name] = saved[name]));
  });

  it('a member: instance key plus X-AGNT-Actor', async () => {
    const headers = await headersFor('member-2', hosted);
    expect(headers.Authorization).toBe('Bearer ' + KEY);
    expect(headers['X-AGNT-Actor']).toBe('member-2');
  });

  it('the owner and team-workspace work: unchanged, no actor', async () => {
    for (const actor of ['owner-1', 'scope:5a8e', undefined]) {
      const headers = await headersFor(actor, hosted);
      expect(headers.Authorization).toBe('Bearer owner-session');
      expect(headers).not.toHaveProperty('X-AGNT-Actor');
    }
  });

  it('a desktop never names an actor', async () => {
    const headers = await headersFor('member-2', {});
    expect(headers.Authorization).toBe('Bearer owner-session');
    expect(headers).not.toHaveProperty('X-AGNT-Actor');
  });

  it('a member call with no instance key is refused, never sent as the owner', async () => {
    for (const name of ENV) delete process.env[name];
    Object.assign(process.env, { AGNT_TENANT_SLUG: 'genii', AGNT_TENANT_OWNER: 'owner-1' });
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { callService } = await import('./agntServices.js');
    await expect(callService('mail', '/inboxes', { actor: 'member-2' })).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
