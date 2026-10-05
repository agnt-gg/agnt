/**
 * apps — the installed plugins as the Apps page needs them.
 *
 * tools/installedPlugins is derived from tool rows and drops each tool's
 * schema, so it cannot say which sign-in a plugin uses. /plugins/installed
 * carries `tools[].schema.authProvider`, which is what lets services/appCards
 * fold every plugin that shares a sign-in into one card. /plugins/marketplace
 * supplies the plugins that sign-in could also turn on.
 *
 * Not user-scoped: plugins are installed on this computer, not into an account.
 * Both lists are read-only views of existing endpoints; installing goes through
 * marketplace/installPlugin so there is still exactly one install path.
 */
import { API_CONFIG } from '@/tt.config.js';

const STALE_MS = 60 * 1000;

async function getJson(path) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export default {
  namespaced: true,
  state: () => ({
    installed: [],
    available: [],
    installedAt: 0,
    availableAt: 0,
    error: null,
    availableError: null,
  }),
  mutations: {
    SET_INSTALLED(state, plugins) {
      state.installed = Array.isArray(plugins) ? plugins : [];
      state.installedAt = Date.now();
    },
    SET_AVAILABLE(state, plugins) {
      state.available = Array.isArray(plugins) ? plugins : [];
      state.availableAt = Date.now();
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    SET_AVAILABLE_ERROR(state, error) {
      state.availableError = error;
    },
  },
  actions: {
    async fetchInstalled({ state, commit }, { force = false } = {}) {
      if (!force && state.installedAt && Date.now() - state.installedAt < STALE_MS) return state.installed;
      try {
        const data = await getJson('/plugins/installed');
        if (!data.success || !Array.isArray(data.plugins)) throw new Error(data.error || 'Invalid installed plugin response');
        commit('SET_INSTALLED', data.plugins);
        commit('SET_ERROR', null);
      } catch (error) {
        // Keep the last good list: an empty Apps page would read as "everything was uninstalled".
        console.error('[apps] could not load installed plugins:', error);
        commit('SET_ERROR', error.message || String(error));
      }
      return state.installed;
    },
    async fetchAvailable({ state, commit }, { force = false } = {}) {
      if (!force && state.availableAt && Date.now() - state.availableAt < STALE_MS) return state.available;
      try {
        const data = await getJson('/plugins/marketplace');
        if (!data.success || !Array.isArray(data.plugins)) throw new Error(data.error || 'Invalid marketplace response');
        commit('SET_AVAILABLE', data.plugins);
        commit('SET_AVAILABLE_ERROR', null);
      } catch (error) {
        // Preserve cached packages, but do not present a failed catalog as an empty one.
        console.warn('[apps] could not load the plugin marketplace:', error);
        commit('SET_AVAILABLE_ERROR', error.message || String(error));
      }
      return state.available;
    },
    /**
     * Install several plugins ("Add all Google apps"). Sequential on purpose:
     * each install unpacks into the same plugins folder, and the backend
     * serialises them anyway. One tools refresh at the end, not one per plugin.
     * Returns the names that failed so the caller can say which.
     */
    async installMany({ dispatch }, names = []) {
      const failed = [];
      for (const pluginName of names) {
        try {
          await dispatch('marketplace/installPlugin', { pluginName, skipRefresh: true }, { root: true });
        } catch (error) {
          console.error(`[apps] install failed for ${pluginName}:`, error);
          failed.push(pluginName);
        }
      }
      await dispatch('tools/refreshAllTools', null, { root: true }).catch(() => {});
      await dispatch('fetchInstalled', { force: true });
      return { failed };
    },
  },
  getters: {
    installed: (state) => state.installed,
    available: (state) => state.available,
  },
};
