import { API_CONFIG } from '@/tt.config.js';

// Track active timeouts for cleanup
const activeTimeouts = new Set();

function clearAllTimeouts() {
  activeTimeouts.forEach((timeoutId) => {
    clearTimeout(timeoutId);
  });
  activeTimeouts.clear();
}

const state = {
  goals: [],
  isLoading: false,
  isCreatingGoal: false,
  error: null,
  goalStatusSubscriptions: new Map(), // Track monitoring intervals
  lastFetchTime: null, // Add caching timestamp
  requestCache: new Map(), // Cache for API responses
  isFetchingGoals: false, // Request deduplication flag
};

const getters = {
  allGoals: (state) => state.goals,

  activeGoals: (state) => {
    return state.goals.filter((goal) => ['planning', 'executing', 'paused'].includes(goal.status));
  },

  completedGoals: (state) => {
    return state.goals.filter((goal) => goal.status === 'completed');
  },

  recentGoals: (state) => {
    return state.goals.filter((goal) => ['completed', 'failed', 'stopped'].includes(goal.status)).slice(0, 12); // Show last 12
  },

  goalsWithTasks: (state) => {
    return state.goals.filter((goal) => goal.tasks && goal.tasks.length > 0);
  },

  getGoalById: (state) => (id) => {
    return state.goals.find((goal) => goal.id === id);
  },

  isLoading: (state) => state.isLoading,
  isCreatingGoal: (state) => state.isCreatingGoal,
  error: (state) => state.error,

  getGoalProgress: (state) => (goal) => {
    if (goal.progress !== undefined) return goal.progress;
    if (!goal.task_count) return 0;
    return Math.round((goal.completed_tasks / goal.task_count) * 100);
  },

  getGoalTasksProgress: (state) => (goal) => {
    // First try to use the task_count and completed_tasks from the database
    if (goal.task_count !== undefined && goal.completed_tasks !== undefined) {
      return `${goal.completed_tasks}/${goal.task_count} tasks`;
    }

    // Fallback to calculating from tasks array if available
    if (goal.tasks && goal.tasks.length > 0) {
      const completed = goal.tasks.filter((t) => t.status === 'completed').length;
      return `${completed}/${goal.tasks.length} tasks`;
    }

    // Last resort - show 0/0 only if we truly have no task information
    return '0/0 tasks';
  },

  goalStatusSubscriptions: (state) => state.goalStatusSubscriptions,
};

const mutations = {
  SET_LOADING(state, loading) {
    state.isLoading = loading;
  },

  SET_CREATING_GOAL(state, creating) {
    state.isCreatingGoal = creating;
  },

  SET_ERROR(state, error) {
    state.error = error;
  },

  SET_GOALS(state, goals) {
    state.goals = goals;
  },

  ADD_GOAL(state, goal) {
    state.goals.unshift(goal);
  },

  UPDATE_GOAL(state, updatedGoal) {
    const index = state.goals.findIndex((goal) => goal.id === updatedGoal.id);
    if (index !== -1) {
      state.goals.splice(index, 1, { ...state.goals[index], ...updatedGoal });
    }
  },

  REMOVE_GOAL(state, goalId) {
    const index = state.goals.findIndex((goal) => goal.id === goalId);
    if (index !== -1) {
      state.goals.splice(index, 1);
    }
  },

  ADD_GOAL_SUBSCRIPTION(state, { goalId, subscription }) {
    state.goalStatusSubscriptions.set(goalId, subscription);
  },

  REMOVE_GOAL_SUBSCRIPTION(state, goalId) {
    const subscription = state.goalStatusSubscriptions.get(goalId);
    if (subscription) {
      // Call the cleanup function instead of clearInterval
      if (typeof subscription === 'function') {
        subscription();
      } else {
        clearInterval(subscription);
      }
      state.goalStatusSubscriptions.delete(goalId);
    }
  },

  CLEAR_ALL_SUBSCRIPTIONS(state) {
    state.goalStatusSubscriptions.forEach((subscription) => {
      // Call the cleanup function instead of clearInterval
      if (typeof subscription === 'function') {
        subscription();
      } else {
        clearInterval(subscription);
      }
    });
    state.goalStatusSubscriptions.clear();
  },

  CLEAR_GOALS(state) {
    // Clear all subscriptions first
    state.goalStatusSubscriptions.forEach((subscription) => {
      if (typeof subscription === 'function') {
        subscription();
      } else {
        clearInterval(subscription);
      }
    });
    state.goalStatusSubscriptions.clear();

    // Clear all state
    state.goals = [];
    state.isLoading = false;
    state.isCreatingGoal = false;
    state.error = null;
    state.lastFetchTime = null;
    state.requestCache.clear();
    state.isFetchingGoals = false;
  },
  SET_FETCHING_GOALS(state, isFetching) {
    state.isFetchingGoals = isFetching;
  },
};

