import { API_CONFIG } from '@/tt.config.js';
import { registerCustomWidget, unregisterWidget } from '@/canvas/widgetRegistry.js';
import CustomWidgetRenderer from '@/canvas/CustomWidgetRenderer.vue';

function syncToRegistry(definition) {
  registerCustomWidget(definition, CustomWidgetRenderer);
}

function removeFromRegistry(id) {
  unregisterWidget(id);
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

// In-flight detail fetches, keyed by widget id. Used to coalesce concurrent
// callers (e.g. two widgets of the same id mounting at once) onto a single
// network request so we don't hammer the backend.
const _pendingDetailLoads = new Map();

const state = {
  definitions: [],
  isLoaded: false,
  isLoading: false,
  activeDefinitionId: null,
  forgeResetKey: 0,
  pendingFormPrefill: null,
};

const getters = {
  allDefinitions: (state) => state.definitions,
  isLoaded: (state) => state.isLoaded,
  isLoading: (state) => state.isLoading,
  activeDefinition: (state) => state.definitions.find((d) => d.id === state.activeDefinitionId) || null,
  forgeResetKey: (state) => state.forgeResetKey,
  pendingFormPrefill: (state) => state.pendingFormPrefill,
  getDefinitionById: (state) => (id) => state.definitions.find((d) => d.id === id) || null,

  definitionsByCategory: (state) => (category) => {
    if (!category || category === 'all') return state.definitions;
    return state.definitions.filter((d) => d.category === category);
  },

  categories: (state) => {
    const cats = new Set();
    for (const d of state.definitions) {
      cats.add(d.category || 'custom');
    }
    return Array.from(cats);
  },
};

const mutations = {
  SET_DEFINITIONS(state, definitions) {
    // DO NOT replace hydrated rows with de-hydrated ones.
    //
    // GET /widget-definitions deliberately strips `source_code`
    // (WidgetDefinitionService.getAllWidgets) to keep this store flat. A plain
    // wholesale replace therefore DE-HYDRATES every definition that had
    // already been loaded — and CustomWidgetRenderer reads its source from
    // here, so the instant anything re-fetches the catalog, every mounted
    // custom widget renders a blank iframe. It never recovers on its own,
    // because ensureDefinitionLoaded is dispatched once from setup() and
    // nothing re-triggers it.
    //
    // That is why opening a widget picker "crashed" live widgets: the picker
    // refreshes the catalog, and the refresh silently emptied them.
    //
    // Carry forward source we ALREADY hold, but only when the row is unchanged
    // (`updated_at` identical) — a stale body is worse than a re-fetch. Memory
    // stays flat: nothing new is retained, only what was already resident.
    const prior = new Map();
    for (const d of state.definitions) {
      if (d && d.id && 'source_code' in d) prior.set(d.id, d);
    }

    state.definitions = definitions.map((def) => {
      if (!def || 'source_code' in def) return def;
      const held = prior.get(def.id);
      if (held && held.updated_at === def.updated_at) {
        return { ...def, source_code: held.source_code };
      }
      return def;
    });

    // Sync all definitions to the widget registry so catalog picks them up
    for (const def of state.definitions) {
      syncToRegistry(def);
    }
  },

  SET_LOADED(state, loaded) {
    state.isLoaded = loaded;
  },

  SET_LOADING(state, loading) {
    state.isLoading = loading;
  },

  SET_ACTIVE_DEFINITION(state, id) {
    state.activeDefinitionId = id;
  },

  INCREMENT_FORGE_RESET_KEY(state) {
    state.forgeResetKey++;
  },

  SET_PENDING_FORM_PREFILL(state, prefill) {
    state.pendingFormPrefill = prefill;
  },

  ADD_DEFINITION(state, definition) {
    state.definitions.unshift(definition);
    syncToRegistry(definition);
  },

  UPDATE_DEFINITION(state, { id, updates }) {
    const idx = state.definitions.findIndex((d) => d.id === id);
    if (idx !== -1) {
      state.definitions[idx] = { ...state.definitions[idx], ...updates };
      syncToRegistry(state.definitions[idx]);
    }
  },

  REMOVE_DEFINITION(state, id) {
    state.definitions = state.definitions.filter((d) => d.id !== id);
    removeFromRegistry(id);
  },
};

const actions = {
  /**
   * Fetch all widget definitions from API.
   */
  async fetchDefinitions({ commit }) {
    commit('SET_LOADING', true);
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions`, {
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        commit('SET_DEFINITIONS', data.widgets || []);
        commit('SET_LOADED', true);
      }
    } catch (error) {
      console.error('Failed to fetch widget definitions:', error);
    } finally {
      commit('SET_LOADING', false);
    }
  },

  /**
   * Hydrate a definition with its full source_code by fetching the row from
   * the server. The list endpoint omits `source_code` to keep the catalog
   * lightweight; consumers that actually need to render or edit a widget
   * call this first.
   *
   * Idempotent — `'source_code' in def` is the hydrated marker. Concurrent
   * calls for the same id share a single in-flight request.
   */
  async ensureDefinitionLoaded({ commit, state }, id) {
    if (!id) return null;
    const existing = state.definitions.find((d) => d.id === id);
    if (existing && 'source_code' in existing) return existing;

    if (_pendingDetailLoads.has(id)) return _pendingDetailLoads.get(id);

    const fetchPromise = (async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/${id}`, {
          headers: getAuthHeaders(),
        });
        if (!response.ok) return null;
        const data = await response.json();
        const widget = data.widget || data;
        if (!widget || !widget.id) return null;

        if (state.definitions.find((d) => d.id === widget.id)) {
          commit('UPDATE_DEFINITION', { id: widget.id, updates: widget });
        } else {
          commit('ADD_DEFINITION', widget);
        }
        return state.definitions.find((d) => d.id === widget.id) || null;
      } catch (error) {
        console.error(`Failed to load widget definition ${id}:`, error);
        return null;
      } finally {
        _pendingDetailLoads.delete(id);
      }
    })();

    _pendingDetailLoads.set(id, fetchPromise);
    return fetchPromise;
  },

  /**
   * Create a new widget definition.
   */
  async createDefinition({ commit }, widgetData) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(widgetData),
      });

      if (response.ok) {
        const data = await response.json();
        commit('ADD_DEFINITION', data.widget);
        return data.widget;
      }
      return null;
    } catch (error) {
      console.error('Failed to create widget definition:', error);
      return null;
    }
  },

  /**
   * Update an existing widget definition.
   */
  async updateDefinition({ commit }, { id, updates }) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        commit('UPDATE_DEFINITION', { id, updates });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update widget definition:', error);
      return false;
    }
  },

  /**
   * Delete a widget definition.
   */
  async deleteDefinition({ commit }, id) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        commit('REMOVE_DEFINITION', id);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete widget definition:', error);
      return false;
    }
  },

  /**
   * Duplicate a widget definition.
   */
  async duplicateDefinition({ dispatch }, id) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/${id}/duplicate`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        // Refresh the list to get the new copy
        await dispatch('fetchDefinitions');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to duplicate widget definition:', error);
      return false;
    }
  },

  /**
   * Export a widget definition.
   */
  async exportDefinition(_, id) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/${id}/export`, {
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        return data.export;
      }
      return null;
    } catch (error) {
      console.error('Failed to export widget definition:', error);
      return null;
    }
  },

  /**
   * Import a widget definition.
   */
  async importDefinition({ dispatch }, widgetData) {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/widget-definitions/import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ widget_data: widgetData }),
      });

      if (response.ok) {
        await dispatch('fetchDefinitions');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to import widget definition:', error);
      return false;
    }
  },

  setActiveDefinition({ commit }, id) {
    commit('SET_ACTIVE_DEFINITION', id);
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
