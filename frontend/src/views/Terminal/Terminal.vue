<!-- Terminal.vue -->
<template>
  <TerminalLayout>
    <!-- The update banner is mounted once, in App.vue, so it also shows on the
         sign-in page. -->

    <!-- The frame: Studio's canvas (rail, toolbar, panels) or Focused's
         (one input, recents, library). Same screens, same stores, same slot —
         the mode decides only what is around them. See services/uiMode.js. -->
    <component
      :is="frameComponent"
      v-if="activeScreen !== 'BallJumperScreen'"
      :screenName="activeScreen"
      @screen-change="changeScreen"
    >
      <!-- KeepAlive caches visited screens so charts/data don't reload on every navigation -->
      <KeepAlive>
        <component
          v-if="isScreenReady"
          :is="activeScreenComponent"
          :key="mountedScreen"
          @screen-change="changeScreen"
        />
      </KeepAlive>
      <!-- Placeholder while screen chunk is loading (outside KeepAlive to avoid
           lifecycle crash). Transparent: PanelBackdrop under it already paints
           the three panel surfaces, so a flat block here would itself be a
           flash (one opaque rectangle where the panels are about to be). -->
      <div v-if="!isScreenReady" style="flex:1;width:100%;height:100%;pointer-events:none"></div>
    </component>

    <!-- BallJumper uses legacy direct rendering (no nav shell) -->
    <component
      v-else
      :is="activeScreenComponent"
      @screen-change="changeScreen"
      @exit="changeScreen('SettingsScreen')"
    />

    <!-- Studio users hear about Focused once (composables/useUiModeDefault.js). -->
    <TryFocusedNote v-if="showTryFocused && !shouldShowOnboarding" @dismiss="dismissTryFocused" />

    <!-- Onboarding Modal -->
    <OnboardingModal v-if="shouldShowOnboarding" :show="shouldShowOnboarding" @complete="handleOnboardingComplete" @skip="handleOnboardingSkip" />
  </TerminalLayout>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, shallowReactive, markRaw, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout and common
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';
import OnboardingModal from '@/components/OnboardingModal.vue';

// Canvas system (provides navigation sidebar + toolbar)
import CanvasScreen from '@/canvas/CanvasScreen.vue';
import FocusedShell from '@/views/Focused/FocusedShell.vue';
import TryFocusedNote from '@/views/Focused/TryFocusedNote.vue';
import { isUiModeToggleKey } from '@/services/uiMode.js';
import { useUiModeDefault } from '@/composables/useUiModeDefault.js';
import { screenRoute, normalizeScreen, isNavigation } from './screenRoute.js';
import { focusedLocation } from '@/views/Focused/focusedRoutes.js';
import { lazyComponent } from '@/utils/chunkRecovery.js';

// Chat is the only eager screen (it is the default). Everything else —
// including Settings, the auth fallback — is lazy but ALWAYS renderable:
// navigating to one just triggers its chunk load.
import ChatScreen from './CenterPanel/screens/Chat/Chat.vue';

// Shallow-reactive screen registry — screens register as they load
// Must be shallowReactive so Vue doesn't deep-proxy component objects
// (deep proxying breaks Vue internals like emitsOptions/HMR in dev mode)
// Every lazy screen registers UP FRONT as a recovery-wrapped async component.
// Registering only on successful preload was the second half of the blank-page
// bug: if a chunk 404'd (a rebuild deleted its hash) the screen never entered
// the map at all, so navigating there left `activeScreenComponent` null and the
// placeholder up forever, with nothing but a console warning.
const screenLoaders = [
  ['SettingsScreen', () => import('./CenterPanel/screens/Settings/Settings.vue')],
  ['AgentsScreen', () => import('./CenterPanel/screens/Agents/Agents.vue')],
  ['ToolsScreen', () => import('./CenterPanel/screens/Tools/Tools.vue')],
  ['WorkflowsScreen', () => import('./CenterPanel/screens/Workflows/Workflows.vue')],
  ['DashboardScreen', () => import('./CenterPanel/screens/Dashboard/Dashboard.vue')],
  ['WorkflowForgeScreen', () => import('./CenterPanel/screens/WorkflowForge/WorkflowForge.vue')],
  ['ToolForgeScreen', () => import('./CenterPanel/screens/ToolForge/ToolForge.vue')],
  ['BallJumperScreen', () => import('./CenterPanel/screens/Minigames/BallJumper/BallJumper.vue')],
  ['ConnectorsScreen', () => import('./CenterPanel/screens/Connectors/Connectors.vue')],
  ['PluginsScreen', () => import('./CenterPanel/screens/Plugins/Plugins.vue')],
  ['GoalsScreen', () => import('./CenterPanel/screens/Goals/Goals.vue')],
  ['TracesScreen', () => import('./CenterPanel/screens/Traces/Traces.vue')],
  ['MarketplaceScreen', () => import('./CenterPanel/screens/Marketplace/Marketplace.vue')],
  ['WidgetManagerScreen', () => import('./CenterPanel/screens/WidgetManager/WidgetManager.vue')],
  ['WidgetForgeScreen', () => import('./CenterPanel/screens/WidgetForge/WidgetForge.vue')],
  ['SkillsScreen', () => import('./CenterPanel/screens/Skills/Skills.vue')],
  ['ArtifactsScreen', () => import('./CenterPanel/screens/Artifacts/Artifacts.vue')],
  ['LearningScreen', () => import('./CenterPanel/screens/Learning/Learning.vue')],
  ['MemoryScreen', () => import('./CenterPanel/screens/Memory/Memory.vue')],
  ['WorkspaceScreen', () => import('./CenterPanel/screens/Workspace/Workspace.vue')],
];

