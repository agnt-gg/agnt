import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A hosted instance names itself on every service call; a desktop does not.
 *
 * The services record how far each INSTANCE has read, and the fleet wakes a
 * sleeping instance only for events newer than that. A desktop sharing the
 * same account must therefore never be mistaken for the instance - it sends
 * no header at all.
 */
vi.mock('./auth/sessionTokenCache.js', () => ({ authHeader: () => ({ Authorization: 'Bearer t' }), getSessionToken: () => 't' }));
vi.mock('./auth/planEntitlements.js', () => ({ hasFeature: async () => true, isEnforcing: () => false }));
vi.mock('./auth/planDenial.js', () => ({ planDenialMessageFor: () => 'upgrade' }));

const ok = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' });

async function headersSentWith(slug) {
  if (slug === undefined) delete process.env.AGNT_TENANT_SLUG;
  else process.env.AGNT_TENANT_SLUG = slug;
  const fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  const { callService } = await import('./agntServices.js');
  await callService('webhooks', '/endpoints/e1/events', { query: { after: 5 } });
  return fetchMock.mock.calls[0][1].headers;
}

describe('callService identifies a hosted instance', () => {
  const saved = process.env.AGNT_TENANT_SLUG;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.AGNT_TENANT_SLUG;
    else process.env.AGNT_TENANT_SLUG = saved;
  });

  it('sends X-AGNT-Instance on a hosted instance', async () => {
    expect((await headersSentWith('charlie'))['X-AGNT-Instance']).toBe('charlie');
  });

  it('sends nothing from a desktop', async () => {
    expect(await headersSentWith(undefined)).not.toHaveProperty('X-AGNT-Instance');
  });

  it('never forwards a malformed slug', async () => {
    expect(await headersSentWith('Bad Slug\r\nX: y')).not.toHaveProperty('X-AGNT-Instance');
  });
});
