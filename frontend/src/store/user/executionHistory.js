import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

export default {
  namespaced: true,
  state: {
    // Store only summary data for list view
    executionSummaries: [],
    goalExecutionSummaries: [],
    agentExecutionSummaries: [], // Agent/Orchestrator executions
    // Cache for detailed execution data (limit size)
    detailedExecutionsCache: new Map(),
    maxCacheSize: 50, // Keep 50 detailed executions in memory for faster re-access
    lastFetchTime: null,
    // Pagination state
    currentPage: 1,
    pageSize: 50,
    totalExecutions: 0,
  },
  mutations: {
    SET_EXECUTION_SUMMARIES(state, summaries) {
      state.executionSummaries = summaries;
    },
    SET_GOAL_EXECUTION_SUMMARIES(state, summaries) {
      state.goalExecutionSummaries = summaries;
    },
    SET_AGENT_EXECUTION_SUMMARIES(state, summaries) {
      state.agentExecutionSummaries = summaries;
    },
    SET_DETAILED_EXECUTION(state, { id, data }) {
      // Implement LRU cache - remove oldest if cache is full
      if (state.detailedExecutionsCache.size >= state.maxCacheSize) {
        const firstKey = state.detailedExecutionsCache.keys().next().value;
        state.detailedExecutionsCache.delete(firstKey);
      }
      state.detailedExecutionsCache.set(id, {
        data,
        timestamp: Date.now(),
      });
    },
    CLEAR_DETAILED_CACHE(state) {
      state.detailedExecutionsCache.clear();
    },
    REMOVE_FROM_CACHE(state, id) {
      state.detailedExecutionsCache.delete(id);
    },
    SET_LAST_FETCH_TIME(state, time) {
      state.lastFetchTime = time;
    },
    SET_PAGINATION(state, { page, pageSize, total }) {
      if (page !== undefined) state.currentPage = page;
      if (pageSize !== undefined) state.pageSize = pageSize;
      if (total !== undefined) state.totalExecutions = total;
    },
  },
  actions: {
    async fetchExecutions({ commit, state }, { page = 1, pageSize = 50, forceRefresh = false } = {}) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.error('No authentication token found');
          return;
        }

        // Check if we need to refresh (avoid unnecessary fetches)
        const now = Date.now();
        const timeSinceLastFetch = state.lastFetchTime ? now - state.lastFetchTime : Infinity;
        if (!forceRefresh && timeSinceLastFetch < 5000) {
          // Don't refetch if less than 5 seconds since last fetch
          return;
        }

        // Fetch all execution types in PARALLEL for faster loading
        // (Previously sequential - 3x slower)
        const headers = { Authorization: `Bearer ${token}` };

        const [workflowResult, goalsResult, agentResult] = await Promise.allSettled([
          axios.get(`${API_CONFIG.BASE_URL}/executions`, { headers }),
          axios.get(`${API_CONFIG.BASE_URL}/goals`, { headers }),
          axios.get(`${API_CONFIG.BASE_URL}/executions/agents/list`, { headers }),
        ]);

        // Process workflow executions
        if (workflowResult.status === 'fulfilled') {
          const summaries = (Array.isArray(workflowResult.value.data) ? workflowResult.value.data : []).map((exec) => ({
            id: exec.id,
            workflowName: exec.workflowName,
            status: exec.status,
            startTime: exec.startTime,
            endTime: exec.endTime,
            creditsUsed: exec.creditsUsed,
            nodeCount: exec.nodeExecutions?.length || 0,
          }));
          commit('SET_EXECUTION_SUMMARIES', summaries);
        } else {
          console.warn('Error fetching workflow executions:', workflowResult.reason);
          commit('SET_EXECUTION_SUMMARIES', []);
        }

        // Process goal executions
        if (goalsResult.status === 'fulfilled') {
          const goalSummaries = (goalsResult.value.data.goals || [])
            .filter((goal) => ['executing', 'completed', 'validated', 'needs_review', 'failed', 'stopped'].includes(goal.status))
            .map((goal) => {
              let calculatedEndTime = goal.completed_at || goal.updated_at;
              if (goal.task_count && goal.completed_tasks === goal.task_count) {
                calculatedEndTime = goal.updated_at;
              }
              return {
                id: `goal-${goal.id}`,
                goalId: goal.id,
                type: 'goal',
                workflowName: goal.title || 'Untitled Goal',
                status: goal.status,
                startTime: goal.created_at,
                endTime: calculatedEndTime,
                creditsUsed: goal.credits_used || 0,
                nodeCount: goal.task_count || 0,
                isGoalExecution: true,
              };
            });
          commit('SET_GOAL_EXECUTION_SUMMARIES', goalSummaries);
        } else {
          console.warn('Error fetching goal executions:', goalsResult.reason);
          commit('SET_GOAL_EXECUTION_SUMMARIES', []);
        }

        // Process agent executions
        if (agentResult.status === 'fulfilled') {
          const agentSummaries = (Array.isArray(agentResult.value.data) ? agentResult.value.data : []).map((exec) => ({
            id: `agent-${exec.id}`,
            agentExecutionId: exec.id,
            agentId: exec.agentId,
            type: 'agent',
            workflowName: exec.agentName || 'Agent Chat',
            status: exec.status,
            startTime: exec.startTime,
            endTime: exec.endTime,
            creditsUsed: exec.creditsUsed || 0,
            nodeCount: exec.toolCallsCount || 0,
            isAgentExecution: true,
            provider: exec.provider,
            model: exec.model,
          }));
          commit('SET_AGENT_EXECUTION_SUMMARIES', agentSummaries);
        } else {
          console.warn('Error fetching agent executions:', agentResult.reason);
          commit('SET_AGENT_EXECUTION_SUMMARIES', []);
        }

        commit('SET_LAST_FETCH_TIME', Date.now());
        commit('SET_PAGINATION', {
          page,
          pageSize,
          total: (state.executionSummaries?.length || 0) + (state.goalExecutionSummaries?.length || 0) + (state.agentExecutionSummaries?.length || 0),
        });
      } catch (error) {
        console.error('Error fetching executions:', error);
      }
    },

    async fetchExecutionDetails({ commit, state }, executionId) {
      try {
        // Check cache first - use 5 minute TTL for execution details
        // (execution data doesn't change after completion)
        const cached = state.detailedExecutionsCache.get(executionId);
        if (cached && Date.now() - cached.timestamp < 300000) {
          return cached.data;
        }

        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        // Check if this is a goal execution
        if (executionId.startsWith('goal-')) {
          const goalId = executionId.replace('goal-', '');
          const response = await axios.get(`${API_CONFIG.BASE_URL}/goals/${goalId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const goalData = response.data.goal;

          // Calculate endTime from tasks if available
          let calculatedEndTime = goalData.completed_at || goalData.updated_at;
          if (goalData.tasks && goalData.tasks.length > 0) {
            const taskEndTimes = goalData.tasks
              .map((t) => t.completed_at)
              .filter((t) => t)
              .map((t) => new Date(t));

            if (taskEndTimes.length > 0) {
              const latestTaskEnd = new Date(Math.max(...taskEndTimes));
              calculatedEndTime = latestTaskEnd.toISOString();
            }
          }

          const detailedData = {
            id: executionId,
            goalId: goalData.id,
            type: 'goal',
            workflowName: goalData.title || 'Untitled Goal',
            status: goalData.status,
            startTime: goalData.created_at,
            endTime: calculatedEndTime,
            creditsUsed: goalData.credits_used || 0,
            nodeExecutions: goalData.tasks || [],
            log: null,
            isGoalExecution: true,
            goalDetails: goalData,
          };

          commit('SET_DETAILED_EXECUTION', { id: executionId, data: detailedData });
          return detailedData;
        } else if (executionId.startsWith('agent-')) {
          // Fetch agent execution details
          const agentExecId = executionId.replace('agent-', '');
          const response = await axios.get(`${API_CONFIG.BASE_URL}/executions/agents/${agentExecId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const agentData = response.data;

          const detailedData = {
            id: executionId,
            agentExecutionId: agentData.id,
            agentId: agentData.agentId,
            type: 'agent',
            workflowName: agentData.agentName || 'Agent Chat',
            status: agentData.status,
            startTime: agentData.startTime,
            endTime: agentData.endTime,
            creditsUsed: agentData.creditsUsed || 0,
            nodeExecutions: (agentData.toolExecutions || []).map((te) => ({
              id: te.id,
              node_id: te.toolCallId || te.id,
              name: te.toolName,
              status: te.status,
              start_time: te.startTime,
              end_time: te.endTime,
              input: te.input,
              output: te.output,
              error: te.error,
              credits_used: te.creditsUsed || 0,
            })),
            log: null,
            isAgentExecution: true,
            agentDetails: agentData,
            initialPrompt: agentData.initialPrompt,
            finalResponse: agentData.finalResponse,
            provider: agentData.provider,
            model: agentData.model,
          };

          commit('SET_DETAILED_EXECUTION', { id: executionId, data: detailedData });
          return detailedData;
        } else {
          // Fetch workflow execution details
          const response = await axios.get(`${API_CONFIG.BASE_URL}/executions/${executionId}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const detailedData = response.data;
          commit('SET_DETAILED_EXECUTION', { id: executionId, data: detailedData });
          return detailedData;
        }
      } catch (error) {
        console.error('Error fetching execution details:', error);
        throw error;
      }
    },

    clearCache({ commit }) {
      commit('CLEAR_DETAILED_CACHE');
    },

    removeFromCache({ commit }, executionId) {
      commit('REMOVE_FROM_CACHE', executionId);
    },
  },
  getters: {
    // Return only summary data for list view
    getExecutions: (state) => {
      return [...state.executionSummaries, ...state.goalExecutionSummaries, ...state.agentExecutionSummaries];
    },
    getWorkflowExecutions: (state) => state.executionSummaries,
    getGoalExecutions: (state) => state.goalExecutionSummaries,
    getAgentExecutions: (state) => state.agentExecutionSummaries,
    getDetailedExecution: (state) => (id) => {
      const cached = state.detailedExecutionsCache.get(id);
      return cached?.data || null;
    },
    getLastFetchTime: (state) => state.lastFetchTime,
    getPagination: (state) => ({
      currentPage: state.currentPage,
      pageSize: state.pageSize,
      totalExecutions: state.totalExecutions,
    }),
  },
};
