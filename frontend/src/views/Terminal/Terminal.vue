<!-- Terminal.vue -->
<template>
  <TerminalLayout>
    <!-- Update Notification Banner -->
    <UpdateNotification />

    <!-- Canvas-based dynamic screen system -->
    <CanvasScreen
      v-if="useCanvasMode"
      :screenName="activeScreen"
      @screen-change="changeScreen"
    />

    <!-- Legacy: direct screen component (for screens not yet in canvas, e.g. BallJumper) -->
    <component
      v-else
      :is="activeScreenComponent"
      @screen-change="changeScreen"
      v-on="activeScreen === 'BallJumperScreen' ? { exit: () => changeScreen('SettingsScreen') } : {}"
    />

    <!-- Onboarding Modal -->
    <OnboardingModal v-if="shouldShowOnboarding" :show="shouldShowOnboarding" @complete="handleOnboardingComplete" @skip="handleOnboardingSkip" />
  </TerminalLayout>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout and common
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';
import UpdateNotification from '@/views/_components/common/UpdateNotification.vue';
import OnboardingModal from '@/components/OnboardingModal.vue';

// Canvas system
import CanvasScreen from '@/canvas/CanvasScreen.vue';

// Legacy screen imports (only for non-canvas screens like BallJumper)
import BallJumperScreen from './CenterPanel/screens/Minigames/BallJumper/BallJumper.vue';

// Screen names that still use legacy rendering (not in canvas system)
const LEGACY_SCREENS = new Set(['BallJumperScreen']);

export default {
  name: 'Terminal',
  components: {
    TerminalLayout,
    CanvasScreen,
    BallJumperScreen,
    OnboardingModal,
    UpdateNotification,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const shouldShowOnboarding = computed(() => store.getters['userAuth/shouldShowOnboarding']);

    const getDefaultScreen = () => 'ChatScreen';
    const activeScreen = ref(getDefaultScreen());

    // Whether to use the canvas system or legacy direct rendering
    const useCanvasMode = computed(() => !LEGACY_SCREENS.has(activeScreen.value));

    // Legacy component resolution (only for non-canvas screens)
    const activeScreenComponent = computed(() => {
      const screens = { BallJumperScreen };
      return screens[activeScreen.value] || null;
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
        SecretsScreen: '/secrets',
        GoalsScreen: '/goals',
        RunsScreen: '/runs',
        MarketplaceScreen: '/marketplace',
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

    onMounted(async () => {
      if (route.meta?.terminalScreen) {
        activeScreen.value = route.meta.terminalScreen;
      } else if (route.query.id) {
        activeScreen.value = 'WorkflowForgeScreen';
      } else {
        activeScreen.value = getDefaultScreen();
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
      useCanvasMode,
      activeScreenComponent,
      changeScreen,
      shouldShowOnboarding,
      handleOnboardingComplete,
      handleOnboardingSkip,
    };
  },
};
</script>
