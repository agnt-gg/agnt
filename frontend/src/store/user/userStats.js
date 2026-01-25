import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import { isEqual } from 'lodash-es'; // Import isEqual for deep comparison

// Track active timeouts for cleanup
const activeTimeouts = new Set();

function clearAllTimeouts() {
  activeTimeouts.forEach((timeoutId) => {
    clearTimeout(timeoutId);
  });
  activeTimeouts.clear();
}

// --- Helper Functions (can be moved to a utils file if used elsewhere) ---
const formatDate = (date) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
};

// Calculate level from AGNT score with max level 100
// Memoized to avoid recalculating for same score
const levelCache = new Map();
const MAX_LEVEL_CACHE_SIZE = 100;

const calculateLevelFromScore = (score) => {
  // Check memoization cache first
  if (levelCache.has(score)) {
    return levelCache.get(score);
  }

  const MAX_LEVEL = 100;

  // Calculate XP needed for level 100 using exponential curve
  // We want the curve to scale so that reaching level 100 is challenging but achievable
  // Using formula: XP for level N = baseXP * (growthRate ^ (N - 1))
  const baseXP = 1000; // XP needed for level 2
  const growthRate = 1.05; // 5% increase per level

  // Calculate current level
  let level = 1;
  let xpAccumulated = 0;

  for (let i = 1; i < MAX_LEVEL; i++) {
    const xpForThisLevel = Math.floor(baseXP * Math.pow(growthRate, i - 1));
    if (score >= xpAccumulated + xpForThisLevel) {
      level = i + 1;
      xpAccumulated += xpForThisLevel;
    } else {
      break;
    }
  }

  let result;
  // If score exceeds max level requirements, cap at 100
  if (level >= MAX_LEVEL) {
    result = {
      level: MAX_LEVEL,
      currentXP: score,
      xpNeeded: score, // At max level, show full progress
      totalXP: score,
      progressPercent: 100,
    };
  } else {
    // Calculate XP needed for next level
    const xpForNextLevel = Math.floor(baseXP * Math.pow(growthRate, level - 1));
    const currentXP = score - xpAccumulated;
    const progressPercent = Math.min(100, Math.max(0, (currentXP / xpForNextLevel) * 100));

    result = {
      level,
      currentXP,
      xpNeeded: xpForNextLevel,
      totalXP: score,
      progressPercent,
    };
  }

  // Cache the result (with LRU eviction)
  if (levelCache.size >= MAX_LEVEL_CACHE_SIZE) {
    const oldestKey = levelCache.keys().next().value;
    levelCache.delete(oldestKey);
  }
  levelCache.set(score, result);

  return result;
};

