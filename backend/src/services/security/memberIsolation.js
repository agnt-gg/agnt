/**
 * memberIsolation — on a shared instance, a member who is not the owner may
 * not run code or touch the instance's own files or database.
 *
 * WHY
 * ---
 * A Business instance admits a team. Every tool runs inside the one AGNT
 * process, as the one OS user that owns everything the instance holds:
 *
 *   secrets/            ENCRYPTION_KEY, which decrypts every stored credential
 *   agnt.db             every account's connected apps, keys and history
 *   the process env     the instance key and session secrets
 *
 * Any shell command, code cell or file read run for a non-owner therefore
 * reaches the owner's keys as easily as its own: file modes inside one process
 * cannot tell two of its users apart. What already existed did not close it:
 *
 *   HostedToolAuthority  only checks that the caller is still a member of
 *                        this instance's team; what they may run is decided
 *                        here, per tool, for members and admins alike.
 *   workflows            a member's own workflow never passed that check, so
 *                        its code and database nodes ran unchecked.
 *
 * So the boundary is here, at the gate every tool call and workflow node
 * already passes through: for anyone but the owner, whatever can execute,
 * read or write the instance's storage, or query its database is refused.
 * Chat, agents, web, memory, email, images and every other declared no-sink
 * or network tool keep working.
 *
 * NOT AFFECTED: owner-approved shared runs (TeamExecutionContext). Those are
 * already limited to the tools and nodes the owner allowlisted for that run;
 * a capability the owner granted there is the owner's decision.
 *
 * FAIL-CLOSED. A tool with no declared capabilities (a plugin, an MCP server,
 * a custom tool) could do anything, so a non-owner is refused it too. The one
 * exception is a plugin the installer recorded as official, integrity-verified
 * and scanned clean of file, process, env and dynamic-code access
 * (memberSafePlugins.js). The owner, and every single-user install, is
 * unaffected.
 */
import { isRestrictedInstance, tenantOwnerId, credentialUserId } from '../auth/tenantOwnership.js';
import { currentTeamExecution } from '../authorization/TeamExecutionContext.js';
import { resolveToolCapabilities } from './toolCapabilities.js';
import { isMemberSafePluginTool, isPluginTool } from './memberSafePlugins.js';
import { hostedToolBoundaryRequired } from './toolRunAuthority.js';

/**
 * On a hosted instance every tool process runs in the kernel sandbox (scripts/agnt-tool-run.py through
 * toolProcess.js): its own user, pid and network namespaces, seccomp, no capabilities, a scrubbed env,
 * filtered egress, and a mount namespace holding only the runtime and the workspace. The database,
 * secrets and credential store are not in it, and toolProcess refuses to run anything if the sandbox is
 * missing. Code a member runs there cannot reach anyone's keys, so refusing it only broke members.
 * File tools (fs-read/fs-write) and SQL still run inside the server process, so they stay owner-only.
 */
const SANDBOXED_CAPABILITIES = new Set(['shell', 'code-eval']);
/**
 * Tools with no capability profile whose every process goes through the same sandbox. Empty on purpose:
 * the launched browser is ONE per instance and keeps the owner's signed-in sites (shared cookies by
 * design, see browserLanes.js). Sandboxing its process does not stop a member's tab from using the
 * owner's sessions, so it stays owner-only until each account gets its own browser.
 */
const SANDBOXED_TOOLS = new Set();
const sandboxed = () => hostedToolBoundaryRequired();

export const MEMBER_ISOLATION_RULE = 'member-isolation';

/** Capabilities that reach the instance's own code, files or database. */
const OWNER_ONLY = new Set(['shell', 'code-eval', 'fs-read', 'fs-write', 'sql']);

/**
 * Is this caller a member of a shared instance who is NOT its owner?
 *
 * False on a desktop install (one user), with no caller id (internal work,
 * which runs as the instance), and when the owner is not named by account id:
 * then the owner cannot be told apart, and refusing would lock them out.
 */
export function isNonOwnerMember(userId) {
  if (!isRestrictedInstance()) return false;
  const owner = tenantOwnerId();
  // The team workspace principal acts for the owner; it is not a member.
  const id = typeof userId === 'string' ? credentialUserId(userId.trim()) : '';
  if (!owner || owner.includes('@') || !id) return false;
  return id !== owner;
}

/**
 * Why this call is refused for this caller, or null when it may proceed.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {string} [userId]
 * @returns {string|null}
 */
export function memberRefusal(toolName, args, userId) {
  if (!isNonOwnerMember(userId)) return null;
  if (currentTeamExecution()) return null; // owner-approved and allowlisted; see above
  const profile = resolveToolCapabilities(toolName, args || {});
  // Every refusal says plainly that this is a guarantee, not a setting: an
  // unexplained "blocked by security policy" sent members (and the assistant)
  // looking for a setting that does not exist.
  if (!profile) {
    if (isMemberSafePluginTool(toolName)) return null;
    if (sandboxed() && SANDBOXED_TOOLS.has(toolName)) return null;
    // A plugin is the owner's decision, not a guarantee: say who can turn it on and how.
    if (isPluginTool(toolName)) return PLUGIN_NOT_APPROVED(toolName);
    return `${toolName} has no declared capabilities, so it is not verified safe to run next to the credentials stored on this shared instance. ${GUARANTEE}`;
  }
  const reached = profile.capabilities.filter((capability) => OWNER_ONLY.has(capability) && !(sandboxed() && SANDBOXED_CAPABILITIES.has(capability)));
  if (reached.length === 0) return null;
  const runsCode = reached.some((capability) => capability === 'shell' || capability === 'code-eval');
  return runsCode
    ? `${toolName} would run code inside this shared instance, next to everyone's stored credentials. ${GUARANTEE} Run code in the secure cloud sandbox instead (sandbox_run).`
    : `${toolName} would read or change this shared instance's own files or database, where everyone's credentials are stored. ${GUARANTEE}`;
}

export const PLUGIN_NOT_APPROVED = (toolName) => `${toolName} comes from a plugin the instance owner has not approved for team members yet. Ask the owner to approve it: they can approve your request for it, or allow it in Settings > Plugins. Once approved, you can use it.`;

export const GUARANTEE = 'Team members never can: this is an AGNT safety guarantee, not a setting, and nobody can switch it off. The instance owner can still do it themselves.';
