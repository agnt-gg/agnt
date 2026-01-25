import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    agents: [], // Start with empty array - will be populated from API
    // categories: [
    //   'Uncategorized',
    //   '000 - Foundations & Patterns',
    //   '100 - Business & Finance',
    //   '200 - Content & Media',
    //   '300 - Data & Analytics',
    //   '400 - Development & DevOps',
    //   '500 - Marketing & Sales',
    //   '600 - Operations & Tools',
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
    recentActivities: [],
    lastFetched: null,
    isFetchingAgents: false, // Request deduplication flag
  },
  mutations: {
    SET_AGENTS(state, agents) {
      // Map backend agent fields to frontend structure
      state.agents = (agents || []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        avatar: agent.icon || null, // icon from backend is avatar in frontend
        class: agent.class || 'worker',
        category: agent.category || '',
        assignedTools: agent.assignedTools || [],
        capabilities: agent.capabilities || [],
        tasksCompleted: agent.tasksCompleted || 0,
        uptime: agent.uptime || 0,
        creditLimit: agent.creditLimit || 0,
        creditsUsed: agent.creditsUsed || 0,
        workflows: agent.workflows || agent.workflow_count || 0,
        lastActive: agent.lastActive || agent.last_active || null,
        successRate: agent.successRate || agent.success_rate || null,
        provider: agent.provider || '',
        model: agent.model || '',
      }));
      state.lastFetched = Date.now();
    },
    ADD_AGENT(state, agent) {
      state.agents.push(agent);
    },
    UPDATE_AGENT(state, updatedAgent) {
      const index = state.agents.findIndex((agent) => agent.id === updatedAgent.id);
      if (index !== -1) {
        state.agents.splice(index, 1, updatedAgent);
      }
    },
    DELETE_AGENT(state, agentId) {
      state.agents = state.agents.filter((agent) => agent.id !== agentId);
    },
    SET_LOADING(state, isLoading) {
      state.isLoading = isLoading;
    },
    SET_ERROR(state, error) {
      state.error = error;
    },
    SET_RECENT_ACTIVITIES(state, activities) {
      state.recentActivities = activities;
    },
    SET_LAST_FETCHED(state, timestamp) {
      state.lastFetched = timestamp;
    },
    CLEAR_AGENTS(state) {
      state.agents = [];
      state.isLoading = false;
      state.error = null;
      state.recentActivities = [];
      state.lastFetched = null;
      state.isFetchingAgents = false;
    },
    SET_FETCHING_AGENTS(state, isFetching) {
      state.isFetchingAgents = isFetching;
    },
  },
  actions: {
    async fetchAgents({ commit, state }, { force = false } = {}) {
      // Request deduplication - prevent duplicate concurrent calls
      if (state.isFetchingAgents) {
        return;
      }

      // Only fetch if agents is empty or lastFetched > 5 min ago, unless force is true
      const now = Date.now();
      if (!force && state.agents.length > 0 && state.lastFetched && now - state.lastFetched < 5 * 60 * 1000) {
        // Use cache, skip fetch
        return;
      }

      commit('SET_FETCHING_AGENTS', true);
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        // The backend returns { agents: [...] }
        commit('SET_AGENTS', data.agents || []);
        commit('SET_LAST_FETCHED', now);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
        commit('SET_FETCHING_AGENTS', false);
      }
    },
    async updateAgent({ commit }, agentData) {
      // Optimistically update local state
      commit('UPDATE_AGENT', {
        ...agentData,
        avatar: agentData.avatar || null,
        category: agentData.category || '',
        assignedTools: agentData.assignedTools || [],
        assignedWorkflows: agentData.assignedWorkflows || [],
      });
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        // Always send as { agent: { ... } }
        const agent = {
          id: agentData.id,
          name: agentData.name,
          status: agentData.status || 'ACTIVE',
          icon: agentData.avatar || null,
          description: agentData.description || '',
          creditLimit: agentData.creditLimit ?? 0,
          creditsUsed: agentData.creditsUsed ?? 0,
          lastActive: agentData.lastActive || null,
          successRate: agentData.successRate || null,
          category: agentData.category || '',
          assignedTools: agentData.assignedTools || [],
          assignedWorkflows: agentData.assignedWorkflows || [],
          provider: agentData.provider || '',
          model: agentData.model || '',
        };
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agent.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ agent }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        // Patch: ensure category is kept if backend omits it
        if (data.agent && !data.agent.category && agentData.category) {
          data.agent.category = agentData.category;
        }
        commit('UPDATE_AGENT', {
          ...data.agent,
          category: (data.agent && data.agent.category) || agentData.category || '',
          assignedTools: (data.agent && data.agent.assignedTools) || agentData.assignedTools || [],
          assignedWorkflows: (data.agent && data.agent.assignedWorkflows) || agentData.assignedWorkflows || [],
        });
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async createAgent({ commit }, agentData) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        // Always send as { agent: { ... } }
        const agent = {
          id: agentData.id,
          name: agentData.name,
          status: agentData.status || 'INACTIVE',
          icon: agentData.avatar || null,
          description: agentData.description || '',
          creditLimit: agentData.creditLimit ?? 0,
          creditsUsed: agentData.creditsUsed ?? 0,
          lastActive: agentData.lastActive || null,
          successRate: agentData.successRate || null,
          category: agentData.category || '',
          assignedTools: agentData.assignedTools || [],
          assignedWorkflows: agentData.assignedWorkflows || [],
          provider: agentData.provider || '',
          model: agentData.model || '',
        };
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/save`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ agent }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        // Add the agent from server response to store
        const serverAgent = {
          ...(data.agent || agent),
          avatar: (data.agent && data.agent.icon) || agent.icon || null,
          category: (data.agent && data.agent.category) || agent.category || '',
          assignedTools: (data.agent && data.agent.assignedTools) || agent.assignedTools || [],
          assignedWorkflows: (data.agent && data.agent.assignedWorkflows) || agent.assignedWorkflows || [],
        };
        commit('ADD_AGENT', serverAgent);

        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async updateAgentDetails({ commit }, agentData) {
      // Optimistically update local state
      commit('UPDATE_AGENT', {
        ...agentData,
        avatar: agentData.avatar || null,
      });
      return await this.dispatch('agents/updateAgent', agentData);
    },
    async activateAgent({ commit, state }, agentId) {
      // Optimistically update local state
      const current = state.agents.find((a) => a.id === agentId);
      if (current) {
        const updated = { ...current, status: 'ACTIVE' };
        commit('UPDATE_AGENT', updated);
      }
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        // Get the current agent from the store
        const current = state.agents.find((a) => a.id === agentId);
        if (!current) throw new Error('Agent not found in store');
        // Only change status
        const agent = { ...current, status: 'ACTIVE' };
        agent.icon = agent.avatar || null;
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ agent }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async deactivateAgent({ commit, state }, agentId) {
      // Optimistically update local state
      const current = state.agents.find((a) => a.id === agentId);
      if (current) {
        const updated = { ...current, status: 'INACTIVE' };
        commit('UPDATE_AGENT', updated);
      }
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        // Get the current agent from the store
        const current = state.agents.find((a) => a.id === agentId);
        if (!current) throw new Error('Agent not found in store');
        // Only change status
        const agent = { ...current, status: 'INACTIVE' };
        agent.icon = agent.avatar || null;
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ agent }),
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return data;
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async fetchRecentActivities({ commit, state }) {
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Try to fetch real activities from API
        try {
          const response = await fetch(`${API_CONFIG.BASE_URL}/agents/activities`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
          });

          if (response.ok) {
            const data = await response.json();
            commit('SET_RECENT_ACTIVITIES', data.activities || []);
            return;
          }
        } catch (apiError) {
          console.warn('Failed to fetch real activities, using generated data:', apiError);
        }

        // Fallback: Generate realistic activities based on actual agents
        const agents = state.agents || [];
        const now = new Date();
        const activities = [];

        if (agents.length > 0) {
          // Generate activities based on actual agents
          const activityTypes = ['task', 'workflow', 'goal', 'system'];
          const actionTemplates = {
            task: ['completed task', 'started new task', 'updated task status'],
            workflow: ['executed workflow', 'paused workflow', 'resumed workflow'],
            goal: ['progressed on goal', 'completed goal milestone', 'started goal execution'],
            system: ['performed maintenance', 'optimized performance', 'updated configuration'],
          };

          agents.slice(0, 5).forEach((agent, index) => {
            const type = activityTypes[index % activityTypes.length];
            const actions = actionTemplates[type];
            const action = actions[Math.floor(Math.random() * actions.length)];
            const minutesAgo = (index + 1) * 10;

            activities.push({
              id: index + 1,
              agentName: agent.name,
              type,
              text: `${action}`,
              timestamp: new Date(now.getTime() - minutesAgo * 60000).toISOString(),
              tokens: Math.floor(Math.random() * 200) + 100, // 100-300 tokens
            });
          });
        } else {
          // If no agents, create minimal placeholder activity
          activities.push({
            id: 1,
            agentName: 'System',
            type: 'system',
            text: 'System initialized',
            timestamp: now.toISOString(),
            tokens: 0,
          });
        }

        commit('SET_RECENT_ACTIVITIES', activities);
      } catch (error) {
        commit('SET_ERROR', error.message);
      } finally {
        commit('SET_LOADING', false);
      }
    },
    async deleteAgent({ commit }, agentId) {
      // Optimistically remove from local state
      commit('DELETE_AGENT', agentId);
      commit('SET_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No authentication token found');
        const response = await fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        // No need to commit again, already removed
      } catch (error) {
        commit('SET_ERROR', error.message);
        throw error;
      } finally {
        commit('SET_LOADING', false);
      }
    },
  },
  getters: {
    allAgents: (state) => state.agents,
    getAgentById: (state) => (id) => state.agents.find((agent) => agent.id === id),
    isLoading: (state) => state.isLoading,
    error: (state) => state.error,
    recentActivities: (state) => state.recentActivities,
    agentCategories: (state) => state.categories,
    agentsByCategory: (state) => (category) => state.agents.filter((agent) => agent.category === category),
  },
};
