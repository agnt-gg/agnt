<!-- Terminal.vue -->
<template>
  <TerminalLayout>
    <!-- Update Notification Banner -->
    <UpdateNotification />

    <!-- Canvas navigation shell with direct screen rendering -->
    <CanvasScreen
      v-if="activeScreen !== 'BallJumperScreen'"
      :screenName="activeScreen"
      @screen-change="changeScreen"
    >
      <!-- KeepAlive caches visited screens so charts/data don't reload on every navigation -->
      <KeepAlive :max="4">
        <component
          v-if="isScreenReady"
          :is="activeScreenComponent"
          :key="activeScreen"
          @screen-change="changeScreen"
        />
      </KeepAlive>
      <!-- Placeholder while screen chunk is loading (outside KeepAlive to avoid lifecycle crash) -->
      <div v-if="!isScreenReady" style="flex:1;width:100%;height:100%;background:var(--color-background)"></div>
    </CanvasScreen>

    <!-- BallJumper uses legacy direct rendering (no nav shell) -->
    <component
      v-else
      :is="activeScreenComponent"
      @screen-change="changeScreen"
      @exit="changeScreen('SettingsScreen')"
    />

    <!-- Onboarding Modal -->
    <OnboardingModal v-if="shouldShowOnboarding" :show="shouldShowOnboarding" @complete="handleOnboardingComplete" @skip="handleOnboardingSkip" />
  </TerminalLayout>
</template>

<script>
import { ref, computed, onMounted, watch, shallowReactive, markRaw } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout and common
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';
import UpdateNotification from '@/views/_components/common/UpdateNotification.vue';
import OnboardingModal from '@/components/OnboardingModal.vue';

// Canvas system (provides navigation sidebar + toolbar)
import CanvasScreen from '@/canvas/CanvasScreen.vue';

// Shallow-reactive screen registry — screens register as they load
// Must be shallowReactive so Vue doesn't deep-proxy component objects
// (deep proxying breaks Vue internals like emitsOptions/HMR in dev mode)
const screenComponents = shallowReactive({});

const screenLoaders = [
  ['ChatScreen', () => import('./CenterPanel/screens/Chat/Chat.vue')],
  ['SettingsScreen', () => import('./CenterPanel/screens/Settings/Settings.vue')],
  ['AgentsScreen', () => import('./CenterPanel/screens/Agents/Agents.vue')],
  ['ToolsScreen', () => import('./CenterPanel/screens/Tools/Tools.vue')],
  ['WorkflowsScreen', () => import('./CenterPanel/screens/Workflows/Workflows.vue')],
  ['DashboardScreen', () => import('./CenterPanel/screens/Dashboard/Dashboard.vue')],
  ['WorkflowForgeScreen', () => import('./CenterPanel/screens/WorkflowForge/WorkflowForge.vue')],
  ['ToolForgeScreen', () => import('./CenterPanel/screens/ToolForge/ToolForge.vue')],
  ['AgentForgeScreen', () => import('./CenterPanel/screens/AgentForge/AgentForge.vue')],
  ['BallJumperScreen', () => import('./CenterPanel/screens/Minigames/BallJumper/BallJumper.vue')],
  ['ConnectorsScreen', () => import('./CenterPanel/screens/Connectors/Connectors.vue')],
  ['GoalsScreen', () => import('./CenterPanel/screens/Goals/Goals.vue')],
  ['TracesScreen', () => import('./CenterPanel/screens/Traces/Traces.vue')],
  ['MarketplaceScreen', () => import('./CenterPanel/screens/Marketplace/Marketplace.vue')],
  ['WidgetManagerScreen', () => import('./CenterPanel/screens/WidgetManager/WidgetManager.vue')],
  ['WidgetForgeScreen', () => import('./CenterPanel/screens/WidgetForge/WidgetForge.vue')],
  ['SkillsScreen', () => import('./CenterPanel/screens/Skills/Skills.vue')],
  ['ArtifactsScreen', () => import('./CenterPanel/screens/Artifacts/Artifacts.vue')],
  ['ExperimentsScreen', () => import('./CenterPanel/screens/Experiments/Experiments.vue')],
  ['MemoryScreen', () => import('./CenterPanel/screens/Memory/Memory.vue')],
  ['AutonomyScreen', () => import('./CenterPanel/screens/Autonomy/Autonomy.vue')],
];

