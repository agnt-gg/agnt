import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    insights: [],
    stats: null,
    targetInsights: [],
    sourceInsights: [],
    agentMemories: [],
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_INSIGHTS(state, insights) { state.insights = insights || []; },
    SET_STATS(state, stats) { state.stats = stats; },
    SET_TARGET_INSIGHTS(state, insights) { state.targetInsights = insights || []; },
    SET_SOURCE_INSIGHTS(state, insights) { state.sourceInsights = insights || []; },
    SET_AGENT_MEMORIES(state, memories) { state.agentMemories = memories || []; },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ERROR(state, err) { state.error = err; },
    REMOVE_INSIGHT(state, id) { state.insights = state.insights.filter(i => i.id !== id); },
    UPDATE_INSIGHT_STATUS(state, { id, status }) {
      const insight = state.insights.find(i => i.id === id);
      if (insight) insight.status = status;
    },
  },
  actions: {
    async fetchInsights({ commit }, filters = {}) {
      commit('SET_LOADING', true);
      try {
        const params = new URLSearchParams();
        if (filters.targetType) params.append('targetType', filters.targetType);
        if (filters.targetId) params.append('targetId', filters.targetId);
        if (filters.status) params.append('status', filters.status);
        if (filters.category) params.append('category', filters.category);
        if (filters.limit) params.append('limit', filters.limit);

        const res = await fetch(`${API_CONFIG.BASE_URL}/insights?${params}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_INSIGHTS', data.insights);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchStats({ commit }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/stats`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_STATS', { statusCounts: data.statusCounts, targetCounts: data.targetCounts });
      } catch (error) {
        commit('SET_ERROR', error.message);
      }
    },

    async fetchTargetInsights({ commit }, { targetType, targetId, status }) {
      try {
        const params = status ? `?status=${status}` : '';
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/target/${targetType}/${targetId}${params}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_TARGET_INSIGHTS', data.insights);
        return data.insights;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async fetchSourceInsights({ commit }, { sourceType, sourceId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/source/${sourceType}/${sourceId}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SOURCE_INSIGHTS', data.insights);
        return data.insights;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async applyInsight({ commit, dispatch, rootState }, insightId) {
      try {
        const provider = rootState.aiProvider?.selectedProvider || null;
        const model = rootState.aiProvider?.selectedModel || null;

        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/${insightId}/apply`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ provider, model }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('UPDATE_INSIGHT_STATUS', { id: insightId, status: 'applied' });
        dispatch('fetchStats');
        return data.result;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async rejectInsight({ commit, dispatch }, insightId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/${insightId}/reject`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        commit('UPDATE_INSIGHT_STATUS', { id: insightId, status: 'rejected' });
        dispatch('fetchStats');
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async deleteInsight({ commit }, insightId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/${insightId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        commit('REMOVE_INSIGHT', insightId);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async triggerRollup({ commit, dispatch }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/rollup`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        dispatch('fetchStats');
        dispatch('fetchInsights');
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    // ==================== AGENT MEMORY ====================

    async fetchAgentMemories({ commit }, agentId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/${agentId}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_AGENT_MEMORIES', data.memories);
        return data.memories;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async addAgentMemory({ dispatch }, { agentId, memoryType, content }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/${agentId}`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ memoryType, content }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        dispatch('fetchAgentMemories', agentId);
        return data.id;
      } catch (error) {
        throw error;
      }
    },

    async updateAgentMemory({ dispatch }, { id, content, relevanceScore, memoryType, agentId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/entry/${id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify({ content, relevanceScore, memoryType }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (agentId) dispatch('fetchAgentMemories', agentId);
      } catch (error) {
        throw error;
      }
    },

    async deleteAgentMemory({ dispatch }, { id, agentId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/insights/memory/entry/${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (agentId) dispatch('fetchAgentMemories', agentId);
      } catch (error) {
        throw error;
      }
    },
  },
  getters: {
    allInsights: state => state.insights,
    stats: state => state.stats,
    targetInsights: state => state.targetInsights,
    sourceInsights: state => state.sourceInsights,
    agentMemories: state => state.agentMemories,
    isLoading: state => state.isLoading,
    error: state => state.error,
    pendingInsights: state => state.insights.filter(i => i.status === 'pending'),
    pendingCount: state => state.stats?.statusCounts?.pending || 0,
    insightsByTarget: state => (targetType) => state.insights.filter(i => i.target_type === targetType),
  },
};
