import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    stats: null,
    evaluations: [],
    leaderboard: [],
    settings: null,
    selectedSkillVersions: [],
    selectedSkillLineage: null,
    selectedSkillEvals: [],
    isLoading: false,
    isAnalyzing: false,
    isEvolving: false,
    error: null,
    lastAnalysis: null,
    lastEvolution: null,
  },
  mutations: {
    SET_STATS(state, stats) { state.stats = stats; },
    SET_EVALUATIONS(state, evaluations) { state.evaluations = evaluations || []; },
    SET_LEADERBOARD(state, leaderboard) { state.leaderboard = leaderboard || []; },
    SET_SETTINGS(state, settings) { state.settings = settings; },
    SET_SKILL_VERSIONS(state, versions) { state.selectedSkillVersions = versions || []; },
    SET_SKILL_LINEAGE(state, data) { state.selectedSkillLineage = data; },
    SET_SKILL_EVALS(state, evals) { state.selectedSkillEvals = evals || []; },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ANALYZING(state, val) { state.isAnalyzing = val; },
    SET_EVOLVING(state, val) { state.isEvolving = val; },
    SET_ERROR(state, err) { state.error = err; },
    SET_LAST_ANALYSIS(state, analysis) { state.lastAnalysis = analysis; },
    SET_LAST_EVOLUTION(state, result) { state.lastEvolution = result; },
  },
  actions: {
    async fetchStats({ commit }) {
      commit('SET_LOADING', true);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/stats`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_STATS', data.stats);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchEvaluations({ commit }, limit = 50) {
      commit('SET_LOADING', true);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/evaluations?limit=${limit}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_EVALUATIONS', data.evaluations);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchLeaderboard({ commit }, limit = 20) {
      commit('SET_LOADING', true);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/leaderboard?limit=${limit}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_LEADERBOARD', data.leaderboard);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchSettings({ commit }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/settings`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SETTINGS', data.settings);
      } catch (error) {
        commit('SET_ERROR', error.message);
      }
    },

    async updateSettings({ commit }, settings) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/settings`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
          body: JSON.stringify(settings),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SETTINGS', data.settings);
        return data.settings;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async analyzeGoal({ commit }, goalId) {
      commit('SET_ANALYZING', true);
      commit('SET_LAST_ANALYSIS', null);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/analyze/${goalId}`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_LAST_ANALYSIS', data);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_ANALYZING', false);
      }
    },

    async evolveFromGoal({ commit, dispatch }, goalId) {
      commit('SET_EVOLVING', true);
      commit('SET_LAST_EVOLUTION', null);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/evolve/${goalId}`, {
          method: 'POST',
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_LAST_EVOLUTION', data.result);
        // Refresh stats after evolution
        dispatch('fetchStats');
        dispatch('fetchLeaderboard');
        return data.result;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_EVOLVING', false);
      }
    },

    async fetchSkillVersions({ commit }, skillId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/skill/${skillId}/versions`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SKILL_VERSIONS', data.versions);
      } catch (error) {
        commit('SET_ERROR', error.message);
      }
    },

    async fetchSkillLineage({ commit }, skillId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/skill/${skillId}/lineage`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SKILL_LINEAGE', { lineage: data.lineage, stats: data.stats });
      } catch (error) {
        commit('SET_ERROR', error.message);
      }
    },

    async fetchSkillEvaluations({ commit }, skillId) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/skillforge/evaluations/${skillId}`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SKILL_EVALS', data.evaluations);
      } catch (error) {
        commit('SET_ERROR', error.message);
      }
    },
  },
  getters: {
    stats: state => state.stats,
    evaluations: state => state.evaluations,
    leaderboard: state => state.leaderboard,
    settings: state => state.settings,
    isLoading: state => state.isLoading,
    isAnalyzing: state => state.isAnalyzing,
    isEvolving: state => state.isEvolving,
    lastAnalysis: state => state.lastAnalysis,
    lastEvolution: state => state.lastEvolution,
    selectedSkillVersions: state => state.selectedSkillVersions,
    selectedSkillLineage: state => state.selectedSkillLineage,
    selectedSkillEvals: state => state.selectedSkillEvals,
  },
};
