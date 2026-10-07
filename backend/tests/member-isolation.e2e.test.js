/**
 * Member isolation through the REAL chokepoint (executeTool: HostedToolAuthority
 * then checkAction), with no mock of either gate. Harmless payload only: an
 * echo with a marker.
 *
 * The case that was open: a team ADMIN who is not the instance owner. The
 * hosted-authority check admits admins to direct tool calls, so before this a
 * shell call from them ran with the owner's keys in reach. Only the cloud team
 * lookup is stubbed, to say "admin".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import './nope-test-environment.js';

vi.mock('../src/services/CloudTeamClient.js', () => ({
  CloudTeamClient: class {
    async request() { return [{ id: 'team-1', tenantSlug: 'bravo', role: 'admin' }]; }
    async access() { return { ok: true }; }
  },
}));

const MARKER = 'MEMBER-ISOLATION-PROOF-5c1e';
const ENV = { AGNT_TENANT_SLUG: 'bravo', AGNT_TENANT_OWNER: 'owner-1', AGNT_TENANT_MEMBERS: 'owner-1,admin-2' };
const saved = {};

describe('member isolation, end to end', () => {
  beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("a team admin's shell command (not the owner) is refused and never runs", async () => {
    const { executeTool } = await import('../src/services/orchestrator/tools.js');
    const parsed = JSON.parse(await executeTool('execute_shell_command', { command: `echo ${MARKER}` }, 'Bearer admin-token', { userId: 'admin-2', role: 'user' }));
    expect(parsed.policy_blocked).toBe(true);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('member-isolation');
    expect(parsed.stdout).toBeUndefined();
  }, 30_000);

  it("the same admin keeps tools that cannot reach the instance's storage", async () => {
    const { checkAction } = await import('../src/services/security/nopeService.js');
    const gate = await checkAction({ toolName: 'web_search', args: { query: 'weather' }, userId: 'admin-2', role: 'user', surface: 'orchestrator' });
    expect(gate.allowed).toBe(true);
  });

  it("a member's workflow code node is refused at the same gate", async () => {
    const { checkAction } = await import('../src/services/security/nopeService.js');
    const gate = await checkAction({ toolName: 'execute-javascript', args: { code: '1' }, userId: 'admin-2', role: 'workflow', surface: 'workflow' });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedRules).toEqual(['member-isolation']);
  });

  it("the owner's identical shell command runs", async () => {
    const { executeTool } = await import('../src/services/orchestrator/tools.js');
    const parsed = JSON.parse(await executeTool('execute_shell_command', { command: `echo ${MARKER}` }, null, { userId: 'owner-1', role: 'user' }));
    expect(parsed.policy_blocked).toBeUndefined();
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain(MARKER);
  }, 30_000);
});
