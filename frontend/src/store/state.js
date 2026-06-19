import { createStore } from 'vuex';
import chat from './features/chat';
import chatUnified from './features/chatUnified';
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
import connectors from './features/connectors';
import webhooks from './features/webhooks';
import emailListeners from './features/emailListeners';
import mcpServers from './features/mcpServers';
import goals from './features/goals';
import goalTemplates from './features/goalTemplates';
import contentOutputs from './features/contentOutputs';
import groups from './features/groups';
import widgetLayout from './features/widgetLayout';
import widgetDefinitions from './features/widgetDefinitions';
import skills from './features/skills';
import skillforge from './features/skillforge';
import experiments from './features/experiments';
import insights from './features/insights';
import schedules from './features/schedules';
import wallets from './features/wallets';
import contracts from './features/contracts';
import mutations from './features/mutations';

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
          dispatch('groups/fetchGroups'),
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
        // Deferred to respective screens: goals/fetchGoals (Goals/Dashboard),
        // executionHistory/fetchExecutions (Traces/Dashboard),
        // fetchReferralBalance, fetchReferralTree (Settings),
        // fetchCreditsActivity (Dashboard), fetchMyPurchases/fetchMyInstalls (Marketplace)
        Promise.allSettled([
          dispatch('tools/fetchTools'),
          dispatch('tools/fetchWorkflowTools'),
          dispatch('widgetLayout/fetchLayouts'),
          dispatch('widgetDefinitions/fetchDefinitions'),
          dispatch('skills/fetchSkills'),
          dispatch('appAuth/fetchAllProviders'),
        ]).then((results) => {
          results.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.warn(`Secondary fetch ${index} failed:`, result.reason);
            }
          });

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
    chatUnified,
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
    connectors,
    webhooks,
    emailListeners,
    mcpServers,
    goals,
    goalTemplates,
    contentOutputs,
    groups,
    widgetLayout,
    widgetDefinitions,
    skills,
    skillforge,
    experiments,
    insights,
    schedules,
    wallets,
    contracts,
    mutations,
  },
});

export default store;
