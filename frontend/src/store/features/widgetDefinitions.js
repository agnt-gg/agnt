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

const state = {
  definitions: [],
  isLoaded: false,
  isLoading: false,
  activeDefinitionId: null,
};

const getters = {
  allDefinitions: (state) => state.definitions,
  isLoaded: (state) => state.isLoaded,
  isLoading: (state) => state.isLoading,
  activeDefinition: (state) => state.definitions.find((d) => d.id === state.activeDefinitionId) || null,
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
    state.definitions = definitions;
    // Sync all definitions to the widget registry so catalog picks them up
    for (const def of definitions) {
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
