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
/** Every loaded plugin tool, safe or not: a refused plugin tool is the owner's call, not a guarantee. */
let pluginToolNames = new Set();

/** Is this installer registry entry member-safe? */
export function isMemberSafePluginEntry(entry) {
  if (!entry || entry.trustTier !== 'official' || entry.integrityState !== 'verified' || entry.scanFailed) return false;
  const detected = entry.detectedCapabilities;
  const list = Array.isArray(detected) ? detected : detected && typeof detected === 'object' ? Object.keys(detected) : null;
  if (!list) return false; // never scanned: unknown is not safe
  return list.every((capability) => SAFE_DETECTED.has(capability));
}

/**
 * May a member of a shared instance download this marketplace package?
 * The same bar as calling one (above), read from the server's OWN pre-install
 * inspection (PluginInstaller.inspectMarketplacePlugin), never from the listing:
 * official, bytes match the published hash, valid, and the scan found nothing
 * beyond network access. Returns null when allowed, else the reason.
 */
export function memberInstallRefusal(report) {
  if (!report || report.success === false) return 'It could not be checked right now.';
  if (report.trustTier !== 'official') return 'Only official AGNT plugins can be added by members.';
  if (report.integrityState !== 'verified') return 'Its download could not be verified against the published package.';
  if (!report.valid) return 'The package did not pass validation.';
  const detected = Object.keys(report.detected || {});
  const beyond = detected.filter((capability) => !SAFE_DETECTED.has(capability));
  if (beyond.length) return `It needs more than network access (${beyond.join(', ')}).`;
  return null;
}

/** A tool is called as its manifest type ('gmail-api') or its LLM name ('gmail_api'). */
function spellings(toolName) {
  const name = String(toolName || '').trim();
  return name ? [name, name.replace(/-/g, '_'), name.replace(/_/g, '-')] : [];
}

const spelled = (toolNames) => {
  const next = new Set();
  for (const toolName of toolNames || []) for (const spelling of spellings(toolName)) next.add(spelling);
  return next;
};

/**
 * Replace the member-safe set (and, when given, the set of all loaded plugin tools).
 * Called by PluginManager after every (re)load and every policy change.
 */
export function setMemberSafePluginTools(toolNames, allPluginToolNames = null) {
  safeToolNames = spelled(toolNames);
  if (allPluginToolNames) pluginToolNames = spelled(allPluginToolNames);
}

/** Is this a tool from an installed plugin (whether or not members may call it)? */
export function isPluginTool(toolName) {
  return spellings(toolName).some((spelling) => pluginToolNames.has(spelling) || safeToolNames.has(spelling));
}

export function isMemberSafePluginTool(toolName) {
  return spellings(toolName).some((spelling) => safeToolNames.has(spelling));
}
