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

const store = createStore({
  actions: {
    async initializeStore({ dispatch }) {
      console.log('🚀 INITIALIZING APP DATA (Background)...');

      try {
        // Fetch referral data first
        await dispatch('userStats/fetchReferralBalance');
        await dispatch('userStats/fetchReferralTree');

        // Fetch all other data in parallel
        // Use allSettled to prevent one failure from stopping others
        const results = await Promise.allSettled([
          dispatch('userStats/fetchStats'),
          dispatch('userStats/fetchCreditsActivity', { activityDays: 90 }),
          dispatch('goals/fetchGoals'),
          dispatch('agents/fetchAgents'),
          dispatch('workflows/fetchWorkflows'),
          dispatch('tools/fetchTools'),
          dispatch('tools/fetchWorkflowTools'),
          dispatch('executionHistory/fetchExecutions'),
          dispatch('appAuth/fetchConnectedApps'),
          dispatch('contentOutputs/fetchOutputs'),
          dispatch('marketplace/fetchMyPurchases'),
          dispatch('marketplace/fetchMyInstalls'),
        ]);

        // Log any failures for debugging (optional)
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.warn(`Background fetch item ${index} failed:`, result.reason);
          }
        });

        // Calculate AGNT score once with all data
        await dispatch('userStats/calculateAndStoreAgntScore');

        console.log('✅ APP DATA INITIALIZED');
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
  },
});

export default store;
