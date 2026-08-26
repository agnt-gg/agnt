import { createStore } from 'vuex';
import { withUserScopedReset, RESET_MUTATION } from './_utils/userScopedReset.js';
import { invalidateAllFreshness } from './_utils/withFreshness.js';
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

/**
 * Modules holding data that belongs to ONE signed-in user.
 *
 * This is the other half of `initializeStore` below: everything that action
 * loads on behalf of a user has to be dropped when that user's session ends,
 * or the next sign-in shows the previous account's data. Keeping the two lists
 * adjacent is deliberate — they are two views of the same fact, and
 * `sessionReset.spec.js` fails if one gains an entry the other lacks.
 *
 * Wrapping happens HERE rather than in each module file so a module cannot be
 * listed as user-scoped without actually gaining the reset.
 */
const USER_SCOPED_MODULES = {
  agents,
  workflows,
  tools,
  groups,
  contentOutputs,
  userStats,
  widgetLayout,
  widgetDefinitions,
  skills,
  appAuth,
};

const resettableModules = Object.fromEntries(
  Object.entries(USER_SCOPED_MODULES).map(([name, mod]) => [name, withUserScopedReset(mod)]),
);

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

    /**
     * Drop everything that belonged to the session that just ended.
     *
     * The mirror of initializeStore, and it used to not exist: logout cleared
     * agents, workflows, tools and goals by hand and left the other eight
     * stores populated — along with their `lastFetched` timestamps, so the
     * NEXT user's fetch short-circuited and showed the previous account's data
     * until the cache aged out.
     *
     * Ordering is load-bearing. Side effects that reference state must run
     * BEFORE the state they reference is wiped:
     *   - appAuth holds `pollingIntervalId`; blanking it without clearing the
     *     interval leaks a poller that then 401s forever against a dead token.
     *   - goals holds live subscription callbacks in a Map; CLEAR_GOALS
     *     unsubscribes them, which a blind state reset cannot do.
     */
    async resetUserScopedData({ commit, dispatch }) {
      await dispatch('appAuth/stopPolling');
      commit('goals/CLEAR_GOALS');
      for (const name of Object.keys(USER_SCOPED_MODULES)) {
        commit(`${name}/${RESET_MUTATION}`);
      }

      // The caches describe the state that was just wiped, so they go with it.
      //
      // withFreshness caches an action's RETURN VALUE and, on a hit, does not
      // call the action — but the real work of nearly every one of these is a
      // `commit`. Leaving a warm cache over an emptied store therefore means
      // the commit never runs again and the state stays empty.
      //
      // The identity option does not cover this. It asks "is this someone
      // else's data?", and signing back into the SAME account correctly
      // answers no, so the cache is served and the store is never refilled.
      // That is how a fresh sign-in came to show an empty provider list:
      // fetchAllProviders has a thirty-minute TTL, so allProviders stayed []
      // and the connectors screen mapped over nothing. Reloading appeared to
      // fix it only because a module reload discards the closures.
      invalidateAllFreshness();
      console.log('[session] user-scoped stores reset');
    },
  },
  modules: {
    // User-scoped modules come from `resettableModules` so every one of them
    // carries RESET_USER_SCOPED_STATE. Listing a raw module here instead would
    // compile and then silently fail to clear on logout.
    ...resettableModules,
    chat,
    chatUnified,
    pluginBuilder,
    canvas,
    theme,
    userAuth,
    player,
    aiProvider,
    executionHistory,
    // missions,
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