// Shallow-reactive screen registry — screens register as they load
// Must be shallowReactive so Vue doesn't deep-proxy component objects
// (deep proxying breaks Vue internals like emitsOptions/HMR in dev mode)
const screenComponents = shallowReactive({
  ChatScreen: markRaw(ChatScreen),
  ...Object.fromEntries(
    screenLoaders.map(([name, loader]) => [name, markRaw(lazyComponent(loader, { name }))]),
  ),
});

// Warm the chunks in parallel without replacing the registered async wrappers.
// Component identity must remain stable once a wrapper can enter <KeepAlive>;
// swapping in the resolved SFC later can make Vue deactivate a vnode that was
// never activated by that KeepAlive instance, aborting unrelated renders.
const preloadScreens = () => {
  for (const [name, loader] of screenLoaders) {
    loader().catch((err) => console.warn(`[preload] Failed to load ${name}:`, err));
  }
};

export default {
  name: 'Terminal',
  components: {
    TerminalLayout,
    CanvasScreen,
    OnboardingModal,
    TryFocusedNote,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const shouldShowOnboarding = computed(() => store.getters['userAuth/shouldShowOnboarding']);

    // markRaw: component definitions must not be made reactive.
    const frames = { focused: markRaw(FocusedShell), studio: markRaw(CanvasScreen) };
    const frameComponent = computed(() => frames[store.getters['theme/uiMode']] || frames.studio);

    const { showTryFocused, dismissTryFocused } = useUiModeDefault(store);

    const onModeKey = (e) => {
      if (!isUiModeToggleKey(e)) return;
      e.preventDefault();
      store.dispatch('theme/toggleUiMode');
    };
    window.addEventListener('keydown', onModeKey);
    onBeforeUnmount(() => window.removeEventListener('keydown', onModeKey));

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

    // In Focused, a route Focused has its own page for (focusedRoutes.js)
    // mounts Chat underneath instead of the Studio screen: the page covers it,
    // the conversation keeps streaming, and Studio's screen never loads just
    // to be hidden. In Studio this is always the active screen.
    const mountedScreen = computed(() => {
      if (store.getters['theme/uiMode'] !== 'focused') return activeScreen.value;
      return focusedLocation(activeScreen.value, route.query) ? 'ChatScreen' : activeScreen.value;
    });

    const isScreenReady = computed(() => !!screenComponents[mountedScreen.value]);

    const activeScreenComponent = computed(() => {
      return screenComponents[mountedScreen.value] || null;
    });

    const changeScreen = (requestedScreen, requestedOptions = {}) => {
      const [screenName, options] = normalizeScreen(requestedScreen, requestedOptions);
      const target = screenRoute(screenName, options);
      if (!target) {
        console.warn(`Attempted to navigate to unknown screen: ${screenName}`);
        return;
      }
      activeScreen.value = screenName;
      // The ?id= / bare-path rules live in screenRoute.js (pure, tested).
      if (isNavigation(target, route.path)) {
        router.push(Object.keys(target.query).length ? target : target.path);
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

    // Deep components (EntityRef chips in a rendered message, the Jump
    // palette's ⇧-open) navigate by window event rather than by prop chain.
    const onNavigateEvent = (e) => {
      const { screen, opts } = e.detail || {};
      if (screen) changeScreen(screen, opts || {});
    };
    window.addEventListener('agnt:navigate', onNavigateEvent);
    onBeforeUnmount(() => window.removeEventListener('agnt:navigate', onNavigateEvent));

    onMounted(() => {
      // Eagerly load the active screen if it's not already available
      // This ensures reloading on /workflows (etc.) shows content immediately
      const currentScreen = activeScreen.value;
      const entry = screenLoaders.find(([name]) => name === currentScreen);
      if (entry) {
        // Warm the chunk, but keep the recovery-wrapped component identity
        // stable for the lifetime of <KeepAlive>.
        entry[1]().catch((err) => console.warn(`[eager] Failed to load ${currentScreen}:`, err));
      }

      // Preload remaining screens AND prime dashboard data in the same idle
      // window. Both run in background so the active screen paints first.
      const startPreload = () => {
        preloadScreens();
        prefetchDashboardData();
      };
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
      mountedScreen,
      frameComponent,
      showTryFocused,
      dismissTryFocused,
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
