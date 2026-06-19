import { API_CONFIG } from '@/tt.config.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('No authentication token found');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

export default {
  namespaced: true,
  state: {
    schedules: [],
    runHistory: {}, // keyed by scheduleId
    previewing: null,
    isLoading: false,
    error: null,
  },
  mutations: {
    SET_SCHEDULES(state, schedules) { state.schedules = schedules || []; },
    UPSERT_SCHEDULE(state, schedule) {
      if (!schedule || !schedule.id) return;
      const idx = state.schedules.findIndex(s => s.id === schedule.id);
      if (idx >= 0) state.schedules.splice(idx, 1, schedule);
      else state.schedules.unshift(schedule);
    },
    REMOVE_SCHEDULE(state, id) {
      state.schedules = state.schedules.filter(s => s.id !== id);
    },
    SET_RUN_HISTORY(state, { scheduleId, runs }) {
      state.runHistory = { ...state.runHistory, [scheduleId]: runs || [] };
    },
    SET_PREVIEWING(state, preview) { state.previewing = preview; },
    SET_LOADING(state, val) { state.isLoading = val; },
    SET_ERROR(state, err) { state.error = err; },
  },
  actions: {
    async fetchSchedules({ commit }) {
      commit('SET_LOADING', true);
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_SCHEDULES', data.schedules);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },

    async fetchByTarget({ commit }, { targetType, targetId }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/target/${targetType}/${targetId}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.schedules || [];
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async previewCron({ commit }, { cron, timezone, count = 5 }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/preview`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify({ cron, timezone, count }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('SET_PREVIEWING', { cron, previews: data.previews });
        return data.previews;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async createSchedule({ commit }, payload) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('UPSERT_SCHEDULE', data.schedule);
        return data.schedule;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async updateSchedule({ commit }, { id, patch }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/${id}`, {
          method: 'PATCH', credentials: 'include', headers: getAuthHeaders(),
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        commit('UPSERT_SCHEDULE', data.schedule);
        return data.schedule;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fireNow({ commit, dispatch }, id) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/${id}/fire-now`, {
          method: 'POST', credentials: 'include', headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        dispatch('fetchSchedules');
        return data.result;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },

    async fetchRunHistory({ commit }, { scheduleId, limit = 50 }) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/${scheduleId}/runs?limit=${limit}`, {
          credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        commit('SET_RUN_HISTORY', { scheduleId, runs: data.runs });
        return data.runs;
      } catch (error) {
        commit('SET_ERROR', error.message);
        return [];
      }
    },

    async deleteSchedule({ commit }, id) {
      try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/schedules/${id}`, {
          method: 'DELETE', credentials: 'include', headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        commit('REMOVE_SCHEDULE', id);
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      }
    },
  },
  getters: {
    allSchedules: (state) => state.schedules,
    enabledSchedules: (state) => state.schedules.filter(s => s.enabled),
    schedulesForGoal: (state) => (goalId) => state.schedules.filter(s => s.target_type === 'goal' && s.target_id === goalId),
    nextDueSchedule: (state) => {
      const enabled = state.schedules.filter(s => s.enabled && s.next_run).sort((a, b) => new Date(a.next_run) - new Date(b.next_run));
      return enabled[0] || null;
    },
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
  },
};
