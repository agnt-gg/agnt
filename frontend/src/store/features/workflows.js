import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    workflows: [],
    // categories: [
    //   'Uncategorized',

    //   '000 - Foundations & Patterns',
    //   '000.1 - General Purpose',
    //   '000.2 - Meta Learning',

    //   '100 - Business & Finance',
    //   '100.1 - Accounting',
    //   '100.2 - Analysis',

    //   '200 - Content & Media',
    //   '200.1 - Writing',
    //   '200.2 - Image / Video',
    //   '200.3 - Audio',
    //   '200.4 - Graphic Design',
    //   '200.5 - UX Review',

    //   '300 - Data & Analytics',
    //   '300.1 - Acquisition',
    //   '300.2 - Analytics',
    //   '300.3 - Transformation',

    //   '400 - Development & DevOps',
    //   '400.1 - Code Generation',
    //   '400.2 - Testing',
    //   '400.3 - Dev Ops',

    //   '500 - Marketing & Sales',
    //   '500.1 - Lead Gen',
    //   '500.2 - Campaigns',
    //   '500.3 - Social Media',

    //   '600 - Operations & Tools',
    //   '600.1 - Help Desk',
    //   '600.2 - Ops Automation',
    //   '600.3 - Productivity',
    //   '600.4 - Scheduling',
    //   '600.5 - Task Management',
    //   '600.6 - Healthcare',
    //   '600.7 - Legal',
    // ],
    categories: [
      'Business & Finance',
      'Content & Media',
      'Customer Support',
      'Data & Analytics',
      'Human Resources & Legal',
      'Operations & Tools',
      'Sales & Marketing',
      'Technology & Development',
      'Uncategorized',
    ],
    isLoading: false,
    error: null,
    lastUpdate: null, // Track last update time
    lastFullFetch: null, // Track last full fetch time
  },
  mutations: {
    SET_WORKFLOWS(state, workflows) {
      state.workflows = workflows;
      state.lastUpdate = new Date();
    },
    ADD_WORKFLOW(state, workflow) {
      state.workflows.push(workflow);
      state.lastUpdate = new Date();
    },
    UPDATE_WORKFLOW(state, updatedWorkflow) {
      const index = state.workflows.findIndex((workflow) => workflow.id === updatedWorkflow.id);
      if (index !== -1) {
        state.workflows.splice(index, 1, updatedWorkflow);
        state.lastUpdate = new Date();
      }
    },
    DELETE_WORKFLOW(state, workflowId) {
      state.workflows = state.workflows.filter((workflow) => workflow.id !== workflowId);
      state.lastUpdate = new Date();
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    SET_LAST_FULL_FETCH(state, time) {
      state.lastFullFetch = time;
    },
    CLEAR_WORKFLOWS(state) {
      state.workflows = [];
      state.isLoading = false;
      state.error = null;
      state.lastUpdate = null;
      state.lastFullFetch = null;
    },
  },
  actions: {
    async updateWorkflow({ commit }, workflowData) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/save`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ workflow: workflowData }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('UPDATE_WORKFLOW', workflowData);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async fetchWorkflows({ commit, state }, { activeOnly = false } = {}) {
      // Don't fetch if we're already loading
      if (state.isLoading) return;

      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Determine if we need a full fetch
        const now = new Date();
        const needsFullFetch = !state.lastFullFetch || now - state.lastFullFetch > 5 * 60 * 1000; // 5 minutes

        let url = `${API_CONFIG.BASE_URL}/workflows/`;
        if (activeOnly && !needsFullFetch) {
          url += '?status=running,listening,error';
        }

        const response = await fetch(url, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        const processedWorkflows = data.workflows.map((workflow) => ({
          ...workflow,
          category: workflow.category || '',
          status: workflow.status || 'stopped',
          updated_at: new Date(workflow.updated_at),
        }));

        if (!activeOnly || needsFullFetch) {
          commit('SET_WORKFLOWS', processedWorkflows);
          commit('SET_LAST_FULL_FETCH', now);
        } else {
          // Update only active workflows
          processedWorkflows.forEach((workflow) => {
            commit('UPDATE_WORKFLOW', workflow);
          });
        }

        console.log(`[DEBUG] Fetched workflows (${activeOnly ? 'active only' : 'all'}):`, processedWorkflows);
      } catch (error) {
        console.error('Error fetching workflows:', error);
        commit('SET_ERROR', error.message);
        if (!activeOnly) {
          commit('SET_WORKFLOWS', []); // Only clear on full fetch errors
        }
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async deleteWorkflow({ commit }, workflowId) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${workflowId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('DELETE_WORKFLOW', workflowId);
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async createWorkflow({ commit, state }, workflow) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflow),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        commit('ADD_WORKFLOW', data.workflow);
        return data.workflow;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
  },
  getters: {
    allWorkflows: (state) => state.workflows,
    activeWorkflows: (state) => state.workflows.filter((w) => w.status === 'running' || w.status === 'listening' || w.status === 'error'),
    getWorkflowById: (state) => (id) => state.workflows.find((workflow) => workflow.id === id),
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
    lastUpdateTime: (state) => state.lastUpdate,
    workflowCategories: (state) => state.categories,
    workflowsByCategory: (state) => (category) => state.workflows.filter((wf) => wf.category === category),
  },
};
