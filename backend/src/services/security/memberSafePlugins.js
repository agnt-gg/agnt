/**
 * memberSafePlugins — which plugin tools a non-owner member of a shared
 * instance may call.
 *
 * WHY A SEPARATE LIST AND NOT A toolCapabilities ENTRY
 * ----------------------------------------------------
 * A plugin tool has no entry in toolCapabilities, so NOPE scans every one of
 * its arguments and memberIsolation refuses it to members (fail-closed). Giving
 * plugin tools a capability profile would narrow NOPE's scanning for the owner
 * too. This list answers only the member question and changes nothing else.
 *
 * WHAT MAKES A PLUGIN MEMBER-SAFE
 * -------------------------------
 * Every condition is recorded by the installer, never claimed by the package:
 *   - trustTier 'official': AGNT first-party, set from the catalogue / server
 *     publisher identity (PluginInstaller), not forgeable from a manifest;
 *   - integrityState 'verified': the bytes on disk are the bytes published;
 *   - the static scan detected nothing beyond network access: no filesystem,
 *     spawn-process, env-access, dynamic-eval or dynamic-import. Those reach
 *     the instance's own files, keys or processes — the owner-only boundary.
 */

const SAFE_DETECTED = new Set(['network']);

/** @type {Set<string>} */
let safeToolNames = new Set();

/** Is this installer registry entry member-safe? */
export function isMemberSafePluginEntry(entry) {
  if (!entry || entry.trustTier !== 'official' || entry.integrityState !== 'verified' || entry.scanFailed) return false;
  const detected = entry.detectedCapabilities;
  const list = Array.isArray(detected) ? detected : detected && typeof detected === 'object' ? Object.keys(detected) : null;
  if (!list) return false; // never scanned: unknown is not safe
  return list.every((capability) => SAFE_DETECTED.has(capability));
}

/** A tool is called as its manifest type ('gmail-api') or its LLM name ('gmail_api'). */
function spellings(toolName) {
  const name = String(toolName || '').trim();
  return name ? [name, name.replace(/-/g, '_'), name.replace(/_/g, '-')] : [];
}

/** Replace the member-safe set. Called by PluginManager after every (re)load. */
export function setMemberSafePluginTools(toolNames) {
  const next = new Set();
  for (const toolName of toolNames || []) for (const spelling of spellings(toolName)) next.add(spelling);
  safeToolNames = next;
}

export function isMemberSafePluginTool(toolName) {
  return spellings(toolName).some((spelling) => safeToolNames.has(spelling));
}
