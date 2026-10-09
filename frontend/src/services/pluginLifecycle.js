/**
 * pluginLifecycle — the Plugins page's calls to /api/plugins, in one place.
 *
 * Installing still goes through marketplace/installPlugin (the one install
 * path). These are the reads and mutations around it: inspect before install,
 * an installed plugin's assets, the update pass and its consent gate, the
 * update policy and uninstall. Every call goes through apiFetch so it carries
 * the session (see __guards__/apiAuthContract.spec.js).
 *
 * Each function returns the server's answer or throws an Error whose message
 * is safe to show; nothing here swallows a failure silently.
 */
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';

const name = (pluginName) => encodeURIComponent(String(pluginName || ''));

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/** The package scan shown before consent. Throws when the server cannot inspect it. */
export async function inspectPlugin(pluginName) {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/inspect/${name(pluginName)}`);
  const report = await readJson(response);
  if (!response.ok) throw new Error(report.error || 'Unable to inspect this package. Please retry.');
  return report;
}

/** The agents, widgets, skills and workflows an installed plugin put into AGNT, with their local ids. */
export async function fetchPluginAssets(pluginName) {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/${name(pluginName)}/assets`);
  const result = await readJson(response);
  if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load installed contents.');
  return Array.isArray(result.assets) ? result.assets : [];
}

/**
 * The last background update pass. Absence is not an error — no pass has run,
 * or the server predates the endpoint — so this returns null instead of throwing.
 */
export async function fetchUpdateStatus() {
  try {
    const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-status`);
    if (!response.ok) return null;
    const data = await readJson(response);
    return data.success ? data.status || null : null;
  } catch (error) {
    console.warn('[pluginLifecycle] update status unavailable:', error.message);
    return null;
  }
}

/**
 * Update one plugin. Without consent the server answers
 * { requiresConsent, permissionDiff } and changes nothing on disk; call again
 * with acceptedPermissions after the person agrees to the added access.
 */
export async function requestUpdate(pluginName, { acceptedPermissions = false } = {}) {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update/${name(pluginName)}`, {
    method: 'POST',
    body: JSON.stringify({ acceptedPermissions }),
  });
  const data = await readJson(response);
  if (data.requiresConsent) return data;
  if (!response.ok || !data.success) throw new Error(data.error || 'Update failed. Please retry.');
  return data;
}

/** 'auto' (the default: updates apply themselves unless they ask for new access) or 'pinned'. */
export async function setUpdatePolicy(pluginName, policy) {
  if (!['auto', 'pinned'].includes(policy)) throw new Error(`Unknown update policy: ${policy}`);
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update-policy/${name(pluginName)}`, {
    method: 'POST',
    body: JSON.stringify({ policy }),
  });
  const data = await readJson(response);
  if (!response.ok || !data.success) throw new Error(data.error || 'Could not change the update setting.');
  return data;
}

/**
 * Uninstall. 'clean' (the server default) keeps assets the person edited as
 * their own; nothing they changed is deleted.
 */
export async function uninstallPlugin(pluginName, mode = 'clean') {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/${name(pluginName)}?mode=${encodeURIComponent(mode)}`, { method: 'DELETE' });
  const data = await readJson(response);
  if (!response.ok || !data.success) throw new Error(data.error || 'Uninstall failed. Please retry.');
  return data;
}
