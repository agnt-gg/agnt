import { reactive, readonly } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Plugin install requests and the owner's install policy, client side
 * (backend: plugins/pluginRequestRoutes.js). One cache for Home's "Needs you",
 * the Apps page and Settings, so a decision anywhere shows everywhere.
 */
const state = reactive({ loaded: false, canDecide: false, pending: [], mine: [], policy: null, features: [], canEdit: false, hosted: false });

async function request(path, options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + '/plugins' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw Object.assign(new Error(body.error || 'Plugin request failed'), { status: response.status, code: body.code });
  return body;
}

async function load() {
  try {
    const body = await request('/requests');
    Object.assign(state, { canDecide: !!body.canDecide, pending: body.pending || [], mine: body.mine || [], loaded: true });
  } catch (error) {
    // A desktop without requests, or the server offline: nothing to show, never an error on Home.
    console.warn('[plugin requests] load:', error.message);
    state.loaded = true;
  }
}
async function loadPolicy() {
  const body = await request('/install-policy');
  Object.assign(state, { policy: body.policy, features: body.features || [], canEdit: !!body.canEdit, hosted: !!body.hosted, canDecide: !!body.canDecide });
  return body.policy;
}

export function usePluginRequests() {
  return {
    state: readonly(state),
    load,
    loadPolicy,
    async approve(id) { const body = await request(`/requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }); await load(); return body; },
    async decline(id) { const body = await request(`/requests/${encodeURIComponent(id)}/decline`, { method: 'POST', body: '{}' }); await load(); return body; },
    async seen(id) { await request(`/requests/${encodeURIComponent(id)}/seen`, { method: 'POST', body: '{}' }); state.mine = state.mine.filter((r) => r.id !== id); },
    /** Marketplace plugins, by name, for the owner's pre-approve picker. */
    async catalog() {
      const body = await request('/marketplace');
      return (body.plugins || []).filter((p) => p?.name).sort((a, b) => String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)));
    },
    async setPolicy(patch) { const body = await request('/install-policy', { method: 'PUT', body: JSON.stringify(patch) }); state.policy = body.policy; return body.policy; },
  };
}

/** What a plugin can reach, in words, for the owner's decision. From the server's own scan. */
const REACH = Object.freeze({
  network: 'the internet', filesystem: 'this instance’s files', 'env-access': 'this instance’s settings and keys',
  'spawn-process': 'run programs on this instance', 'dynamic-eval': 'run code it builds at runtime', 'dynamic-import': 'load code at runtime',
});
export function reachLabel(capabilities = []) {
  const words = capabilities.map((c) => REACH[c] || c);
  return words.length ? words.join(', ') : 'nothing beyond its own code';
}
/** Needs attention: an open request you decide, or your decided request not yet dismissed. */
export const requestNeeds = (s) => (s.canDecide ? s.pending.length : 0) + s.mine.filter((r) => r.status !== 'pending').length;

/** For tests. */
export function _resetPluginRequests() { Object.assign(state, { loaded: false, canDecide: false, pending: [], mine: [], policy: null, features: [], canEdit: false, hosted: false }); }