const screenLoadersByName = new Map(screenLoaders);
const screenLoadPromises = new Map();
const preloadedGroups = new Set();
const DASHBOARD_PREFETCH_SCREENS = new Set(['DashboardScreen', 'GoalsScreen', 'TracesScreen']);

const screenPreloadGroups = {
  DashboardScreen: ['GoalsScreen', 'TracesScreen'],
  GoalsScreen: ['DashboardScreen', 'TracesScreen'],
  TracesScreen: ['DashboardScreen', 'GoalsScreen'],
  AgentsScreen: ['AgentForgeScreen'],
  AgentForgeScreen: ['AgentsScreen'],
  WorkflowsScreen: ['WorkflowForgeScreen'],
  WorkflowForgeScreen: ['WorkflowsScreen'],
  ToolsScreen: ['ToolForgeScreen'],
  ToolForgeScreen: ['ToolsScreen'],
  WidgetManagerScreen: ['WidgetForgeScreen'],
  WidgetForgeScreen: ['WidgetManagerScreen'],
  SkillsScreen: ['MemoryScreen', 'ExperimentsScreen', 'AutonomyScreen'],
  MemoryScreen: ['SkillsScreen', 'ExperimentsScreen', 'AutonomyScreen'],
  ExperimentsScreen: ['SkillsScreen', 'MemoryScreen', 'AutonomyScreen'],
  AutonomyScreen: ['SkillsScreen', 'MemoryScreen', 'ExperimentsScreen'],
};

const idle = (cb, timeout = 2000) => (
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(cb, { timeout })
    : setTimeout(cb, 100)
);

const loadScreen = (screenName) => {
  if (screenComponents[screenName]) {
    return Promise.resolve(screenComponents[screenName]);
  }

  if (screenLoadPromises.has(screenName)) {
    return screenLoadPromises.get(screenName);
  }

  const loader = screenLoadersByName.get(screenName);
  if (!loader) {
    return Promise.reject(new Error(`Unknown screen: ${screenName}`));
  }

  const promise = loader()
    .then((mod) => {
      screenComponents[screenName] = markRaw(mod.default);
      return screenComponents[screenName];
    })
    .catch((err) => {
      screenLoadPromises.delete(screenName);
      console.warn(`[screen] Failed to load ${screenName}:`, err);
      throw err;
    });

  screenLoadPromises.set(screenName, promise);
  return promise;
};

const preloadLikelyScreens = (screenName) => {
  const candidates = screenPreloadGroups[screenName] || [];
  const groupKey = [screenName, ...candidates].join('|');
  if (!candidates.length || preloadedGroups.has(groupKey)) return;
  preloadedGroups.add(groupKey);

  let index = 0;
  const loadNext = () => {
    const nextScreen = candidates[index++];
    if (!nextScreen) return;

    loadScreen(nextScreen)
      .catch(() => {})
      .finally(() => {
        if (index < candidates.length) idle(loadNext, 4000);
      });
  };

  idle(loadNext);
};

