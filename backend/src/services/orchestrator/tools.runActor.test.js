import { it, expect, vi, afterEach } from 'vitest';

// A teammate's agent run in a teamspace calls tools with context.userId = the workspace principal. Every
// identity check (membership, the owner's policy, memberIsolation) must judge the TEAMMATE, never the
// workspace, which resolves to the owner and is waved through.
const seen = vi.hoisted(() => ({ authority: [], gate: [] }));
vi.mock('../authorization/HostedToolAuthority.js', () => ({
  requireHostedToolAuthority: async (actorId, authorization) => { seen.authority.push({ actorId, authorization }); return null; },
}));
vi.mock('../security/nopeService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkAction: async (action) => { seen.gate.push(action); return { allowed: false, blockedRules: ['test-stop'], violations: [] }; },
}));
const { executeTool } = await import('./tools.js');
const { withScopeRequest } = await import('../authorization/ScopeRequestContext.js');
afterEach(() => { vi.unstubAllEnvs(); seen.authority.length = 0; seen.gate.length = 0; });

it("judges a teammate's teamspace tool call as the teammate", async () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  await withScopeRequest({}, { actorId: 'member-2', resourceOwnerId: 'scope:w' }, () =>
    executeTool('web_search', { query: 'x' }, 'Bearer member-token', { userId: 'scope:w' }));
  expect(seen.authority).toEqual([{ actorId: 'member-2', authorization: 'Bearer member-token' }]);
  expect(seen.gate.map((g) => g.userId)).toEqual(['member-2']);
});

it("the owner's own background work in a teamspace still acts as the workspace", async () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  await executeTool('web_search', { query: 'x' }, null, { userId: 'scope:w' });
  expect(seen.authority.map((a) => a.actorId)).toEqual(['scope:w']);
  expect(seen.gate.map((g) => g.userId)).toEqual(['scope:w']);
});
