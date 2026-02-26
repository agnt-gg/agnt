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
    isFetchingWorkflows: false, // Request deduplication flag
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
      state.isFetchingWorkflows = false;
    },
    SET_FETCHING_WORKFLOWS(state, isFetching) {
      state.isFetchingWorkflows = isFetching;
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
      // Request deduplication - prevent duplicate concurrent calls
      // Allow active-only fetches to proceed even if a full fetch is in progress
      if (state.isFetchingWorkflows && !activeOnly) return;

      // For active-only fetches while a full fetch is running, wait for it to complete
      // then do the active-only fetch to ensure fresh status data
      if (state.isFetchingWorkflows && activeOnly) {
        // Wait for the current fetch to finish (poll briefly)
        let waited = 0;
        while (state.isFetchingWorkflows && waited < 5000) {
          await new Promise((r) => setTimeout(r, 100));
          waited += 100;
        }
      }

      const isActiveOnlyFetch = activeOnly;
      if (!isActiveOnlyFetch) {
        commit('SET_FETCHING_WORKFLOWS', true);
      }
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        let url;
        if (activeOnly) {
          // Active-only fetches still use the full endpoint for status data
          url = `${API_CONFIG.BASE_URL}/workflows/?status=running,listening,error`;
        } else {
          // Full list uses lightweight summary endpoint (no nodes/edges/parameters)
          url = `${API_CONFIG.BASE_URL}/workflows/summary`;
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
          // Map node_summary to nodes-like structure for backward compat with list views
          // (Workflows.vue and WorkflowsPanel read .nodes for tool display)
          nodes: workflow.nodes || (workflow.node_summary
            ? workflow.node_summary.map(ns => ({
                type: ns.type,
                icon: ns.icon,
                text: ns.label,
                data: { label: ns.label, icon: ns.icon },
              }))
            : []),
        }));

        if (activeOnly) {
          // Merge active workflow updates into existing state
          // Add workflows that aren't in state yet (fixes race condition where
          // active-only fetch runs before full fetch populates the list)
          processedWorkflows.forEach((workflow) => {
            const exists = state.workflows.some((w) => w.id === workflow.id);
            if (exists) {
              commit('UPDATE_WORKFLOW', workflow);
            } else {
              commit('ADD_WORKFLOW', workflow);
            }
          });
        } else {
          commit('SET_WORKFLOWS', processedWorkflows);
        }
      } catch (error) {
        console.error('Error fetching workflows:', error);
        commit('SET_ERROR', error.message);
        if (!activeOnly) {
          commit('SET_WORKFLOWS', []); // Only clear on full fetch errors
        }
      } finally {
        commit('SET_LOADING', false);
        if (!isActiveOnlyFetch) {
          commit('SET_FETCHING_WORKFLOWS', false);
        }
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
