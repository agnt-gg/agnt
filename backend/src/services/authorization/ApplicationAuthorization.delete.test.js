import { it, expect, vi, afterEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { get: (_s, _a, cb) => cb(null, null) } }));
vi.mock('../CloudTeamClient.js', () => ({ CloudTeamClient: class { async access() { return { role: 'owner' }; } } }));
const { teamResourcePolicy } = await import('./ApplicationAuthorization.js');
afterEach(() => vi.unstubAllEnvs());

// bravo smoke test, Nov 2026: a member could create and edit agents but every delete was
// "Team administrator required", so each test run left agents behind that only an admin could remove.
const scope = { id: 'workspace:w', team_id: 'team' };
const teams = (role) => ({ access: async () => ({ role }) });
const agent = { table: 'agents', id: 'agent-1' };
const createdBy = (who) => async (table, id) => (table === 'agents' && id === 'agent-1' ? who : null);
const remove = (actorId, role, creator, resource = agent) =>
  teamResourcePolicy({ actorId, scopeId: 'workspace:w' }, 'delete', scope, teams(role), resource, creator);
const hosted = () => { vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); };

it('a member deletes an agent they created', async () => {
  hosted();
  await expect(remove('member-2', 'member', createdBy('member-2'))).resolves.toBeUndefined();
});

it("a member may not delete a teammate's agent", async () => {
  hosted();
  await expect(remove('member-2', 'member', createdBy('member-3'))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/created this/) });
});

it('an agent with no recorded creator (made before creators were recorded) is owner/admin only', async () => {
  hosted();
  await expect(remove('member-2', 'member', createdBy(null))).rejects.toMatchObject({ status: 403 });
  await expect(remove('member-2', 'member', createdBy('member-2'), null)).rejects.toMatchObject({ status: 403 });
});

it('owners and admins delete anything in the workspace', async () => {
  hosted();
  await expect(remove('admin-4', 'admin', createdBy('member-3'))).resolves.toBeUndefined();
  await expect(remove('owner-1', 'owner', createdBy(null))).resolves.toBeUndefined();
});

it('a viewer deletes nothing, not even something recorded as theirs', async () => {
  hosted();
  await expect(remove('viewer-5', 'viewer', createdBy('viewer-5'))).rejects.toMatchObject({ status: 403 });
});

it('being the creator never crosses workspaces', async () => {
  hosted();
  await expect(teamResourcePolicy({ actorId: 'member-2', scopeId: 'workspace:other' }, 'delete', scope, teams('member'), agent, createdBy('member-2')))
    .rejects.toThrow(/Select the resource workspace/);
});

it('managing access stays owner/admin only, whoever created the resource', async () => {
  hosted();
  await expect(teamResourcePolicy({ actorId: 'member-2', scopeId: 'workspace:w' }, 'manage_access', scope, teams('member'), agent, createdBy('member-2')))
    .rejects.toMatchObject({ status: 403 });
});
