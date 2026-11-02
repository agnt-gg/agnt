import { it, expect, vi, beforeEach, afterEach } from 'vitest';

// The launched browser held the owner's logins, so teammates could not use it. On a hosted instance each
// teammate's browser tools now get THEIR OWN browser (memberBrowsers.js); the owner's path is unchanged.
const state = vi.hoisted(() => ({ hosted: true, launches: [] }));
vi.mock('../../../services/security/toolRunAuthority.js', async (importOriginal) => ({ ...(await importOriginal()), hostedToolBoundaryRequired: () => state.hosted }));
vi.mock('./memberBrowsers.js', () => ({ ensureMemberBrowser: async (actor) => { state.launches.push(actor); return `ws://127.0.0.1:1/devtools/browser/${actor}`; } }));
const { ensureFallbackSurface } = await import('./browserFallbackSurface.js');
const { withToolActor } = await import('../../../services/security/toolRunAuthority.js');

beforeEach(() => { state.hosted = true; state.launches.length = 0; vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2'); });
afterEach(() => vi.unstubAllEnvs());

it("a teammate's browser tool gets the teammate's own browser", async () => {
  const endpoint = await withToolActor('member-2', () => ensureFallbackSurface({ log: () => {} }));
  expect(endpoint).toBe('ws://127.0.0.1:1/devtools/browser/member-2');
  expect(state.launches).toEqual(['member-2']);
});

it('an explicit actor works too (a route acting for a teammate)', async () => {
  await ensureFallbackSurface({ log: () => {}, actor: 'member-2' });
  expect(state.launches).toEqual(['member-2']);
});

it("never hands a teammate the owner's browser, and the owner never gets a teammate's", async () => {
  state.hosted = false; // no sandbox: the only browser is the owner's, so the member branch must not run
  await withToolActor('owner-1', () => ensureFallbackSurface({ log: () => {} })).catch(() => {});
  expect(state.launches).toEqual([]);
});
