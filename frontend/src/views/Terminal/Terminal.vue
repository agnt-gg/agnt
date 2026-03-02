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
      <KeepAlive>
        <component
          :is="activeScreenComponent"
          :key="activeScreen"
          @screen-change="changeScreen"
        />
      </KeepAlive>
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
import { ref, computed, onMounted, watch, defineAsyncComponent, shallowReactive, markRaw, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout and common
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';
import UpdateNotification from '@/views/_components/common/UpdateNotification.vue';
import OnboardingModal from '@/components/OnboardingModal.vue';

// Canvas system (provides navigation sidebar + toolbar)
import CanvasScreen from '@/canvas/CanvasScreen.vue';

// Chat + Settings loaded eagerly (default screen + auth fallback)
import ChatScreen from './CenterPanel/screens/Chat/Chat.vue';
import SettingsScreen from './CenterPanel/screens/Settings/Settings.vue';

// Shallow-reactive screen registry — screens register as they load
// Must be shallowReactive so Vue doesn't deep-proxy component objects
// (deep proxying breaks Vue internals like emitsOptions/HMR in dev mode)
const screenComponents = shallowReactive({
  ChatScreen: markRaw(ChatScreen),
  SettingsScreen: markRaw(SettingsScreen),
});

// Screens to preload in background after Chat renders
const screenLoaders = [
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
  ['RunsScreen', () => import('./CenterPanel/screens/Runs/Runs.vue')],
  ['MarketplaceScreen', () => import('./CenterPanel/screens/Marketplace/Marketplace.vue')],
  ['WidgetManagerScreen', () => import('./CenterPanel/screens/WidgetManager/WidgetManager.vue')],
  ['WidgetForgeScreen', () => import('./CenterPanel/screens/WidgetForge/WidgetForge.vue')],
  ['SkillsScreen', () => import('./CenterPanel/screens/Skills/Skills.vue')],
];

// Preload all screen chunks in parallel, register into reactive map as each resolves
const preloadScreens = () => {
  for (const [name, loader] of screenLoaders) {
    loader()
      .then((mod) => { screenComponents[name] = markRaw(mod.default); })
      .catch((err) => console.warn(`[preload] Failed to load ${name}:`, err));
  }
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

    // Placeholder shown while a screen chunk is still loading
    const ScreenPlaceholder = { template: '<div style="flex:1;width:100%;height:100%;background:var(--color-background)"></div>' };

    const activeScreenComponent = computed(() => {
      const component = screenComponents[activeScreen.value];
      if (component) return component;
      // Screen not loaded yet — show placeholder (will reactively swap when it loads)
      return ScreenPlaceholder;
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
        RunsScreen: '/runs',
        MarketplaceScreen: '/marketplace',
        WidgetManagerScreen: '/widget-manager',
        WidgetForgeScreen: '/widget-forge',
        SkillsScreen: '/skills',
      };

      if (screenName in screenRoutes) {
        activeScreen.value = screenName;
        const targetPath = screenRoutes[screenName];

        if (screenName === 'WorkflowForgeScreen' && options.workflowId) {
          router.push({ path: targetPath, query: { id: options.workflowId } });
        } else if (screenName === 'ToolForgeScreen' && options.toolId) {
          router.push({ path: targetPath, query: { 'tool-id': options.toolId } });
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
    };

    onMounted(() => {
      // Eagerly load the active screen if it's not already available
      // This ensures reloading on /workflows (etc.) shows content immediately
      const currentScreen = activeScreen.value;
      if (!screenComponents[currentScreen]) {
        const entry = screenLoaders.find(([name]) => name === currentScreen);
        if (entry) {
          entry[1]()
            .then((mod) => { screenComponents[currentScreen] = markRaw(mod.default); })
            .catch((err) => console.warn(`[eager] Failed to load ${currentScreen}:`, err));
        }
      }

      // Preload remaining screens in background after the active screen renders
      const startPreload = () => preloadScreens();
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(startPreload);
      } else {
        setTimeout(startPreload, 100);
      }
    });

    watch(
      () => route.path,
      () => {
        if (route.meta?.terminalScreen) {
          activeScreen.value = route.meta.terminalScreen;
        } else if (route.query.id) {
          activeScreen.value = 'WorkflowForgeScreen';
        } else if (route.path === '/') {
          activeScreen.value = getDefaultScreen();
        }
      },
    );

    return {
      activeScreen,
      activeScreenComponent,
      changeScreen,
      shouldShowOnboarding,
      handleOnboardingComplete,
      handleOnboardingSkip,
    };
  },
};
</script>