const actions = {
  async fetchGoals({ commit, state, dispatch }) {
    // Request deduplication - prevent duplicate concurrent calls
    if (state.isFetchingGoals) {
      return;
    }

    // Cache for 5 minutes (increased from no cache)
    const now = Date.now();
    if (state.lastFetchTime && now - state.lastFetchTime < 5 * 60 * 1000 && state.goals.length > 0) {
      return;
    }

    commit('SET_FETCHING_GOALS', true);
    commit('SET_LOADING', true);
    commit('SET_ERROR', null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to fetch goals');

      const data = await response.json();

      // Backend returns goals data
      const goals = data.goals || [];

      commit('SET_GOALS', goals);

      // Start monitoring for executing/paused goals
      for (const goal of goals) {
        if (['executing', 'paused'].includes(goal.status)) {
          dispatch('monitorGoalProgress', goal.id);
        }
      }
    } catch (error) {
      console.error('Error fetching goals:', error);
      commit('SET_ERROR', error.message);
    } finally {
      commit('SET_LOADING', false);
      commit('SET_FETCHING_GOALS', false);
    }
  },

  async createGoal({ commit, dispatch, rootState }, { text, priority = 'medium' }) {
    commit('SET_CREATING_GOAL', true);
    commit('SET_ERROR', null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // Get user's configured provider and model from aiProvider store
      const provider = rootState.aiProvider?.selectedProvider?.toLowerCase() || 'openai';
      const model = rootState.aiProvider?.selectedModel || 'gpt-4o-mini';

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/create`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text,
          priority,
          provider,
          model,
        }),
      });

      if (!response.ok) throw new Error('Failed to create goal');

      const data = await response.json();

      // Add goal to local state
      const newGoal = {
        id: data.goal.goalId,
        title: data.goal.title,
        description: data.goal.description,
        status: 'planning',
        priority,
        created_at: new Date().toISOString(),
        tasks: data.goal.tasks || [],
        task_count: data.goal.tasks?.length || 0,
        completed_tasks: 0,
        provider: data.agent?.provider || provider,
        model: data.agent?.model || model,
      };

      commit('ADD_GOAL', newGoal);

      // Automatically execute the goal (it's already started by the backend, but this ensures monitoring)
      await dispatch('executeGoal', data.goal.goalId);

      return newGoal;
    } catch (error) {
      console.error('Error creating goal:', error);
      commit('SET_ERROR', error.message);
      throw error;
    } finally {
      commit('SET_CREATING_GOAL', false);
    }
  },

  async executeGoal({ commit, dispatch, rootState }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // Get user's configured provider and model from aiProvider store
      const provider = rootState.aiProvider?.selectedProvider?.toLowerCase() || 'openai';
      const model = rootState.aiProvider?.selectedModel || 'gpt-4o-mini';

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/execute`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          model,
        }),
      });

      if (!response.ok) throw new Error('Failed to execute goal');

      const data = await response.json();

      // Update goal status with provider info
      commit('UPDATE_GOAL', {
        id: goalId,
        status: 'executing',
        provider: data.agent?.provider || provider,
        model: data.agent?.model || model,
      });

      // Start monitoring progress
      dispatch('monitorGoalProgress', goalId);
    } catch (error) {
      console.error('Error executing goal:', error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async pauseGoal({ commit, dispatch }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/pause`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to pause goal');

      commit('UPDATE_GOAL', { id: goalId, status: 'paused' });
      commit('REMOVE_GOAL_SUBSCRIPTION', goalId);
    } catch (error) {
      console.error('Error pausing goal:', error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async resumeGoal({ commit, dispatch }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/resume`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to resume goal');

      commit('UPDATE_GOAL', { id: goalId, status: 'executing' });
      dispatch('monitorGoalProgress', goalId);
    } catch (error) {
      console.error('Error resuming goal:', error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async deleteGoal({ commit }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete goal');

      commit('REMOVE_GOAL_SUBSCRIPTION', goalId);
      commit('REMOVE_GOAL', goalId);
    } catch (error) {
      console.error('Error deleting goal:', error);
      commit('SET_ERROR', error.message);
      throw error;
    }
  },

  async fetchGoalTasks({ commit }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) return;

      const data = await response.json();
      if (data.goal.tasks) {
        commit('UPDATE_GOAL', {
          id: goalId,
          tasks: data.goal.tasks,
        });
      }
    } catch (error) {
      console.error('Error fetching goal tasks:', error);
    }
  },

  monitorGoalProgress({ commit, getters, state }, goalId) {
    // Don't start monitoring if already monitoring
    if (getters.goalStatusSubscriptions?.has?.(goalId)) {
      return;
    }

    // Check if page is visible to avoid unnecessary polling
    const isPageVisible = () => !document.hidden;

    // Adaptive polling interval based on goal status
    const getPollingInterval = (status) => {
      if (['completed', 'failed', 'stopped'].includes(status)) return null;
      if (status === 'executing') return 5000; // 5 seconds for active goals
      return 10000; // 10 seconds for other statuses
    };

    let currentInterval = 5000; // Start with 5 seconds
    let pollTimeout;

    const pollGoalStatus = async () => {
      try {
        // Skip polling if page is not visible
        if (!isPageVisible()) {
          pollTimeout = setTimeout(pollGoalStatus, currentInterval * 2); // Double interval when hidden
          return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
          commit('REMOVE_GOAL_SUBSCRIPTION', goalId);
          return;
        }

        // Check cache first to avoid duplicate requests
        const cacheKey = `goal_${goalId}_status`;
        const cachedData = state.requestCache.get(cacheKey);
        const now = Date.now();

        if (cachedData && now - cachedData.timestamp < 2000) {
          // 2 second cache
          // Use cached data and schedule next poll
          const nextInterval = getPollingInterval(cachedData.data.status);
          if (nextInterval) {
            pollTimeout = setTimeout(pollGoalStatus, nextInterval);
          }
          return;
        }

        // Fetch status data with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          activeTimeouts.delete(timeoutId);
        }, 10000); // 10 second timeout
        activeTimeouts.add(timeoutId);

        const statusResponse = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/status`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);

        if (!statusResponse.ok) {
          console.error(`[Goals] Failed to fetch status for goal ${goalId}: ${statusResponse.status}`);
          commit('REMOVE_GOAL_SUBSCRIPTION', goalId);
          return;
        }

        const status = await statusResponse.json();

        // Cache the response
        state.requestCache.set(cacheKey, {
          data: status,
          timestamp: now,
        });

        // Update goal in state
        const updateData = {
          id: goalId,
          status: status.status,
          progress: status.progress,
          currentTasks: status.currentTasks,
        };

        // Update tasks if available
        if (status.tasks) {
          updateData.completed_tasks = status.tasks.completed;
          updateData.task_count = status.tasks.total;
        }

        // Update individual task details
        if (status.allTasks) {
          updateData.tasks = status.allTasks;
        }

        commit('UPDATE_GOAL', updateData);

        // Determine next polling interval
        currentInterval = getPollingInterval(status.status);

        // Stop monitoring if goal is complete
        if (!currentInterval || ['completed', 'failed', 'stopped'].includes(status.status)) {
          // Fetch evaluation if goal completed or validated
          if (['completed', 'validated', 'needs_review'].includes(status.status)) {
            try {
              const evaluation = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/evaluation`, {
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
              });

              if (evaluation.ok) {
                const evalData = await evaluation.json();
                commit('UPDATE_GOAL', {
                  id: goalId,
                  evaluation: evalData,
                });
              }
            } catch (evalError) {
              console.log(`[Goals] No evaluation available yet for goal ${goalId}`);
            }
          }

          commit('REMOVE_GOAL_SUBSCRIPTION', goalId);
          return;
        }

        // Schedule next poll
        pollTimeout = setTimeout(pollGoalStatus, currentInterval);
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn(`[Goals] Request timeout for goal ${goalId}`);
        } else {
          console.error(`Error monitoring goal ${goalId} progress:`, error);
        }

        // Retry with exponential backoff on error
        const retryInterval = Math.min(currentInterval * 2, 30000); // Max 30 seconds
        pollTimeout = setTimeout(pollGoalStatus, retryInterval);
      }
    };

    // Start polling
    pollGoalStatus();

    // Store the cleanup function instead of interval ID
    const cleanup = () => {
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }
    };

    commit('ADD_GOAL_SUBSCRIPTION', { goalId, subscription: cleanup });
  },

  getFilteredTasks({}, { tasks, filter }) {
    if (!tasks) return [];
    if (filter === 'all') return tasks;
    return tasks.filter((task) => task.status === filter);
  },

  clearAllSubscriptions({ commit }) {
    commit('CLEAR_ALL_SUBSCRIPTIONS');
  },

  async refreshGoalStatus({ commit, dispatch }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/status`, {
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`[Goals] Failed to refresh status for goal ${goalId}: ${response.status}`);
        return;
      }

      const status = await response.json();

      // Update goal in state
      const updateData = {
        id: goalId,
        status: status.status,
        progress: status.progress,
        currentTasks: status.currentTasks,
      };

      // Update tasks if available
      if (status.tasks) {
        updateData.completed_tasks = status.tasks.completed;
        updateData.task_count = status.tasks.total;
      }

      // Update individual task details
      if (status.allTasks) {
        updateData.tasks = status.allTasks;
      }

      commit('UPDATE_GOAL', updateData);

      // Start monitoring if goal is still executing
      if (status.status === 'executing') {
        dispatch('monitorGoalProgress', goalId);
      }

      return status;
    } catch (error) {
      console.error(`Error refreshing goal ${goalId} status:`, error);
      throw error;
    }
  },

  async updateTaskStatus({ commit, getters }, { goalId, taskId, status, progress, output, error }) {
    try {
      const goal = getters.getGoalById(goalId);
      if (!goal || !goal.tasks) return;

      // Find and update the specific task
      const updatedTasks = goal.tasks.map((task) => {
        if (task.id === taskId || task.task_id === taskId) {
          return {
            ...task,
            status,
            progress: progress !== undefined ? progress : task.progress,
            output: output !== undefined ? output : task.output,
            error: error !== undefined ? error : task.error,
            updated_at: new Date().toISOString(),
          };
        }
        return task;
      });

      // Calculate overall goal progress
      const completedTasks = updatedTasks.filter((task) => task.status === 'completed').length;
      const totalTasks = updatedTasks.length;
      const goalProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      // Determine goal status based on task statuses
      let goalStatus = goal.status;
      if (completedTasks === totalTasks && totalTasks > 0) {
        goalStatus = 'completed';
      } else if (updatedTasks.some((task) => task.status === 'failed')) {
        goalStatus = 'failed';
      } else if (updatedTasks.some((task) => task.status === 'running')) {
        goalStatus = 'executing';
      }

      // Update the goal with new task data
      commit('UPDATE_GOAL', {
        id: goalId,
        tasks: updatedTasks,
        progress: goalProgress,
        completed_tasks: completedTasks,
        task_count: totalTasks,
        status: goalStatus,
      });
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  },

  async fetchGoalArtifact({ commit }, { goalId, artifactKey }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/artifacts/${artifactKey}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch artifact: ${response.status}`);
      }

      const data = await response.json();
      return data.artifact;
    } catch (error) {
      console.error('Error fetching goal artifact:', error);
      throw error;
    }
  },

  async fetchGoalArtifactFiles({ commit }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/artifact-files`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch artifact files: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching goal artifact files:', error);
      throw error;
    }
  },

  async fetchGoalArtifactFile({ commit }, { goalId, filename }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/artifact-files/${filename}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch artifact file: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching goal artifact file:', error);
      throw error;
    }
  },

  async fetchGoalArtifactFileContent({ commit }, { goalId, filename }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/artifact-files/${filename}/content`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Try to get error details from response
        let errorMessage = `Failed to fetch artifact file content: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          // If we can't parse the error response, check if it's HTML
          const responseText = await response.text();
          if (responseText.includes('<!DOCTYPE')) {
            errorMessage = 'Server returned HTML instead of JSON - possible authentication or routing issue';
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching goal artifact file content:', error);
      throw error;
    }
  },

  async downloadGoalArtifactFile({ commit }, { goalId, filename }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/artifact-files/${filename}/download`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download artifact file: ${response.status}`);
      }

      // Get the filename from the response headers or use the original filename
      const contentDisposition = response.headers.get('Content-Disposition');
      let downloadFilename = filename;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          downloadFilename = filenameMatch[1];
        }
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      return { success: true, filename: downloadFilename };
    } catch (error) {
      console.error('Error downloading goal artifact file:', error);
      throw error;
    }
  },

  async fetchGoalEvaluation({ commit }, goalId) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/evaluation`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null; // No evaluation exists yet
        }
        throw new Error(`Failed to fetch evaluation: ${response.status}`);
      }

      const evaluation = await response.json();

      // Update goal with evaluation data
      commit('UPDATE_GOAL', {
        id: goalId,
        evaluation,
      });

      return evaluation;
    } catch (error) {
      console.error('Error fetching goal evaluation:', error);
      throw error;
    }
  },

  async evaluateGoal({ commit, rootState }, { goalId, evaluationType = 'automatic' }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // Get user's configured provider and model
      const provider = rootState.aiProvider?.selectedProvider?.toLowerCase() || 'openai';
      const model = rootState.aiProvider?.selectedModel || 'gpt-4o-mini';

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/evaluate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          evaluation_type: evaluationType,
          provider,
          model,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to evaluate goal: ${response.status}`);
      }

      const evaluation = await response.json();

      // Update goal with evaluation data
      commit('UPDATE_GOAL', {
        id: goalId,
        evaluation,
        status: evaluation.status,
      });

      return evaluation;
    } catch (error) {
      console.error('Error evaluating goal:', error);
      throw error;
    }
  },

  async saveAsGoldenStandard({ commit }, { goalId, category }) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/goals/${goalId}/golden-standard`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ category }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save as golden standard: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error saving golden standard:', error);
      throw error;
    }
  },

  async fetchGoldenStandards({ commit }, category = null) {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const url = category
        ? `${API_CONFIG.BASE_URL}/goals/golden-standards/list?category=${category}`
        : `${API_CONFIG.BASE_URL}/goals/golden-standards/list`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch golden standards: ${response.status}`);
      }

      const data = await response.json();
      return data.standards || [];
    } catch (error) {
      console.error('Error fetching golden standards:', error);
      throw error;
    }
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
  // Add cleanup method
  cleanup() {
    clearAllTimeouts();
  },
};
