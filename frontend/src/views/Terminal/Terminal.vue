<!-- Terminal.vue -->
<template>
  <TerminalLayout>
    <!-- Update Notification Banner -->
    <UpdateNotification />

    <!-- Dynamically render active screen -->
    <component
      :is="activeScreenComponent"
      @screen-change="changeScreen"
      v-on="activeScreen === 'BallJumperScreen' ? { exit: () => changeScreen('SettingsScreen') } : {}"
    />

    <!-- Onboarding Modal -->
    <OnboardingModal v-if="shouldShowOnboarding" :show="shouldShowOnboarding" @complete="handleOnboardingComplete" @skip="handleOnboardingSkip" />
  </TerminalLayout>
</template>

<script>
import { ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout components - loaded immediately (needed for app shell)
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';
import UpdateNotification from '@/views/_components/common/UpdateNotification.vue';

// LAZY LOAD all screen components - only loaded when user navigates to them
// This reduces initial bundle size by ~50% and speeds up first paint
const ChatScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Chat/Chat.vue'));
const AgentsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Agents/Agents.vue'));
const ToolsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Tools/Tools.vue'));
const WorkflowsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Workflows/Workflows.vue'));
const DashboardScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Dashboard/Dashboard.vue'));
const SettingsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Settings/Settings.vue'));
const WorkflowForgeScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/WorkflowForge/WorkflowForge.vue'));
const ToolForgeScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/ToolForge/ToolForge.vue'));
const AgentForgeScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/AgentForge/AgentForge.vue'));
const BallJumperScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Minigames/BallJumper/BallJumper.vue'));
const SecretsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Secrets/Secrets.vue'));
const GoalsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Goals/Goals.vue'));
const RunsScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Runs/Runs.vue'));
const MarketplaceScreen = defineAsyncComponent(() =>
  import('./CenterPanel/screens/Marketplace/Marketplace.vue'));
const OnboardingModal = defineAsyncComponent(() =>
  import('@/components/OnboardingModal.vue'));

export default {
  name: 'Terminal',
  components: {
    TerminalLayout,
    ChatScreen,
    AgentsScreen,
    ToolsScreen,
    WorkflowsScreen,
    DashboardScreen,
    SettingsScreen,
    WorkflowForgeScreen,
    ToolForgeScreen,
    AgentForgeScreen,
    BallJumperScreen,
    SecretsScreen,
    GoalsScreen,
    RunsScreen,
    MarketplaceScreen,
    OnboardingModal,
    UpdateNotification,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const userLevel = computed(() => store.getters['userStats/level']);
    const shouldShowOnboarding = computed(() => store.getters['userAuth/shouldShowOnboarding']);

    const getDefaultScreen = () => {
      return 'ChatScreen';
    };

    const activeScreen = ref(getDefaultScreen());

    const activeScreenComponent = computed(() => {
      const screens = {
        ChatScreen,
        AgentsScreen,
        ToolsScreen,
        WorkflowsScreen,
        DashboardScreen,
        SettingsScreen,
        WorkflowForgeScreen,
        ToolForgeScreen,
        AgentForgeScreen,
        BallJumperScreen,
        SecretsScreen,
        GoalsScreen,
        RunsScreen,
        MarketplaceScreen,
      };
      if (!screens[activeScreen.value]) {
        console.warn(`Default screen ${activeScreen.value} not found, defaulting to ChatScreen.`);
        activeScreen.value = 'ChatScreen';
      }
      return screens[activeScreen.value];
    });

    const changeScreen = (screenName, options = {}) => {
      // Map screen names to their routes
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
        SecretsScreen: '/secrets',
        GoalsScreen: '/goals',
        RunsScreen: '/runs',
        MarketplaceScreen: '/marketplace',
      };

      if (screenName in screenRoutes) {
        activeScreen.value = screenName;

        // Get the target route for this screen
        const targetPath = screenRoutes[screenName];

        // Handle special cases with query parameters
        if (screenName === 'WorkflowForgeScreen' && options.workflowId) {
          router.push({
            path: targetPath,
            query: { id: options.workflowId },
          });
        } else if (route.path !== targetPath) {
          // Only navigate if we're not already on the target path
          router.push(targetPath);
        }
      } else {
        console.warn(`Attempted to navigate to unknown screen: ${screenName}`);
      }
    };

    const handleOnboardingComplete = (selectedScreen) => {
      console.log('Onboarding completed, navigating to:', selectedScreen);
      store.commit('userAuth/COMPLETE_ONBOARDING');
      changeScreen(selectedScreen);
    };

    const handleOnboardingSkip = () => {
      console.log('Onboarding skipped');
      store.commit('userAuth/COMPLETE_ONBOARDING');
    };

    // Initialize screen based on URL parameters or default
    onMounted(async () => {
      // Check if route specifies a terminal screen
      if (route.meta?.terminalScreen) {
        activeScreen.value = route.meta.terminalScreen;
      } else if (route.query.id) {
        activeScreen.value = 'WorkflowForgeScreen';
      } else {
        activeScreen.value = getDefaultScreen();
      }

      // Note: Custom providers and user settings are loaded in main.js
      // during app initialization. No need to reload them here.
    });

    // Watch for route changes and update active screen
    watch(
      () => route.path,
      () => {
        // Check if route specifies a terminal screen
        if (route.meta?.terminalScreen) {
          activeScreen.value = route.meta.terminalScreen;
        } else if (route.query.id) {
          activeScreen.value = 'WorkflowForgeScreen';
        } else if (route.path === '/') {
          activeScreen.value = getDefaultScreen();
        }
      }
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
