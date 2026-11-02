import { it, expect, vi, afterEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { get: (_s, _a, cb) => cb(null, null) } }));
vi.mock('../CloudTeamClient.js', () => ({ CloudTeamClient: class { async access() { return { role: 'owner' }; } } }));
const { teamResourcePolicy } = await import('./ApplicationAuthorization.js');
afterEach(() => vi.unstubAllEnvs());

// Reported 2026-10-08: on a Business instance every run of a shared agent was refused,
// for the owner too: "Shared execution requires a bound execution principal".
const scope = { id: 'workspace:w', team_id: 'team' };
const teams = (role) => ({ access: async () => ({ role }) });
const hosted = () => { vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); };

it('the instance owner runs a workspace resource', async () => {
  hosted();
  await expect(teamResourcePolicy({ actorId: 'owner-1', scopeId: 'workspace:w' }, 'run', scope, teams('owner'))).resolves.toBeUndefined();
});

it('a member still may not run without a published version, and is told who can publish', async () => {
  hosted();
  // Was a bare 403 "Shared execution requires a bound execution principal" here and a 409 on the
  // workflow path: one refusal, one code, and the next step for this role (bravo smoke test, Nov 2026).
  await expect(teamResourcePolicy({ actorId: 'member-2', scopeId: 'workspace:w' }, 'run', scope, teams('member')))
    .rejects.toMatchObject({ status: 409, code: 'publish_required', canPublish: false, message: expect.stringMatching(/owner or admin/) });
  await expect(teamResourcePolicy({ actorId: 'admin-3', scopeId: 'workspace:w' }, 'run', scope, teams('admin')))
    .rejects.toMatchObject({ status: 409, code: 'publish_required', canPublish: true });
});

it('the owner exemption covers running only, not the workspace check', async () => {
  hosted();
  await expect(teamResourcePolicy({ actorId: 'owner-1', scopeId: 'workspace:other' }, 'run', scope, teams('owner'))).rejects.toThrow(/Select the resource workspace/);
});
