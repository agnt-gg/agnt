import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  permissionForTool,
  teamPolicyRefusal,
  requireTeamWorkflowPermission,
  rememberPermissions,
  lastKnownPermissions,
  policyRefusalMessage,
} from './teamPolicy.js';
import { setMemberSafePluginTools } from '../security/memberSafePlugins.js';

const ENV = ['AGNT_TENANT_SLUG', 'AGNT_TENANT_OWNER', 'AGNT_TENANT_MEMBERS', 'AGNT_AUTH_MODE'];
const saved = {};
function businessTenant() {
  process.env.AGNT_TENANT_SLUG = 'bravo';
  process.env.AGNT_TENANT_OWNER = 'owner-1';
  process.env.AGNT_TENANT_MEMBERS = 'owner-1,member-2';
}
const allowed = (overrides = {}) => ({
  'workflows.build': true, 'workflows.run': true, 'automations.schedule': true,
  'triggers.external': true, 'code.run': true, 'extensions.use': true, ...overrides,
});

describe('teamPolicy', () => {
  beforeEach(() => { setMemberSafePluginTools([]); for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('maps tools to the owner setting that governs them', () => {
    expect(permissionForTool('update_workflow')).toBe('workflows.build');
    expect(permissionForTool('save_agent')).toBe('workflows.build');
    expect(permissionForTool('run_agent')).toBe('workflows.run');
    expect(permissionForTool('start_workflow')).toBe('workflows.run');
    expect(permissionForTool('sandbox_run')).toBe('code.run');
    expect(permissionForTool('mcp_client')).toBe('extensions.use');
    expect(permissionForTool('web_search')).toBeNull();
    setMemberSafePluginTools(['gmail-api']);
    expect(permissionForTool('gmail_api')).toBe('extensions.use');
  });

  it("refuses a member what the owner turned off, naming the setting and who controls it", () => {
    businessTenant();
    const refusal = teamPolicyRefusal('run_agent', 'member-2', allowed({ 'workflows.run': false }));
    expect(refusal.permission).toBe('workflows.run');
    expect(refusal.message).toMatch(/Run workflows and agents/);
    expect(refusal.message).toMatch(/owner/);
    expect(refusal.message).toMatch(/Settings → Members → Team permissions/);
  });

  it('allows a member what the owner allows', () => {
    businessTenant();
    expect(teamPolicyRefusal('run_agent', 'member-2', allowed())).toBeNull();
    expect(teamPolicyRefusal('sandbox_run', 'member-2', allowed())).toBeNull();
  });

  it('never restricts the owner, or anyone on a desktop install', () => {
    businessTenant();
    expect(teamPolicyRefusal('run_agent', 'owner-1', allowed({ 'workflows.run': false }))).toBeNull();
    delete process.env.AGNT_TENANT_SLUG;
    expect(teamPolicyRefusal('run_agent', 'member-2', allowed({ 'workflows.run': false }))).toBeNull();
  });

  it('with no permissions from the cloud (older api.agnt.gg) only the guarantees apply, as before', () => {
    businessTenant();
    expect(teamPolicyRefusal('run_agent', 'member-2', null)).toBeNull();
  });

  it('tools no setting governs are untouched by policy', () => {
    businessTenant();
    expect(teamPolicyRefusal('web_search', 'member-2', allowed({ 'workflows.run': false, 'code.run': false }))).toBeNull();
  });

  it('remembers the last permissions per member for turns that cannot ask the cloud', () => {
    rememberPermissions('member-2', allowed({ 'code.run': false }));
    expect(lastKnownPermissions('member-2')['code.run']).toBe(false);
    expect(lastKnownPermissions('someone-else')).toBeNull();
    rememberPermissions('member-2', null);
    expect(lastKnownPermissions('member-2')['code.run']).toBe(false, 'a missing answer never erases what is known');
  });
});

describe('requireTeamWorkflowPermission', () => {
  beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const timerWorkflow = { workflow_data: JSON.stringify({ nodes: [{ type: 'trigger-timer' }] }) };
  const webhookWorkflow = { workflow_data: JSON.stringify({ nodes: [{ type: 'webhook-listener' }] }) };
  function run(kind, { permissions, workflow = timerWorkflow, user = 'member-2', authorityError } = {}) {
    const middleware = requireTeamWorkflowPermission(kind, {
      authority: async () => { if (authorityError) throw authorityError; return permissions; },
      findWorkflow: async () => workflow,
      paidTriggersIn: (wf) => (wf.nodes || []).filter((n) => n.type === 'webhook-listener').map((n) => n.type),
      isAutonomous: (wf) => (wf.nodes || []).some((n) => n.type === 'trigger-timer' || n.type === 'webhook-listener'),
    });
    return new Promise((resolve) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
      middleware({ user: { userId: user }, params: { id: 'wf-1' }, headers: { authorization: 'Bearer member' } }, res, () => resolve({ status: 'next' }));
    });
  }

  it('lets a member save when the owner allows building', async () => {
    businessTenant();
    expect(await run('build', { permissions: allowed() })).toEqual({ status: 'next' });
  });

  it('refuses a member saving when the owner turned building off', async () => {
    businessTenant();
    const result = await run('build', { permissions: allowed({ 'workflows.build': false }) });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('team_policy_denied');
    expect(result.body.error).toBe(policyRefusalMessage('workflows.build'));
  });

  it('switching on a timed workflow needs "schedule" as well as "run"', async () => {
    businessTenant();
    expect((await run('activate', { permissions: allowed({ 'automations.schedule': false }) })).body.permission).toBe('automations.schedule');
    expect(await run('activate', { permissions: allowed() })).toEqual({ status: 'next' });
  });

  it('switching on a webhook workflow needs "outside triggers"', async () => {
    businessTenant();
    expect((await run('activate', { workflow: webhookWorkflow, permissions: allowed({ 'triggers.external': false }) })).body.permission).toBe('triggers.external');
  });

  it('the owner and desktop installs pass straight through', async () => {
    businessTenant();
    expect(await run('build', { user: 'owner-1', permissions: allowed({ 'workflows.build': false }) })).toEqual({ status: 'next' });
    delete process.env.AGNT_TENANT_SLUG;
    expect(await run('build', { permissions: allowed({ 'workflows.build': false }) })).toEqual({ status: 'next' });
  });

  it('when membership cannot be confirmed, the member is refused rather than waved through', async () => {
    businessTenant();
    const result = await run('build', { authorityError: Object.assign(new Error("You are not a member of this instance's team"), { status: 403 }) });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('team_access_unconfirmed');
  });
});
