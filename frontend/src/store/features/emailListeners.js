import { API_CONFIG } from '@/tt.config.js';

const state = {
  emailListeners: [],
  loading: false,
  error: null,
};

const getters = {
  allEmailListeners: (state) => state.emailListeners,
  isLoading: (state) => state.loading,
  getError: (state) => state.error,
};

const mutations = {
  SET_EMAIL_LISTENERS(state, listeners) {
    state.emailListeners = listeners;
  },
  SET_LOADING(state, loading) {
    state.loading = loading;
  },
  SET_ERROR(state, error) {
    state.error = error;
  },
};

const actions = {
  async fetchEmailListeners({ commit }) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/email-listeners`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('SET_EMAIL_LISTENERS', data.listeners);
      } else {
        throw new Error(data.error || 'Failed to fetch email listeners');
      }
    } catch (error) {
      console.error('Error fetching email listeners:', error);
      commit('SET_ERROR', error.message);
    } finally {
      commit('SET_LOADING', false);
    }
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
