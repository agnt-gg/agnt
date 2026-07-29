/**
 * pluginPermissions — what a locally-installed plugin was actually granted.
 *
 * `effectivePermissions` (shared validate-core) answers "what is this package
 * held to". This module answers the local-registry half: "what did this user
 * already agree to", which is the other operand of the update consent gate.
 */

/**
 * The permission set an installed plugin already holds.
 *
 * WHY THIS IS A UNION AND NOT JUST `grantedPermissions`
 * ----------------------------------------------------
 * Registry entries written before permissions were derived stored only the
 * author's declaration in `grantedPermissions` — `[]` for 17 of the 18
 * published plugins — while recording the scan result separately in
 * `detectedCapabilities`. Reading `grantedPermissions` alone would make every
 * one of those look like a brand-new permission request on its very next
 * update, firing a re-consent prompt for capabilities the install-consent
 * modal had already listed (with file:line evidence) and the user had already
 * accepted.
 *
 * Unioning them is not a shortcut around consent; it is a faithful record of
 * what the user was shown and approved. It also means no migration: an entry
 * heals the first time it is read, and once `grantedPermissions` is written by
 * the derived path the union is a no-op.
 *
 * The gate stays sharp because it fires on capabilities that are new relative
 * to this set — which is exactly the escalation it exists to catch.
 *
 * @param {object|null} entry registry entry for an installed plugin
 * @returns {string[]} sorted permission identifiers
 */
export function grantedPermissionsForEntry(entry) {
  const granted = new Set();
  if (Array.isArray(entry?.grantedPermissions)) {
    for (const permission of entry.grantedPermissions) {
      if (typeof permission === 'string' && permission.trim()) granted.add(permission.trim());
    }
  }
  // detectedCapabilities has been written as an array by stagedInstall since
  // the trust work landed; tolerate the object form defensively because
  // rebuildRegistry has historically reconstructed entries from disk.
  const detected = entry?.detectedCapabilities;
  const detectedList = Array.isArray(detected) ? detected : detected && typeof detected === 'object' ? Object.keys(detected) : [];
  for (const capability of detectedList) {
    if (typeof capability === 'string' && capability.trim()) granted.add(capability.trim());
  }
  return [...granted].sort();
}

/**
 * Capabilities an update introduces that the user has not already accepted.
 * Sorted so the consent prompt is stable between runs.
 */
export function newlyRequestedPermissions(requested, granted) {
  const held = new Set(granted || []);
  return [...new Set((requested || []).filter((permission) => !held.has(permission)))].sort();
}

export default { grantedPermissionsForEntry, newlyRequestedPermissions };
