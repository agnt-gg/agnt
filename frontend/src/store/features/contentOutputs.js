import { API_CONFIG } from '@/tt.config.js';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default {
  namespaced: true,
  state: {
    outputs: [],
    totalCount: 0,
    lastFetched: null,
    isFetching: false,
    hasLoadedAll: false,
  },
  mutations: {
    SET_OUTPUTS(state, { outputs, totalCount, append = false }) {
      const mappedOutputs = outputs.map((output) => ({
        ...output,
        created_at: new Date(output.created_at),
      }));

      if (append) {
        // Append new outputs, avoiding duplicates
        const existingIds = new Set(state.outputs.map((o) => o.id));
        const newOutputs = mappedOutputs.filter((o) => !existingIds.has(o.id));
        state.outputs = [...state.outputs, ...newOutputs];
      } else {
        state.outputs = mappedOutputs;
      }

      state.totalCount = totalCount;
      state.lastFetched = Date.now();
    },
    SET_HAS_LOADED_ALL(state, value) {
      state.hasLoadedAll = value;
    },
    SET_FETCHING(state, value) {
      state.isFetching = value;
    },
    ADD_OUTPUT(state, output) {
      state.outputs.unshift({
        ...output,
        created_at: new Date(output.created_at),
      });
    },
    REMOVE_OUTPUT(state, outputId) {
      state.outputs = state.outputs.filter((output) => output.id !== outputId);
    },
    INVALIDATE_CACHE(state) {
      state.lastFetched = null;
    },
  },
  getters: {
    outputs: (state) => state.outputs,
    totalCount: (state) => state.totalCount,
    isFetching: (state) => state.isFetching,
    hasLoadedAll: (state) => state.hasLoadedAll,
    hasMore: (state) => state.outputs.length < state.totalCount,
    isCacheValid: (state) => {
      if (!state.lastFetched) return false;
      return Date.now() - state.lastFetched < CACHE_DURATION;
    },
  },
  actions: {
    async fetchOutputs({ commit, getters, state }, { force = false, limit = 20, offset = 0, loadAll = false } = {}) {
      // If cache is valid and not forcing, return cached data
      if (!force && getters.isCacheValid && state.outputs.length > 0 && offset === 0) {
        return state.outputs;
      }

      // If already fetching, don't fetch again
      if (state.isFetching) {
        return state.outputs;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        return [];
      }

      commit('SET_FETCHING', true);

      try {
        // Build URL with pagination params
        const url = new URL(`${API_CONFIG.BASE_URL}/content-outputs`);
        if (!loadAll) {
          url.searchParams.append('limit', limit);
          url.searchParams.append('offset', offset);
        }

        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('SET_OUTPUTS', {
          outputs: data.outputs,
          totalCount: data.totalCount || data.outputs.length,
          append: offset > 0,
        });

        if (loadAll || data.outputs.length >= (data.totalCount || data.outputs.length)) {
          commit('SET_HAS_LOADED_ALL', true);
        }

        return data.outputs;
      } catch (error) {
        console.error('Error fetching outputs:', error);
        return [];
      } finally {
        commit('SET_FETCHING', false);
      }
    },

    async loadMore({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      const offset = state.outputs.length;
      await dispatch('fetchOutputs', { limit: 20, offset, force: false });
    },

    async loadAll({ commit, state, dispatch }) {
      if (state.isFetching || state.hasLoadedAll) {
        return;
      }

      await dispatch('fetchOutputs', { loadAll: true, force: false });
    },

    async deleteOutput({ commit }, outputId) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        throw new Error('No authentication token');
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        commit('REMOVE_OUTPUT', outputId);
        return true;
      } catch (error) {
        console.error('Error deleting output:', error);
        throw error;
      }
    },

    invalidateCache({ commit }) {
      commit('INVALIDATE_CACHE');
      commit('SET_HAS_LOADED_ALL', false);
    },

    refreshOutputs({ dispatch, commit }) {
      commit('SET_HAS_LOADED_ALL', false);
      return dispatch('fetchOutputs', { force: true, limit: 20, offset: 0 });
    },
  },
};