export default {
  name: 'Terminal',
  components: {
    TerminalLayout,
    CanvasScreen,
    OnboardingModal,
    UpdateNotification,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const shouldShowOnboarding = computed(() => store.getters['userAuth/shouldShowOnboarding']);

    const getDefaultScreen = () => 'ChatScreen';

    // Initialize from route immediately to avoid flash on refresh
    const getScreenFromRoute = () => {
      if (route.meta?.terminalScreen) return route.meta.terminalScreen;
      if (route.query.id) return 'WorkflowForgeScreen';
      return getDefaultScreen();
    };
    const activeScreen = ref(getScreenFromRoute());

    const isScreenReady = computed(() => !!screenComponents[activeScreen.value]);

    const activeScreenComponent = computed(() => {
      return screenComponents[activeScreen.value] || null;
    });

    const changeScreen = (screenName, options = {}) => {
      const screenRoutes = {
        ChatScreen: '/chat',
        AgentsScreen: '/agents',
        ToolsScreen: '/tools',
        WorkflowsScreen: '/workflows',
        DashboardScreen: '/dashboard',
        SettingsScreen: '/settings',
        WorkflowForgeScreen: '/workflow-forge',
        ToolForgeScreen: '/tool-forge',
        AgentForgeScreen: '/agent-forge',
        BallJumperScreen: '/ball-jumper',
        ConnectorsScreen: '/connectors',
        GoalsScreen: '/goals',
        TracesScreen: '/traces',
        MarketplaceScreen: '/marketplace',
        WidgetManagerScreen: '/widget-manager',
        WidgetForgeScreen: '/widget-forge',
        SkillsScreen: '/skills',
        ArtifactsScreen: '/artifacts',
        ExperimentsScreen: '/experiments',
        MemoryScreen: '/memory',
        AutonomyScreen: '/autonomy',
      };

      if (screenName in screenRoutes) {
        ensureScreen(screenName);
        prefetchScreenData(screenName);
        activeScreen.value = screenName;
        const targetPath = screenRoutes[screenName];

        if (screenName === 'WorkflowForgeScreen' && options.workflowId) {
          router.push({ path: targetPath, query: { id: options.workflowId } });
        } else if (screenName === 'ToolForgeScreen' && options.toolId) {
          router.push({ path: targetPath, query: { 'tool-id': options.toolId } });
        } else if (screenName === 'TracesScreen' && options.selectedExecutionId) {
          router.push({ path: targetPath, query: { executionId: options.selectedExecutionId } });
        } else if (screenName === 'ExperimentsScreen' && options.selectedInsight) {
          router.push({ path: targetPath, query: { insightId: options.selectedInsight.id } });
        } else if (route.path !== targetPath) {
          router.push(targetPath);
        }
      } else {
        console.warn(`Attempted to navigate to unknown screen: ${screenName}`);
      }
    };

    const handleOnboardingComplete = (selectedScreen) => {
      store.commit('userAuth/COMPLETE_ONBOARDING');
      changeScreen(selectedScreen);
    };

    const handleOnboardingSkip = () => {
      store.commit('userAuth/COMPLETE_ONBOARDING');
      changeScreen('ChatScreen');
    };

    // Prime the store with dashboard-heavy data while the app is calm —
    // before timer-trigger workflows fire (backend grants a 30s boot grace)
    // and before the user actually navigates to the Dashboard. Each
    // dispatched action handles its own caching/dedup, so this is a no-op
    // if the user already has fresh data. Without this prewarm, opening
    // Dashboard later (after workflows are running) means the heavy queries
    // contend with workflow IO for the SQLite lock and the event loop.
    const prefetchDashboardData = () => {
      if (shouldShowOnboarding.value) return;
      if (!localStorage.getItem('token')) return;

      store.dispatch('userStats/fetchStats').catch(() => {});
      store.dispatch('userStats/fetchCreditsActivity', { activityDays: 14, isCumulativeView: true }).catch(() => {});
      // Use the skinny /api/goals/summary endpoint here — fetching the full
      // /api/goals during prewarm pulled `world_state` for every goal, which
      // can run hundreds of KB per goal once the AGI loop has been used.
      // The goals screen still calls fetchGoals on its own mount when the
      // user actually navigates there.
      store.dispatch('goals/fetchGoalsSummary').catch(() => {});
      store.dispatch('tools/fetchTools').catch(() => {});
      store.dispatch('executionHistory/fetchExecutions').catch(() => {});
    };

    const ensureScreen = (screenName) => {
      loadScreen(screenName)
        .then(() => preloadLikelyScreens(screenName))
        .catch((err) => console.warn(`[screen] Failed to prepare ${screenName}:`, err));
    };

    const prefetchScreenData = (screenName) => {
      if (DASHBOARD_PREFETCH_SCREENS.has(screenName)) {
        idle(prefetchDashboardData, 3000);
      }
    };

    onMounted(() => {
      ensureScreen(activeScreen.value);
      prefetchScreenData(activeScreen.value);
    });

    watch(
      () => route.path,
      () => {
        let nextScreen = activeScreen.value;
        if (route.meta?.terminalScreen) {
          nextScreen = route.meta.terminalScreen;
        } else if (route.query.id) {
          nextScreen = 'WorkflowForgeScreen';
        } else if (route.path === '/') {
          nextScreen = getDefaultScreen();
        }

        if (nextScreen !== activeScreen.value) {
          activeScreen.value = nextScreen;
        }
        ensureScreen(nextScreen);
        prefetchScreenData(nextScreen);
      },
    );

    return {
      activeScreen,
      activeScreenComponent,
      isScreenReady,
      changeScreen,
      shouldShowOnboarding,
      handleOnboardingComplete,
      handleOnboardingSkip,
    };
  },
};
</script>
