/**
 * teamPolicy — what the team's owner allows a member to do on this instance.
 *
 * The owner decides policy per team (api.agnt.gg TeamPolicyService). The
 * cloud computes each member's effective permissions and returns them with
 * the membership check this instance already makes on every member tool call
 * (HostedToolAuthority -> GET /teams/:id/access), so an owner's change applies
 * on the next call and this file never re-implements the rules.
 *
 * Two layers, deliberately separate:
 *   policy      (here)               what the OWNER allows. A setting.
 *   guarantees  (memberIsolation.js) what AGNT never allows, whatever the
 *                                    owner sets: nobody's code, shell, files
 *                                    or SQL reaches the keys this process holds.
 * A call must pass both. This layer is checked first so a refusal names the
 * owner's setting when that is the reason.
 */
import { isNonOwnerMember } from '../security/memberIsolation.js';
import { isMemberSafePluginTool, isPluginTool } from '../security/memberSafePlugins.js';

/** The owner's setting each permission appears as, for refusals. */
export const PERMISSION_LABELS = Object.freeze({
  'workflows.build': 'Create and edit workflows and agents',
  'workflows.run': 'Run workflows and agents',
  'automations.schedule': 'Schedule automations',
  'triggers.external': 'Start workflows from webhooks and email',
  'code.run': 'Run code',
  'extensions.use': 'Use plugins and extensions',
});

const TOOL_PERMISSIONS = Object.freeze({
  update_workflow: 'workflows.build',
  revert_workflow: 'workflows.build',
  create_checkpoint: 'workflows.build',
  generate_agent: 'workflows.build',
  modify_agent: 'workflows.build',
  save_agent: 'workflows.build',
  delete_agent: 'workflows.build',
  start_workflow: 'workflows.run',
  stop_workflow: 'workflows.run',
  run_agent: 'workflows.run',
  // Members run code in the disposable cloud sandbox; in-process code stays
  // owner-only (a guarantee, memberIsolation) until the isolated runner ships.
  sandbox_run: 'code.run',
  mcp_client: 'extensions.use',
  custom_api: 'extensions.use',
  execute_custom_agnt_tool: 'extensions.use',
});

/** Which owner setting governs this tool, or null when none does. */
export function permissionForTool(toolName) {
  if (TOOL_PERMISSIONS[toolName]) return TOOL_PERMISSIONS[toolName];
  // Any plugin or MCP tool: it runs sandboxed for a teammate (pluginSandbox, toolProcess), and whether
  // teammates may use extensions at all is the owner's setting.
  if (isMemberSafePluginTool(toolName) || isPluginTool(toolName) || String(toolName).startsWith('mcp__')) return 'extensions.use';
  return null;
}

/** The refusal a member sees: which setting, and who can change it. */
export function policyRefusalMessage(permission) {
  const label = PERMISSION_LABELS[permission] || permission;
  return `Your team's owner has turned off "${label}" for you. Only they can change it, in Settings → Members → Team permissions.`;
}

/**
 * Last permissions the cloud returned per member. Used only for turns that
 * cannot ask the cloud themselves (a text answered as the member with a
 * turn-scoped token), so the owner's rules still apply there. In memory only:
 * a restart forgets, and the member's next ordinary call refreshes it.
 */
const lastKnown = new Map();
export function rememberPermissions(userId, permissions) {
  if (userId && permissions && typeof permissions === 'object') lastKnown.set(userId, permissions);
}
export function lastKnownPermissions(userId) { return lastKnown.get(userId) || null; }

/**
 * Why the owner's policy refuses this call, or null when it may proceed.
 *
 * @param {string} toolName
 * @param {string} userId the caller
 * @param {object|null} permissions effective permissions from the cloud;
 *   null when this cloud does not send them yet (older api.agnt.gg) — then
 *   only AGNT's guarantees apply, exactly as before policies existed.
 */
export function teamPolicyRefusal(toolName, userId, permissions) {
  if (!isNonOwnerMember(userId)) return null;
  const permission = permissionForTool(toolName);
  if (!permission || !permissions) return null;
  return permissions[permission] === false ? { permission, message: policyRefusalMessage(permission) } : null;
}

/** Owner settings that decide whether this workflow may be switched on, in order. */
export function workflowPermissionsNeeded(workflow, { paidTriggers, isAutonomous }) {
  const needed = ['workflows.run'];
  if (isAutonomous(workflow)) needed.push('automations.schedule');
  if (paidTriggers(workflow).length) needed.push('triggers.external');
  return needed;
}

function parseWorkflow(row) {
  try { return JSON.parse(row?.workflow_data || '{}'); } catch { return {}; }
}

/**
 * Express middleware for the workflow API, so the owner's rules hold whether a
 * member uses the canvas or the assistant. 'build' guards save/edit/delete;
 * 'activate' guards switching a workflow on (run, plus schedule and outside
 * triggers when the workflow uses them).
 *
 * Dependencies are injectable for tests; production uses the real ones.
 */
export function requireTeamWorkflowPermission(kind, deps = {}) {
  return async (req, res, next) => {
    try {
      if (!process.env.AGNT_TENANT_SLUG) return next();
      const userId = req.user?.userId || req.user?.id;
      if (!isNonOwnerMember(userId)) return next();
      const authority = deps.authority || (await import('./HostedToolAuthority.js')).requireHostedToolAuthority;
      const permissions = await authority(userId, req.headers.authorization);
      if (!permissions) return next();
      let needed = ['workflows.build'];
      if (kind === 'activate') {
        const findWorkflow = deps.findWorkflow || (async (id) => (await import('../../models/WorkflowModel.js')).default.findOne(id));
        const paidTriggers = deps.paidTriggersIn || (await import('../../workflow/workflowAdmission.js')).paidTriggersIn;
        const isAutonomous = deps.isAutonomous || (await import('../auth/planLimits.js')).isAutonomous;
        needed = workflowPermissionsNeeded(parseWorkflow(await findWorkflow(req.params.id)), { paidTriggers, isAutonomous });
      }
      const missing = needed.find((permission) => permissions[permission] === false);
      if (!missing) return next();
      return res.status(403).json({ error: policyRefusalMessage(missing), code: 'team_policy_denied', permission: missing });
    } catch (error) {
      // Membership could not be confirmed: refuse, as HostedToolAuthority does for tools.
      return res.status(error.status || 403).json({ error: error.message || 'Team access could not be confirmed', code: 'team_access_unconfirmed' });
    }
  };
}
