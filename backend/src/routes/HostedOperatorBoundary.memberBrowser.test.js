import { it, expect, vi, afterEach } from 'vitest';

// Teammates now have their own browser; they may watch and steer it, but not the owner's sign-in window.
vi.mock('../services/security/toolRunAuthority.js', async (importOriginal) => ({ ...(await importOriginal()), hostedToolBoundaryRequired: () => true }));
const { createHostedOperatorBoundary } = await import('./HostedOperatorBoundary.js');
afterEach(() => vi.unstubAllEnvs());

async function asMember(method, path) {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  const cloud = { request: async () => [{ tenantSlug: 'bravo', role: 'member', id: 't' }], access: async () => ({}) };
  const boundary = createHostedOperatorBoundary((req, _res, next) => { req.user = { id: 'member-2' }; next(); }, cloud, (req, _res, next) => next());
  let passed = false; let status = 200;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  await boundary({ method, path, originalUrl: '/api' + path, headers: { authorization: 'Bearer m' } }, res, () => { passed = true; });
  return passed ? 'allowed' : status;
}

it('lets a teammate watch, steer and manage sign-ins of their own browser', async () => {
  for (const [method, path] of [['GET', '/browser-agent/view-capabilities'], ['POST', '/browser-agent/view'], ['GET', '/browser-agent/view/host:member-2'], ['DELETE', '/browser-agent/view/host:member-2'], ['POST', '/browser-agent/control'], ['GET', '/browser-agent/control/host:member-2'], ['GET', '/browser-agent/sites'], ['POST', '/browser-agent/sites/forget']]) {
    expect(await asMember(method, path), `${method} ${path}`).toBe('allowed');
  }
});

it("keeps the owner's desktop sign-in window and surface registration owner-only", async () => {
  for (const [method, path] of [['POST', '/browser-agent/signin/start'], ['POST', '/browser-agent/signin/window'], ['POST', '/browser-agent/surface']]) {
    expect(await asMember(method, path), `${method} ${path}`).toBe(403);
  }
});
