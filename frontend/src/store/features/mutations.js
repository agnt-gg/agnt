import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    history: [],
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_HISTORY(state, history) { state.history = history || []; },
    UPSERT_MUTATION(state, mutation) {
      if (!mutation || !mutation.id) return;
      const idx = state.history.findIndex(m => m.id === mutation.id);
      if (idx >= 0) state.history.splice(idx, 1, mutation);
      else state.history.unshift(mutation);
    },
    UPDATE_MUTATION_STATUS(state, { id, status, fitness_after, delta }) {
      const m = state.history.find(x => x.id === id);
      if (m) {
        m.status = status;
        if (typeof fitness_after === 'number') m.fitness_after = fitness_after;
        if (typeof delta === 'number') m.delta = delta;
      }
    },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ERROR(state, err) { state.error = err; },
  },
  actions: {
    async fetchHistory({ commit }, filters = {}) {
      commit('SET_LOADING', true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.append('status', filters.status);
        if (filters.targetType) params.append('targetType', filters.targetType);
        if (filters.limit) params.append('limit', filters.limit);
        const res = await fetch(`${API_CONFIG.BASE_URL}/mutations?${params}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_HISTORY', data.history);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async canaryCheck({ commit }, id) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/mutations/${id}/canary-check`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.verdict) {
          commit('UPDATE_MUTATION_STATUS', {
            id,
            status: data.verdict.regression ? 'regression_detected' : 'applied',
            fitness_after: data.verdict.fitnessAfter,
            delta: data.verdict.delta,
          });
        }
        return data.verdict;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async revertMutation({ commit }, { id, reason }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/mutations/${id}/revert`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        commit('UPDATE_MUTATION_STATUS', { id, status: 'reverted' });
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },
  },
  getters: {
    allMutations: (state) => state.history,
    recentMutations: (state) => state.history.slice(0, 25),
    appliedCount: (state) => state.history.filter(m => m.status === 'applied').length,
    revertedCount: (state) => state.history.filter(m => m.status === 'reverted').length,
    failedCount: (state) => state.history.filter(m => m.status === 'apply_failed').length,
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
  },
};