const fillMissingDates = (data, startDate, endDate) => {
  const dateMap = new Map(data.map((item) => [item.date, item.credits_used]));
  const result = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate); // Use the calculated end date

  // Ensure loop includes the end date by comparing with the day *after* the desired end date
  const loopEndDate = new Date(end);
  // loopEndDate.setDate(loopEndDate.getDate() + 1); // This caused an off-by-one, compare directly

  while (currentDate < end) {
    // Iterate up to, but not including, the day *after* the target end date
    const dateString = currentDate.toISOString().split('T')[0];
    result.push({
      date: formatDate(currentDate), // Format the date here
      credits_used: dateMap.get(dateString) || 0,
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return result;
};
// --- End Helper Functions ---

export default {
  namespaced: true,
  state: {
    tokens: 0,
    tokensPerDay: 0,
    totalWorkflows: 0,
    totalCustomTools: 0,
    totalSecondsAutomated: 0, // Add lifetime total seconds
    totalExecutions: 0, // Add total executions from API
    gameProgress: 2, // Initialize with 2% progress
    agentActivity: {
      labels: [],
      data: [],
      lastFetchTime: null,
      isLoading: false,
    },
    // Add state for Tokens Generated chart
    tokensGeneratedActivity: {
      labels: [],
      data: [],
      lastFetchTime: null,
      isLoading: false,
    },
    // --- Credits Activity State ---
    creditsActivity: {
      labels: [],
      data: [],
      rawData: [], // Store raw data for view switching
      lastFetchTime: null,
      isLoading: false,
      activityDays: 14, // Track the current time range
    },
    // --- New State for Gameplay ---
    gameState: {
      currentPhase: null,
      unlockedFeatures: [],
      worldState: {},
      isLoading: false,
      error: null,
      lastFetchTime: null,
    },
    // --- New State ---
    tokenActivity: {
      labels: [],
      earned: [],
      spent: [],
      isLoading: false,
    },
    leaderboard: {
      data: [],
      isLoading: false,
    },
    loginStreak: 0,
    level: 1, // Will be calculated from AGNT score
    xp: 0, // Will be calculated from AGNT score
    tickRateTier: 'Basic',
    roiPercentage: 0,
    missedTokensYesterday: 0,
    // Referral data
    referralBalance: 0, // Total score
    referralBreakdown: {
      personalBalance: 0, // Direct earnings
      networkScore: 0, // Network contribution
      totalScore: 0, // Total
    },
    referralTree: {
      tree: [],
      stats: {
        total: 0,
        active: 0,
        inactive: 0,
        level1: 0,
        level2: 0,
        level3: 0,
      },
      isLoading: false,
      lastFetchTime: null,
    },
    // --- AGNT Score - Calculated once and stored ---
    agntScore: {
      total: 0,
      formatted: '0',
      breakdown: {
        productivity: 0,
        engagement: 0,
        infrastructure: 0,
        efficiency: 0,
        network: 0,
        scale: 0,
      },
      // Detailed breakdown showing ALL point sources
      details: {
        productivity: {
          secondsAutomated: 0,
          completedGoals: 0,
          executionSuccessRate: 0,
        },
        engagement: {
          activeGoals: 0,
          activeAgents: 0,
          activeWorkflows: 0,
          loginStreak: 0,
          dailyRuns: 0,
        },
        infrastructure: {
          totalWorkflows: 0,
          customTools: 0,
          integrations: 0,
          toolInventory: 0,
        },
        efficiency: {
          workflowSuccessRate: 0,
          integrationHealth: 0,
          executionLatency: 0,
        },
        network: {
          referralBalance: 0,
        },
        scale: {
          totalExecutions: 0,
          totalNodeExecutions: 0,
          nodeSuccessRate: 0,
          totalAgents: 0,
        },
      },
    },
    _isCalculatingScore: false, // Flag to prevent duplicate calculations
    // --- End New State ---
  },
  mutations: {
    SET_STATS(state, { tokens, totalWorkflows, totalCustomTools, totalSecondsAutomated, totalExecutions /*, tokensPerDay */ }) {
      state.tokens = tokens;
      state.totalWorkflows = totalWorkflows;
      state.totalCustomTools = totalCustomTools;
      state.totalSecondsAutomated = totalSecondsAutomated || 0;
      state.totalExecutions = totalExecutions || 0;
      state.tokensPerDay = 0;
    },
    SET_AGENT_ACTIVITY_DATA(state, { labels, data }) {
      state.agentActivity.labels = labels;
      state.agentActivity.data = data;
    },
    SET_AGENT_ACTIVITY_META(state, { isLoading, lastFetchTime }) {
      if (lastFetchTime !== undefined) {
        state.agentActivity.lastFetchTime = lastFetchTime;
      }
      state.agentActivity.isLoading = isLoading;
    },
    SET_TOKENS_GENERATED_ACTIVITY_DATA(state, { labels, data }) {
      state.tokensGeneratedActivity.labels = labels;
      state.tokensGeneratedActivity.data = data;
    },
    SET_TOKENS_GENERATED_ACTIVITY_META(state, { isLoading, lastFetchTime }) {
      if (lastFetchTime !== undefined) {
        state.tokensGeneratedActivity.lastFetchTime = lastFetchTime;
      }
      state.tokensGeneratedActivity.isLoading = isLoading;
    },
    SET_CREDITS_ACTIVITY_DATA(state, { labels, data, rawData, activityDays }) {
      state.creditsActivity.labels = labels;
      state.creditsActivity.data = data;
      state.creditsActivity.rawData = rawData;
      state.creditsActivity.activityDays = activityDays;
    },
    SET_CREDITS_ACTIVITY_META(state, { isLoading, lastFetchTime }) {
      if (lastFetchTime !== undefined) {
        state.creditsActivity.lastFetchTime = lastFetchTime;
      }
      state.creditsActivity.isLoading = isLoading;
    },
    SET_GAME_PROGRESS(state, progress) {
      state.gameProgress = progress;
    },
    // --- New Mutations for Gameplay ---
    SET_GAME_STATE(state, gameStateData) {
      // Filter out properties that shouldn't overwrite if they don't exist in payload
      const validKeys = ['currentPhase', 'unlockedFeatures', 'worldState'];
      const filteredData = {};
      validKeys.forEach((key) => {
        if (gameStateData.hasOwnProperty(key)) {
          filteredData[key] = gameStateData[key];
        }
      });

      state.gameState = {
        ...state.gameState, // Keep existing non-updated fields
        ...filteredData, // Apply updates
        isLoading: false,
        error: null,
        lastFetchTime: Date.now(),
      };
    },
    SET_GAME_STATE_LOADING(state, isLoading) {
      state.gameState.isLoading = isLoading;
      if (isLoading) {
        state.gameState.error = null; // Clear error when starting load
      }
    },
    SET_GAME_STATE_ERROR(state, error) {
      state.gameState.isLoading = false;
      state.gameState.error = error;
    },
    SET_TOKEN_ACTIVITY(state, { labels, earned, spent }) {
      state.tokenActivity = {
        ...state.tokenActivity,
        labels,
        earned,
        spent,
        isLoading: false,
      };
    },
    SET_TOKEN_ACTIVITY_LOADING(state, isLoading) {
      state.tokenActivity.isLoading = isLoading;
    },
    SET_LEADERBOARD(state, data) {
      state.leaderboard.data = data;
      state.leaderboard.isLoading = false;
    },
    SET_LEADERBOARD_LOADING(state, isLoading) {
      state.leaderboard.isLoading = isLoading;
    },
    SET_USER_PROGRESS(state, { level, xp, tickRateTier, loginStreak, roiPercentage, missedTokensYesterday }) {
      state.level = level || state.level;
      state.xp = xp || state.xp;
      state.tickRateTier = tickRateTier || state.tickRateTier;
      state.loginStreak = loginStreak || state.loginStreak;
      state.roiPercentage = roiPercentage || state.roiPercentage;
      state.missedTokensYesterday = missedTokensYesterday || state.missedTokensYesterday;
    },
    SET_REFERRAL_TREE(state, { tree, stats }) {
      state.referralTree.tree = tree;
      state.referralTree.stats = stats;
      state.referralTree.isLoading = false;
      state.referralTree.lastFetchTime = Date.now();
    },
    SET_REFERRAL_TREE_LOADING(state, isLoading) {
      state.referralTree.isLoading = isLoading;
    },
    SET_REFERRAL_BALANCE(state, balance) {
      state.referralBalance = balance;
    },
    SET_REFERRAL_BREAKDOWN(state, { personalBalance, networkScore, totalScore, networkBreakdown }) {
      state.referralBreakdown = {
        personalBalance,
        networkScore,
        totalScore,
        networkBreakdown: networkBreakdown || [], // Store the detailed breakdown from API
      };
    },
    SET_AGNT_SCORE(state, { total, formatted, breakdown, details }) {
      state.agntScore = {
        total,
        formatted,
        breakdown,
        details,
      };
    },
    SET_CALCULATING_SCORE_FLAG(state, isCalculating) {
      state._isCalculatingScore = isCalculating;
    },
    // --- End New Mutations ---
  },
  actions: {
    async fetchStats({ commit, state, dispatch, rootState }) {
      // Check cache first - only fetch if data is older than 30 seconds
      const now = Date.now();
      const lastFetch = state.agentActivity.lastFetchTime;
      if (lastFetch && now - lastFetch < 30000) {
        return;
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.error('No authentication token found');
          return;
        }

        // Get user email for referral balance
        const userEmail = rootState.userAuth?.userEmail;

        // Add request timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          activeTimeouts.delete(timeoutId);
        }, 10000); // 10 second timeout
        activeTimeouts.add(timeoutId);

        // Fetch stats and credits (NO referral balance here - it's fetched separately)
        const requests = [
          axios.get(`${API_CONFIG.BASE_URL}/users/user-stats`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
          axios.get(`${API_CONFIG.REMOTE_URL}/users/credits`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }),
        ];

        const responses = await Promise.all(requests);
        const [statsResponse, creditsResponse] = responses;

        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);

        // --- Process Stats & Tokens ---
        const newTokens = creditsResponse.data.credits || 0;
        const newStatsData = {
          totalWorkflows: statsResponse.data.totalWorkflows || 0,
          totalCustomTools: statsResponse.data.totalCustomTools || 0,
          totalSecondsAutomated: statsResponse.data.totalNodeExecutions || 0, // Use totalNodeExecutions as seconds
          totalExecutions: statsResponse.data.totalExecutions || 0, // Capture total executions from API
        };

        // Only commit SET_STATS if tokens or other stats changed
        if (
          newTokens !== state.tokens ||
          newStatsData.totalWorkflows !== state.totalWorkflows ||
          newStatsData.totalCustomTools !== state.totalCustomTools ||
          newStatsData.totalSecondsAutomated !== state.totalSecondsAutomated ||
          newStatsData.totalExecutions !== state.totalExecutions ||
          0 !== state.tokensPerDay
        ) {
          // Commit using the 'tokens' key
          commit('SET_STATS', { tokens: newTokens, ...newStatsData });
        }

        // Fetch referral balance and tree separately (don't overwrite with old endpoint)
        if (userEmail) {
          dispatch('fetchReferralBalance');
          dispatch('fetchReferralTree');
        }

        // Set fixed login streak of 2 days
        commit('SET_USER_PROGRESS', {
          loginStreak: 2,
          level: state.level,
          xp: state.xp,
          tickRateTier: state.tickRateTier,
          roiPercentage: state.roiPercentage,
          missedTokensYesterday: state.missedTokensYesterday,
        });

        // Update cache timestamp
        commit('SET_AGENT_ACTIVITY_META', { lastFetchTime: now });
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn('[UserStats] Request timeout for fetchStats');
        } else {
          console.error('Error fetching user stats/game state:', error);
        }
        // Optionally set error states for each part if needed
        commit('SET_GAME_STATE_ERROR', error.message || 'Failed to fetch game state');
      }
    },

    async fetchAgentActivity({ commit, state }, { activityDays = 14 } = {}) {
      // Check cache first - only fetch if data is older than 60 seconds
      const now = Date.now();
      const lastFetch = state.agentActivity.lastFetchTime;
      if (lastFetch && now - lastFetch < 60000) {
        return;
      }

      commit('SET_AGENT_ACTIVITY_META', { isLoading: true });

      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 1);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - activityDays);

        // Add request timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          activeTimeouts.delete(timeoutId);
        }, 8000); // 8 second timeout
        activeTimeouts.add(timeoutId);

        const response = await axios.post(
          `${API_CONFIG.BASE_URL}/executions/activity`,
          {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
          },
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);

        const processedData = fillMissingDates(response.data, startDate, endDate);
        const newLabels = processedData.map((item) => item.date);
        const newData = processedData.map((item) => item.credits_used);

        // Only commit if data has changed
        if (!isEqual(newLabels, state.agentActivity.labels) || !isEqual(newData, state.agentActivity.data)) {
          commit('SET_AGENT_ACTIVITY_DATA', { labels: newLabels, data: newData });
        }

        commit('SET_AGENT_ACTIVITY_META', { isLoading: false, lastFetchTime: now });
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn('[UserStats] Request timeout for fetchAgentActivity');
        } else {
          console.error('Error fetching agent activity:', error);
        }
        commit('SET_AGENT_ACTIVITY_META', { isLoading: false, lastFetchTime: state.agentActivity.lastFetchTime });
      }
    },

    // Add action for Tokens Generated chart (with dummy data)
    async fetchTokensGeneratedActivity({ commit }, { activityDays = 14 } = {}) {
      commit('SET_TOKENS_GENERATED_ACTIVITY_META', { isLoading: true });
      try {
        // --- Dummy Data Generation ---
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 1);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - activityDays);

        const dummyData = [];
        let currentDate = new Date(startDate);
        const end = new Date(endDate);

        while (currentDate < end) {
          dummyData.push({
            date: formatDate(currentDate), // Use existing helper
            tokens_generated: Math.floor(Math.random() * 5000) + 1000, // Random value
          });
          currentDate.setDate(currentDate.getDate() + 1);
        }
        // --- End Dummy Data Generation ---

        const newLabels = dummyData.map((item) => item.date);
        const newData = dummyData.map((item) => item.tokens_generated);

        // Simulate API delay
        await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve();
            activeTimeouts.delete(timeoutId);
          }, 300);
          activeTimeouts.add(timeoutId);
        });

        commit('SET_TOKENS_GENERATED_ACTIVITY_DATA', { labels: newLabels, data: newData });
        commit('SET_TOKENS_GENERATED_ACTIVITY_META', { isLoading: false, lastFetchTime: Date.now() });
      } catch (error) {
        console.error('Error generating/fetching dummy tokens generated activity:', error);
        commit('SET_TOKENS_GENERATED_ACTIVITY_META', { isLoading: false }); // Ensure loading is set to false on error
      }
    },

    async fetchCreditsActivity({ commit, state }, { activityDays = 14, isCumulativeView = true } = {}) {
      // Check cache first - only fetch if data is older than 60 seconds OR if time range changed
      const now = Date.now();
      const lastFetch = state.creditsActivity.lastFetchTime;
      const timeRangeChanged = state.creditsActivity.activityDays !== activityDays;

      if (lastFetch && now - lastFetch < 60000 && !timeRangeChanged) {
        return;
      }

      commit('SET_CREDITS_ACTIVITY_META', { isLoading: true });

      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 1);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - activityDays);

        // Add request timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          activeTimeouts.delete(timeoutId);
        }, 8000); // 8 second timeout
        activeTimeouts.add(timeoutId);

        const response = await axios.post(
          `${API_CONFIG.BASE_URL}/executions/activity`,
          {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
          },
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);
        activeTimeouts.delete(timeoutId);

        // Store raw data for view switching
        const rawData = fillMissingDates(response.data, startDate, endDate);

        // Process for cumulative view
        let cumulativeCredits = 0;
        const processedData = rawData.map((item) => {
          if (isCumulativeView) {
            cumulativeCredits += item.credits_used;
            return { ...item, credits_used: cumulativeCredits };
          }
          return item;
        });

        const newLabels = processedData.map((item) => item.date);
        const newData = processedData.map((item) => item.credits_used);

        // Only commit if data has changed or time range changed
        if (!isEqual(newLabels, state.creditsActivity.labels) || !isEqual(newData, state.creditsActivity.data) || timeRangeChanged) {
          commit('SET_CREDITS_ACTIVITY_DATA', {
            labels: newLabels,
            data: newData,
            rawData: rawData,
            activityDays: activityDays,
          });
        }

        commit('SET_CREDITS_ACTIVITY_META', { isLoading: false, lastFetchTime: now });
      } catch (error) {
        if (error.name === 'AbortError') {
          console.warn('[UserStats] Request timeout for fetchCreditsActivity');
        } else {
          console.error('Error fetching credits activity:', error);
        }
        commit('SET_CREDITS_ACTIVITY_META', { isLoading: false, lastFetchTime: state.creditsActivity.lastFetchTime });
      }
    },

    // --- New Action for Gameplay ---
    async fetchGameState({ commit, state }) {
      commit('SET_GAME_STATE_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        const response = await axios.get(`${API_CONFIG.BASE_URL}/gameplay/state`, { headers: { Authorization: `Bearer ${token}` } });

        const newGameState = response.data;
        const currentRelevantGameState = {
          currentPhase: state.gameState.currentPhase,
          unlockedFeatures: state.gameState.unlockedFeatures,
          worldState: state.gameState.worldState,
        };

        if (!isEqual(newGameState, currentRelevantGameState)) {
          commit('SET_GAME_STATE', newGameState);
        } else {
          commit('SET_GAME_STATE_LOADING', false);
          commit('SET_GAME_STATE_ERROR', null);
          state.gameState.lastFetchTime = Date.now();
        }
      } catch (error) {
        console.error('Error fetching game state:', error);
        commit('SET_GAME_STATE_ERROR', error.message || 'Failed to fetch game state');
      }
    },

    async fetchTokenActivity({ commit }) {
      commit('SET_TOKEN_ACTIVITY_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        // Generate more varied dummy data
        const days = 14;
        const labels = [];
        const earned = [];
        const spent = [];

        const today = new Date();

        // Create base patterns for more realistic data
        const weekdayBonus = (day) => (day % 7 < 5 ? 1.3 : 0.7); // Higher on weekdays
        const randomSpike = () => {
          const chance = Math.random();
          if (chance < 0.1) return 2; // 10% chance of big gain
          if (chance < 0.2) return 0.5; // 10% chance of significant loss
          if (chance < 0.4) return 0.8; // 20% chance of small loss
          return 1; // 60% chance of normal
        };
        const trendFactor = (i) => 1 + (i / days) * 0.3; // Slight upward trend (reduced from 0.5)

        let lastEarned = 2500; // Starting point
        let lastSpent = 1500;
        const volatility = 0.2; // 20% max change day to day

        for (let i = days; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          labels.push(formatDate(date));

          // Use previous day's values to create smoother transitions
          const maxChange = lastEarned * volatility;
          const baseEarned = lastEarned + (Math.random() * maxChange * 2 - maxChange);
          const baseSpent = lastSpent + (Math.random() * (maxChange * 0.8) * 2 - maxChange * 0.8);

          // Apply modifiers for more interesting patterns
          const dayMultiplier = weekdayBonus(i) * randomSpike() * trendFactor(i);

          const earnedValue = Math.floor(baseEarned * dayMultiplier);
          const spentValue = Math.abs(Math.floor(baseSpent * (dayMultiplier * 0.9))); // Ensure spent is positive

          earned.push(earnedValue);
          spent.push(spentValue);

          // Update last values for next iteration
          lastEarned = earnedValue;
          lastSpent = spentValue;
        }

        // Calculate ROI for the period
        const totalEarned = earned.reduce((a, b) => a + b, 0);
        const totalSpent = spent.reduce((a, b) => a + b, 0);
        const roi = (((totalEarned - totalSpent) / totalSpent) * 100).toFixed(1);

        // Update ROI in state
        commit('SET_USER_PROGRESS', {
          roiPercentage: parseFloat(roi),
        });

        // Simulate API delay
        await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve();
            activeTimeouts.delete(timeoutId);
          }, 300);
          activeTimeouts.add(timeoutId);
        });
        commit('SET_TOKEN_ACTIVITY', { labels, earned, spent });
      } catch (error) {
        console.error('Error fetching token activity:', error);
      } finally {
        commit('SET_TOKEN_ACTIVITY_LOADING', false);
      }
    },

    async fetchLeaderboard({ commit }, period = 'Daily') {
      commit('SET_LEADERBOARD_LOADING', true);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        // Generate consistent dummy leaderboard data
        const dummyData = [
          { id: 1, name: 'Agent Alpha', score: 9500 },
          { id: 2, name: 'Agent Beta', score: 8200 },
          { id: 3, name: 'Agent Gamma', score: 7800 },
          { id: 4, name: 'Agent Delta', score: 6500 },
          { id: 5, name: 'Agent Epsilon', score: 5900 },
        ];

        // Simulate API delay
        await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve();
            activeTimeouts.delete(timeoutId);
          }, 300);
          activeTimeouts.add(timeoutId);
        });
        commit('SET_LEADERBOARD', dummyData);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        commit('SET_LEADERBOARD_LOADING', false);
      }
    },

    async purchaseBoost({ commit, dispatch }, boost) {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        // Simulate API call
        await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve();
            activeTimeouts.delete(timeoutId);
          }, 500);
          activeTimeouts.add(timeoutId);
        });

        // Refresh stats after purchase
        await dispatch('fetchStats');
        return true;
      } catch (error) {
        console.error('Error purchasing boost:', error);
        return false;
      }
    },

    async fetchReferralBalance({ commit, rootState }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        // Get email from the correct location in userAuth state
        const userEmail = rootState.userAuth?.userEmail;
        console.log('🔍 fetchReferralBalance - userEmail:', userEmail);
        if (!userEmail) {
          console.warn('User email not found, skipping referral balance fetch');
          return;
        }

        console.log('🔍 Fetching network score from:', `${API_CONFIG.REMOTE_URL}/referrals/network-score/${encodeURIComponent(userEmail)}`);
        const response = await axios.get(`${API_CONFIG.REMOTE_URL}/referrals/network-score/${encodeURIComponent(userEmail)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        console.log('🔍 Network score response:', response.data);

        // Use totalScore (personal + network) as the referral balance
        const totalScore = response.data.totalScore || 0;
        const personalBalance = response.data.personalBalance || 0;
        const networkScore = response.data.networkScore || 0;

        console.log('🔍 Score breakdown:', {
          personal: personalBalance,
          network: networkScore,
          total: totalScore,
        });

        commit('SET_REFERRAL_BALANCE', totalScore);
        commit('SET_REFERRAL_BREAKDOWN', {
          personalBalance,
          networkScore,
          totalScore,
          networkBreakdown: response.data.networkBreakdown || [],
        });
        console.log('✅ Referral balance and breakdown committed to state');
      } catch (error) {
        console.error('❌ Error fetching referral balance:', error);
        console.log('Setting referral balance to 0 due to error');
        commit('SET_REFERRAL_BALANCE', 0);
        commit('SET_REFERRAL_BREAKDOWN', {
          personalBalance: 0,
          networkScore: 0,
          totalScore: 0,
          networkBreakdown: [],
        });
      }
    },

    async fetchReferralTree({ commit, state, rootState }) {
      // Check cache - only fetch if older than 5 minutes
      const now = Date.now();
      const lastFetch = state.referralTree.lastFetchTime;
      if (lastFetch && now - lastFetch < 300000) {
        return;
      }

      commit('SET_REFERRAL_TREE_LOADING', true);

      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No auth token found');

        // Get email from the correct location in userAuth state
        const userEmail = rootState.userAuth?.userEmail;
        if (!userEmail) {
          console.warn('User email not found, skipping referral tree fetch');
          commit('SET_REFERRAL_TREE_LOADING', false);
          return;
        }

        console.log('Fetching referral tree for:', userEmail);
        const response = await axios.get(`${API_CONFIG.REMOTE_URL}/referrals/tree/${encodeURIComponent(userEmail)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        console.log('Referral tree response:', response.data);

        commit('SET_REFERRAL_TREE', {
          tree: response.data.tree || [],
          stats: response.data.stats || {
            total: 0,
            active: 0,
            inactive: 0,
            level1: 0,
            level2: 0,
            level3: 0,
          },
        });
      } catch (error) {
        console.error('Error fetching referral tree:', error);
        commit('SET_REFERRAL_TREE_LOADING', false);
      }
    },

    // Calculate AGNT Score ONCE after all data is loaded
    async calculateAndStoreAgntScore({ commit, state, rootGetters, dispatch }) {
      // Prevent duplicate calculations
      if (state._isCalculatingScore) {
        console.log('⏭️ SKIPPING - Score calculation already in progress');
        return;
      }

      commit('SET_CALCULATING_SCORE_FLAG', true);
      console.log('🔍 CALCULATING AGNT SCORE - ONCE');

      // Ensure we have health check data before calculating
      if (rootGetters['appAuth/needsHealthCheck']) {
        console.log('🔍 Running health check before score calculation...');
        try {
          await dispatch('appAuth/checkConnectionHealthStream', null, { root: true });
        } catch (error) {
          console.warn('Health check stream failed, falling back to regular check:', error);
          await dispatch('appAuth/checkConnectionHealth', null, { root: true });
        }
      }

      // Get data from other stores
      const allGoals = rootGetters['goals/allGoals'] || [];
      const completedGoals = allGoals.filter((g) => g.status === 'completed' || g.status === 'validated');
      const activeGoals = rootGetters['goals/activeGoals'] || [];

      const allAgents = rootGetters['agents/allAgents'] || [];
      const activeAgents = allAgents.filter((a) => a.status === 'ACTIVE');

      const allWorkflows = rootGetters['workflows/allWorkflows'] || [];
      const activeWorkflows = rootGetters['workflows/activeWorkflows'] || [];
      const completedWorkflows = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped');
      const failedWorkflows = allWorkflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits');

      const allTools = rootGetters['tools/allTools'] || [];

      const executions = rootGetters['executionHistory/getExecutions'] || [];
      const completedExecutions = executions.filter((e) => e.status === 'completed');

      // Get all available integrations and connected apps
      const allProviders = rootGetters['appAuth/allProviders'] || [];
      const connectedApps = rootGetters['appAuth/connectedApps'] || [];

      // For infrastructure score: count all connected apps
      const integrations = connectedApps;

      // For efficiency score: connected apps / all available apps
      const totalAvailableApps = allProviders.length;
      const connectedAppsCount = connectedApps.length;

      console.log('🔍 INTEGRATIONS DEBUG:', {
        totalAvailableApps,
        connectedAppsCount,
        integrationHealthRate: totalAvailableApps > 0 ? Math.round((connectedAppsCount / totalAvailableApps) * 100) : 0,
      });

      // Use the 90-day cumulative total from creditsActivity (already fetched for the chart)
      // This is the LAST value in the cumulative data array
      const totalSecondsAutomated = state.creditsActivity.data.length > 0 ? state.creditsActivity.data[state.creditsActivity.data.length - 1] : 0;

      console.log('🔍 SECONDS AUTOMATED DEBUG:', {
        totalSecondsAutomated,
        calculatedScore: (totalSecondsAutomated / 1000) * 100,
        source: '90-day cumulative from creditsActivity chart data',
        activityDays: state.creditsActivity.activityDays,
      });

      // --- PRODUCTIVITY SCORE ---
      // ONLY use REAL data - NO random tokenActivity data!
      const secondsScore = (totalSecondsAutomated / 1000) * 100;
      const goalsScore = completedGoals.length * 50;
      const successRate = executions.length > 0 ? (completedExecutions.length / executions.length) * 100 : 0;
      const successScore = successRate * 20;

      // DO NOT include ROI from random tokenActivity data - it's not real!
      // const roiScore = 0; // Removed until we have real token earning/spending data

      const productivityScore = secondsScore + goalsScore + successScore;

      // --- ENGAGEMENT SCORE ---
      const activeGoalsScore = activeGoals.length * 100;
      const activeAgentsScore = activeAgents.length * 100;
      const activeWorkflowsScore = activeWorkflows.length * 50;
      const streakScore = state.loginStreak * 100;

      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const dailyRuns = executions.filter((exec) => {
        if (!exec.startTime) return false;
        const startTime = new Date(exec.startTime);
        return startTime >= twentyFourHoursAgo;
      }).length;
      const dailyRunsScore = dailyRuns * 50;
      const engagementScore = activeGoalsScore + activeAgentsScore + activeWorkflowsScore + streakScore + dailyRunsScore;

      // --- INFRASTRUCTURE SCORE ---
      const workflowsScore = state.totalWorkflows * 50;
      const toolsScore = state.totalCustomTools * 20;
      const integrationsScore = integrations.length * 25;
      const toolInventoryScore = allTools.length * 10;
      const infrastructureScore = workflowsScore + toolsScore + integrationsScore + toolInventoryScore;

      // --- EFFICIENCY SCORE ---
      // Reward both quality AND quantity of workflow executions
      const workflowSuccessRate =
        allWorkflows.length > 0 ? (completedWorkflows.length / (completedWorkflows.length + failedWorkflows.length || 1)) * 100 : 0;
      // Base score from success rate, then multiply by number of successful workflows
      const workflowEfficiencyScore = (workflowSuccessRate / 100) * completedWorkflows.length * 50;

      // Integration health = connected apps / all available apps
      const integrationHealthRate = totalAvailableApps > 0 ? (connectedAppsCount / totalAvailableApps) * 100 : 0;
      const integrationHealthScore = integrationHealthRate * 30; // Rewards connecting more integrations

      const completedExecs = executions.filter((exec) => exec.startTime && exec.endTime);
      let latencyScore = 500; // Base score for having executions
      if (completedExecs.length > 0) {
        const avgLatency =
          completedExecs.reduce((sum, exec) => {
            const duration = new Date(exec.endTime) - new Date(exec.startTime);
            return sum + duration;
          }, 0) /
          completedExecs.length /
          1000;

        if (avgLatency <= 5) latencyScore = 2000; // Excellent latency
        else if (avgLatency <= 15) latencyScore = 1500; // Good latency
        else if (avgLatency <= 30) latencyScore = 1000; // Acceptable latency
        else latencyScore = 500; // Slower but still working
      }

      // Calculate base efficiency score
      const baseEfficiency = workflowEfficiencyScore + integrationHealthScore + latencyScore;
      // Don't penalize for workflows not running - they're task-based, not always-on services
      const efficiencyScore = baseEfficiency;

      // --- NETWORK SCORE (20x multiplier for referrals!) ---
      // Count network score based on referral balance (includes onboarding bonus)
      const networkScore = (state.referralBalance || 0) * 20;

      // --- SCALE SCORE ---
      // Total executions × 0.5 - Use stored value from API, not limited array
      const totalExecutionsScore = state.totalExecutions * 0.5;

      // Total node executions × 0.01 (since this can be a very large number)
      const totalNodeExecutions = state.totalSecondsAutomated || 0; // Using totalSecondsAutomated which stores totalNodeExecutions
      const nodeExecutionsScore = totalNodeExecutions * 0.01;

      // Node success rate × 10
      // Since we don't have failed node data from API, assume 100% success rate
      // This prevents negative scores when node executions are low
      const nodeSuccessRate = totalNodeExecutions > 0 ? 100 : 0;
      const nodeSuccessRateScore = nodeSuccessRate * 10;

      // Total agents × 50
      const totalAgentsScore = allAgents.length * 50;

      const scaleScore = totalExecutionsScore + nodeExecutionsScore + nodeSuccessRateScore + totalAgentsScore;

      // --- CALCULATE TOTAL ---
      const totalScore = Math.round(productivityScore + engagementScore + infrastructureScore + efficiencyScore + networkScore + scaleScore);

      const breakdown = {
        productivity: Math.round(productivityScore),
        engagement: Math.round(engagementScore),
        infrastructure: Math.round(infrastructureScore),
        efficiency: Math.round(efficiencyScore),
        network: Math.round(networkScore),
        scale: Math.round(scaleScore),
      };

      // Create detailed breakdown showing ALL point sources
      const details = {
        productivity: {
          secondsAutomated: Math.round(secondsScore),
          completedGoals: Math.round(goalsScore),
          executionSuccessRate: Math.round(successScore),
        },
        engagement: {
          activeGoals: Math.round(activeGoalsScore),
          activeAgents: Math.round(activeAgentsScore),
          activeWorkflows: Math.round(activeWorkflowsScore),
          loginStreak: Math.round(streakScore),
          dailyRuns: Math.round(dailyRunsScore),
        },
        infrastructure: {
          totalWorkflows: Math.round(workflowsScore),
          customTools: Math.round(toolsScore),
          integrations: Math.round(integrationsScore),
          toolInventory: Math.round(toolInventoryScore),
        },
        efficiency: {
          workflowSuccessRate: Math.round(workflowEfficiencyScore),
          integrationHealth: Math.round(integrationHealthScore),
          executionLatency: Math.round(latencyScore),
        },
        network: {
          referralBalance: Math.round(networkScore),
        },
        scale: {
          totalExecutions: Math.round(totalExecutionsScore),
          totalNodeExecutions: Math.round(nodeExecutionsScore),
          nodeSuccessRate: Math.round(nodeSuccessRateScore),
          totalAgents: Math.round(totalAgentsScore),
        },
      };

      console.log('📊 FINAL SCORE:', totalScore, breakdown);
      console.log('📊 DETAILED BREAKDOWN:', details);

      // Calculate level and XP from score
      const levelData = calculateLevelFromScore(totalScore);

      console.log('📊 LEVEL DATA:', {
        level: levelData.level,
        currentXP: levelData.currentXP,
        xpNeeded: levelData.xpNeeded,
        totalXP: levelData.totalXP,
        progress: `${levelData.currentXP}/${levelData.xpNeeded} (${Math.round((levelData.currentXP / levelData.xpNeeded) * 100)}%)`,
      });

      // Commit to state
      commit('SET_AGNT_SCORE', {
        total: totalScore,
        formatted: totalScore.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
        breakdown,
        details,
      });

      // Update level and XP based on score
      commit('SET_USER_PROGRESS', {
        level: levelData.level,
        xp: levelData.totalXP, // Store total XP (AGNT score)
        tickRateTier: state.tickRateTier,
        loginStreak: state.loginStreak,
        roiPercentage: state.roiPercentage,
        missedTokensYesterday: state.missedTokensYesterday,
      });

      // Reset flag
      commit('SET_CALCULATING_SCORE_FLAG', false);

      // Sync stats to remote after calculation
      dispatch('syncStatsToRemote');
    },

    async syncStatsToRemote({ state, rootGetters }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.log('No token found, skipping stats sync');
          return;
        }

        // Get all the data we need to sync
        const allGoals = rootGetters['goals/allGoals'] || [];
        const completedGoals = allGoals.filter((g) => g.status === 'completed' || g.status === 'validated');
        const activeGoals = rootGetters['goals/activeGoals'] || [];

        const allAgents = rootGetters['agents/allAgents'] || [];
        const activeAgents = allAgents.filter((a) => a.status === 'ACTIVE');

        const allWorkflows = rootGetters['workflows/allWorkflows'] || [];
        const activeWorkflows = rootGetters['workflows/activeWorkflows'] || [];
        const completedWorkflows = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped');
        const failedWorkflows = allWorkflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits');

        const allTools = rootGetters['tools/allTools'] || [];
        const connectedApps = rootGetters['appAuth/connectedApps'] || [];
        const allProviders = rootGetters['appAuth/allProviders'] || [];

        const executions = rootGetters['executionHistory/getExecutions'] || [];
        const completedExecutions = executions.filter((e) => e.status === 'completed');

        // Calculate rates
        const executionSuccessRate = executions.length > 0 ? (completedExecutions.length / executions.length) * 100 : 0;
        const workflowSuccessRate =
          allWorkflows.length > 0 ? (completedWorkflows.length / (completedWorkflows.length + failedWorkflows.length || 1)) * 100 : 0;
        const integrationHealthRate = allProviders.length > 0 ? (connectedApps.length / allProviders.length) * 100 : 0;

        // Calculate average latency
        const completedExecs = executions.filter((exec) => exec.startTime && exec.endTime);
        let avgExecutionLatency = 0;
        if (completedExecs.length > 0) {
          avgExecutionLatency =
            completedExecs.reduce((sum, exec) => {
              const duration = new Date(exec.endTime) - new Date(exec.startTime);
              return sum + duration;
            }, 0) /
            completedExecs.length /
            1000;
        }

        // Calculate daily runs
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const dailyRuns = executions.filter((exec) => {
          if (!exec.startTime) return false;
          const startTime = new Date(exec.startTime);
          return startTime >= twentyFourHoursAgo;
        }).length;

        // Node success rate
        const totalNodeExecutions = state.totalSecondsAutomated || 0;
        const nodeSuccessRate = totalNodeExecutions > 0 ? 100 : 0;

        // Prepare stats payload
        const statsPayload = {
          agntScore: state.agntScore.total,
          level: state.level,
          loginStreak: state.loginStreak,
          totalWorkflows: state.totalWorkflows,
          totalCustomTools: state.totalCustomTools,
          totalIntegrations: connectedApps.length,
          totalToolInventory: allTools.length,
          totalSecondsAutomated: state.totalSecondsAutomated,
          completedGoals: completedGoals.length,
          executionSuccessRate: Math.round(executionSuccessRate * 100) / 100,
          activeGoals: activeGoals.length,
          activeAgents: activeAgents.length,
          activeWorkflows: activeWorkflows.length,
          dailyRuns: dailyRuns,
          workflowSuccessRate: Math.round(workflowSuccessRate * 100) / 100,
          integrationHealthRate: Math.round(integrationHealthRate * 100) / 100,
          avgExecutionLatency: Math.round(avgExecutionLatency * 100) / 100,
          totalExecutions: state.totalExecutions,
          totalNodeExecutions: totalNodeExecutions,
          nodeSuccessRate: Math.round(nodeSuccessRate * 100) / 100,
          totalAgents: allAgents.length,
        };

        console.log('📤 Syncing stats to remote:', statsPayload);

        // Send to remote API
        await axios.post(`${API_CONFIG.REMOTE_URL}/users/stats/sync`, statsPayload, {
          headers: { Authorization: `Bearer ${token}` },
        });

        console.log('✅ Stats synced to remote successfully');
      } catch (error) {
        console.error('❌ Error syncing stats to remote:', error);
        // Don't throw - sync failures shouldn't break the app
      }
    },
  },
  getters: {
    formattedTokens: (state) => Math.floor(state.tokens).toLocaleString(),
    tokensPerDay: (state) => state.tokensPerDay,
    stats: (state) => ({
      tokens: state.tokens,
      totalWorkflows: state.totalWorkflows,
      totalCustomTools: state.totalCustomTools,
      tokensPerDay: state.tokensPerDay,
    }),
    agentActivity: (state) => state.agentActivity,
    isAgentActivityLoading: (state) => state.agentActivity.isLoading,
    agentActivityLastFetchTime: (state) => state.agentActivity.lastFetchTime,
    gameProgress: (state) => state.gameProgress,
    tokensGeneratedActivity: (state) => state.tokensGeneratedActivity,
    isTokensGeneratedLoading: (state) => state.tokensGeneratedActivity.isLoading,
    tokensGeneratedLastFetchTime: (state) => state.tokensGeneratedActivity.lastFetchTime,
    gameState: (state) => state.gameState,
    isGameStateLoading: (state) => state.gameState.isLoading,
    unlockedFeatures: (state) => state.gameState.unlockedFeatures || [],
    currentPhase: (state) => state.gameState.currentPhase,
    tokenActivity: (state) => ({
      labels: state.tokenActivity.labels,
      earned: state.tokenActivity.earned,
      spent: state.tokenActivity.spent,
    }),
    isActivityLoading: (state) => state.tokenActivity.isLoading,
    leaderboardData: (state) => state.leaderboard.data,
    isLeaderboardLoading: (state) => state.leaderboard.isLoading,
    level: (state) => state.level,
    xp: (state) => state.xp,
    tickRateTier: (state) => state.tickRateTier,
    loginStreak: (state) => state.loginStreak,
    roiPercentage: (state) => state.roiPercentage,
    missedTokensYesterday: (state) => state.missedTokensYesterday,
    creditsActivity: (state) => state.creditsActivity,
    isCreditsActivityLoading: (state) => state.creditsActivity.isLoading,
    creditsActivityLastFetchTime: (state) => state.creditsActivity.lastFetchTime,
    daysStreak: (state) => {
      const rawData = state.creditsActivity.rawData;
      if (!rawData || rawData.length === 0) return 0;

      // Filter for items with automation time > 0 and sort by date descending
      // rawData is expected to be { date: 'YYYY-MM-DD', credits_used: number } or similar
      // Actually fillMissingDates formats them as 'Jan 27' but rawData in state might be different
      // Let's look at how rawData is populated in fetchCreditsActivity
      // It uses fillMissingDates(response.data, startDate, endDate)
      // fillMissingDates returns { date: formatDate(currentDate), credits_used: ... }
      // formatDate returns 'Jan 27'

      // Wait, if it's 'Jan 27', we might have trouble with year boundaries.
      // But for a simple streak calculation, we can work with the array order if it's chronological.
      // fillMissingDates produces chronological order.

      const reversedData = [...rawData].reverse();
      let streak = 0;
      const today = formatDate(new Date());
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = formatDate(yesterdayDate);

      // A streak is active if today has activity OR if yesterday had activity (and today hasn't happened or hasn't had activity yet)
      let foundStart = false;
      let startIndex = -1;

      // Check today
      if (reversedData[0] && reversedData[0].date === today) {
        if (reversedData[0].credits_used > 0) {
          foundStart = true;
          startIndex = 0;
        } else if (reversedData[1] && reversedData[1].date === yesterday && reversedData[1].credits_used > 0) {
          // If today is 0, check yesterday
          foundStart = true;
          startIndex = 1;
        }
      } else if (reversedData[0] && reversedData[0].date === yesterday && reversedData[0].credits_used > 0) {
        // If the most recent data point is yesterday (today not in data yet)
        foundStart = true;
        startIndex = 0;
      }

      if (!foundStart) return 0;

      for (let i = startIndex; i < reversedData.length; i++) {
        if (reversedData[i].credits_used > 0) {
          streak++;
        } else {
          break;
        }
      }

      return streak;
    },
    // --- $AGNT Score Getter - Returns state value (calculated by action) ---
    agntScore: (state) => state.agntScore,
    // --- End $AGNT Score Getters ---
  },
  // Add cleanup method
  cleanup() {
    clearAllTimeouts();
  },
};
