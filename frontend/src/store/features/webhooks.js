import { API_CONFIG } from '@/tt.config.js';

const state = {
  webhooks: [],
  loading: false,
  error: null,
};

const getters = {
  allWebhooks: (state) => state.webhooks,
  isLoading: (state) => state.loading,
  getError: (state) => state.error,
};

const mutations = {
  SET_WEBHOOKS(state, webhooks) {
    state.webhooks = webhooks;
  },
  SET_LOADING(state, loading) {
    state.loading = loading;
  },
  SET_ERROR(state, error) {
    state.error = error;
  },
  ADD_WEBHOOK(state, webhook) {
    state.webhooks.push(webhook);
  },
  REMOVE_WEBHOOK(state, workflowId) {
    state.webhooks = state.webhooks.filter((w) => w.workflow_id !== workflowId);
  },
};

const actions = {
  async fetchWebhooks({ commit }) {
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/webhooks`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('SET_WEBHOOKS', data.webhooks);
      } else {
        throw new Error(data.error || 'Failed to fetch webhooks');
      }
    } catch (error) {
      console.error('Error fetching webhooks:', error);
      commit('SET_ERROR', error.message);
    } finally {
      commit('SET_LOADING', false);
    }
  },

  async deleteWebhook({ commit }, workflowId) {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.BASE_URL}/webhooks/workflow/${workflowId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        commit('REMOVE_WEBHOOK', workflowId);
        return { success: true };
      } else {
        throw new Error(data.error || 'Failed to delete webhook');
      }
    } catch (error) {
      console.error('Error deleting webhook:', error);
      return { success: false, error: error.message };
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
