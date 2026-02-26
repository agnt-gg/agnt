import { createStore } from 'vuex';
import chat from './features/chat';
import workflowChat from './features/workflowChat';
import toolChat from './features/toolChat';
import agentChat from './features/agentChat';
import pluginBuilder from './features/pluginBuilder';
import canvas from './features/canvas';
import theme from './app/theme';
import appAuth from './auth/appAuth';
import userAuth from './auth/userAuth';
import player from './features/player';
import aiProvider from './app/aiProvider';
import executionHistory from './user/executionHistory';
import userStats from './user/userStats';
// import missions from './features/_missions';
import agents from './features/agents';
import tools from './features/tools';
import workflows from './features/workflows';
import marketplace from './features/marketplace';
// import market from './features/market';
// import map from './features/_map';
import songPlayer from './app/songPlayer';
// import missionAssignments from './features/_missionAssignments';
import secrets from './features/secrets';
import webhooks from './features/webhooks';
import mcpServers from './features/mcpServers';
import goals from './features/goals';
import goalTemplates from './features/goalTemplates';
import contentOutputs from './features/contentOutputs';
import widgetLayout from './features/widgetLayout';
import widgetDefinitions from './features/widgetDefinitions';
import { registerCustomWidgets } from '@/canvas/widgetRegistry.js';
import CustomWidgetRenderer from '@/canvas/CustomWidgetRenderer.vue';

const store = createStore({
  state: {
    // Global initialization tracking
    criticalDataReady: false,
    allDataReady: false,
  },
  mutations: {
    SET_CRITICAL_DATA_READY(state) {
      state.criticalDataReady = true;
    },
    SET_ALL_DATA_READY(state) {
      state.allDataReady = true;
    },
  },
  getters: {
    criticalDataReady: (state) => state.criticalDataReady,
    allDataReady: (state) => state.allDataReady,
  },
  actions: {
    /**
     * Initialize store data in background after app mount
     * Optimized to fetch data in parallel without blocking UI
     */
    async initializeStore({ commit, dispatch, getters: rootGetters }) {
      console.log('Initializing app data in background...');

      try {
        // PHASE 1: Fetch critical UI data first (what user sees immediately)
        // These run in parallel for fastest initial render
        // Includes content outputs + connected apps since chat panels need them immediately
        const criticalResults = await Promise.allSettled([
          dispatch('agents/fetchAgents'),
          dispatch('workflows/fetchWorkflows'),
          dispatch('userStats/fetchStats'),
          dispatch('contentOutputs/fetchOutputs'),
          dispatch('appAuth/fetchConnectedApps'),
        ]);

        // Log critical failures
        criticalResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.warn(`Critical fetch ${index} failed:`, result.reason);
          }
        });

        // Signal that critical data is ready (agents, workflows, stats, outputs, connected apps)
        commit('SET_CRITICAL_DATA_READY');

        // PHASE 2: Fetch secondary data (less urgent, can load after)
        Promise.allSettled([
          dispatch('userStats/fetchReferralBalance'),
          dispatch('userStats/fetchReferralTree'),
          dispatch('userStats/fetchCreditsActivity', { activityDays: 90 }),
          dispatch('goals/fetchGoals'),
          dispatch('tools/fetchTools'),
          dispatch('tools/fetchWorkflowTools'),
          dispatch('executionHistory/fetchExecutions'),
          dispatch('marketplace/fetchMyPurchases'),
          dispatch('marketplace/fetchMyInstalls'),
          dispatch('widgetLayout/fetchLayouts'),
          dispatch('widgetDefinitions/fetchDefinitions'),
        ]).then((results) => {
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.warn(`Secondary fetch ${index} failed:`, result.reason);
            }
          });

          // Register custom widgets into the canvas registry
          try {
            const definitions = rootGetters['widgetDefinitions/allDefinitions'];
            if (definitions.length > 0) {
              registerCustomWidgets(definitions, CustomWidgetRenderer);
              console.log(`Registered ${definitions.length} custom widget(s) into canvas registry`);
            }
          } catch (err) {
            console.warn('Failed to register custom widgets:', err);
          }

          // Signal all data is ready
          commit('SET_ALL_DATA_READY');

          // Calculate AGNT score after all data is loaded
          dispatch('userStats/calculateAndStoreAgntScore').catch(console.error);
        });

        console.log('Critical app data loaded, secondary data loading in background');
      } catch (error) {
        console.error('Failed to initialize app data:', error);
      }
    },
  },
  modules: {
    chat,
    workflowChat,
    toolChat,
    agentChat,
    pluginBuilder,
    canvas,
    theme,
    appAuth,
    userAuth,
    player,
    aiProvider,
    executionHistory,
    userStats,
    // missions,
    agents,
    tools,
    workflows,
    marketplace,
    // market,
    // map,
    songPlayer,
    // missionAssignments,
    secrets,
    webhooks,
    mcpServers,
    goals,
    goalTemplates,
    contentOutputs,
    widgetLayout,
    widgetDefinitions,
  },
});

export default store;
