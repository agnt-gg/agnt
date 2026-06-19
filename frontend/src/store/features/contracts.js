import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    contracts: [],
    violations: {}, // keyed by contractId
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_CONTRACTS(state, contracts) { state.contracts = contracts || []; },
    UPSERT_CONTRACT(state, contract) {
      if (!contract || !contract.id) return;
      const idx = state.contracts.findIndex(c => c.id === contract.id);
      if (idx >= 0) state.contracts.splice(idx, 1, contract);
      else state.contracts.unshift(contract);
    },
    REMOVE_CONTRACT(state, id) {
      state.contracts = state.contracts.filter(c => c.id !== id);
    },
    SET_VIOLATIONS(state, { contractId, violations }) {
      state.violations = { ...state.violations, [contractId]: violations || [] };
    },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ERROR(state, err) { state.error = err; },
  },
  actions: {
    async fetchContracts({ commit }, filters = {}) {
      commit('SET_LOADING', true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.append('status', filters.status);
        if (filters.targetType) params.append('targetType', filters.targetType);
        const res = await fetch(`${API_CONFIG.BASE_URL}/contracts?${params}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_CONTRACTS', data.contracts);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async createContract({ commit }, payload) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/contracts`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('UPSERT_CONTRACT', data.contract);
        return data.contract;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async updateContractStatus({ commit }, { id, status }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/contracts/${id}`, {
          method: 'PATCH', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify({ status }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('UPSERT_CONTRACT', data.contract);
        return data.contract;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fetchViolations({ commit }, contractId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/contracts/${contractId}/violations`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_VIOLATIONS', { contractId, violations: data.violations });
        return data.violations;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async deleteContract({ commit }, id) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/contracts/${id}`, {
          method: 'DELETE', credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        commit('REMOVE_CONTRACT', id);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },
  },
  getters: {
    allContracts: (state) => state.contracts,
    activeContracts: (state) => state.contracts.filter(c => c.status === 'active'),
    contractsByTarget: (state) => (targetType, targetId) =>
      state.contracts.filter(c => c.target_type === targetType && c.target_id === targetId),
    totalViolations: (state) => state.contracts.reduce((sum, c) => sum + (c.violation_count || 0), 0),
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
  },
};
