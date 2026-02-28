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
      <!-- Screen rendered directly (no widget/canvas overhead) -->
      <component
        :is="activeScreenComponent"
        @screen-change="changeScreen"
      />
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
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
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

// All other screens lazy-loaded on first navigation
const screenComponents = {
  ChatScreen,
  SettingsScreen,
  AgentsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Agents/Agents.vue')),
  ToolsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Tools/Tools.vue')),
  WorkflowsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Workflows/Workflows.vue')),
  DashboardScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Dashboard/Dashboard.vue')),
  WorkflowForgeScreen: defineAsyncComponent(() => import('./CenterPanel/screens/WorkflowForge/WorkflowForge.vue')),
  ToolForgeScreen: defineAsyncComponent(() => import('./CenterPanel/screens/ToolForge/ToolForge.vue')),
  AgentForgeScreen: defineAsyncComponent(() => import('./CenterPanel/screens/AgentForge/AgentForge.vue')),
  BallJumperScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Minigames/BallJumper/BallJumper.vue')),
  ConnectorsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Connectors/Connectors.vue')),
  GoalsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Goals/Goals.vue')),
  RunsScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Runs/Runs.vue')),
  MarketplaceScreen: defineAsyncComponent(() => import('./CenterPanel/screens/Marketplace/Marketplace.vue')),
  WidgetManagerScreen: defineAsyncComponent(() => import('./CenterPanel/screens/WidgetManager/WidgetManager.vue')),
  WidgetForgeScreen: defineAsyncComponent(() => import('./CenterPanel/screens/WidgetForge/WidgetForge.vue')),
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

    const activeScreenComponent = computed(() => {
      if (!screenComponents[activeScreen.value]) {
        console.warn(`Screen ${activeScreen.value} not found, defaulting to ChatScreen.`);
        activeScreen.value = 'ChatScreen';
      }
      return screenComponents[activeScreen.value];
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
      };

      if (screenName in screenRoutes) {
        activeScreen.value = screenName;
        const targetPath = screenRoutes[screenName];

        if (screenName === 'WorkflowForgeScreen' && options.workflowId) {
          router.push({ path: targetPath, query: { id: options.workflowId } });
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
      // Screen is already initialized from route in getScreenFromRoute()
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
