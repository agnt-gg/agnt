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
 *   HostedToolAuthority  direct tool calls only for the tenant owner or a
 *                        team owner/admin: an ADMIN could still run a shell.
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
 * a custom tool) could do anything, so a non-owner is refused it too. The
 * owner, and every single-user install, is unaffected.
 */
import { isRestrictedInstance, tenantOwnerId } from '../auth/tenantOwnership.js';
import { currentTeamExecution } from '../authorization/TeamExecutionContext.js';
import { resolveToolCapabilities } from './toolCapabilities.js';

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
  const id = typeof userId === 'string' ? userId.trim() : '';
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
  if (!profile) {
    return `${toolName} has no declared capabilities, so it could run code or read this instance's files; on a shared instance only its owner may use it.`;
  }
  const reached = profile.capabilities.filter((capability) => OWNER_ONLY.has(capability));
  if (reached.length === 0) return null;
  return `${toolName} can ${reached.join(', ')} on this instance, where the owner's keys and every account's credentials are stored; on a shared instance only its owner may use it.`;
}
