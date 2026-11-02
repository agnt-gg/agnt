<!-- Terminal.vue -->
<template>
  <TerminalLayout>
    <!-- The update banner is mounted once, in App.vue, so it also shows on the
         sign-in page. -->

    <!-- The frame: AGNT One (views/One/OneShell.vue) or Studio (canvas/CanvasScreen.vue: the full
         rail, toolbar, custom pages and panels). Same screens, same stores, same slot; the saved
         layout (theme/uiMode, services/uiMode.js) decides which is around them. -->
    <!-- The auth boundary owns the whole shell, not just the center screen. -->
    <component v-if="!isAuthenticated" :is="signInComponent" @screen-change="changeScreen" />
    <component
      :is="frameComponent"
      v-else-if="activeScreen !== 'BallJumperScreen'"
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
  </TerminalLayout>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch, shallowReactive, markRaw, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';

// Layout and common
import TerminalLayout from '@/views/_components/layout/TerminalLayout.vue';

// The two frames: AGNT One (rail, one top bar, the chat) and Studio (everything).
import OneShell from '@/views/One/OneShell.vue';
import CanvasScreen from '@/canvas/CanvasScreen.vue';
import { isUiModeToggleKey } from '@/services/uiMode.js';
import { screenRoute, normalizeScreen, isNavigation } from './screenRoute.js';
import { focusedLocation } from '@/views/Focused/focusedRoutes.js';
import { lazyComponent } from '@/utils/chunkRecovery.js';
import { syncTeamSpaces } from '@/composables/useSpaces.js';

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
  // Studio's frame for teamspaces (One draws /team as its own page and never mounts this).
  ['TeamScreen', () => import('./CenterPanel/screens/Team/Team.vue')],
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
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

    const isAuthenticated = computed(() => store.getters['userAuth/isAuthenticated'] === true);
    const signInComponent = screenComponents.SettingsScreen;
    const shouldShowOnboarding = computed(() => store.getters['userAuth/shouldShowOnboarding']);

    // markRaw: component definitions must not be made reactive. 'focused' is the saved name for One.
    // Studio was unplugged on 2026-10-18 ("One is the app's only frame"); every Studio screen, its
    // rail, custom pages and Navigation settings stayed in the code, so they come back as a choice.
    const frames = { focused: markRaw(OneShell), studio: markRaw(CanvasScreen) };
    const uiMode = computed(() => store.getters['theme/uiMode']);
    const isOne = computed(() => uiMode.value !== 'studio');
    const frameComponent = computed(() => (isOne.value ? frames.focused : frames.studio));

    const onModeKey = (e) => {
      if (!isAuthenticated.value || !isUiModeToggleKey(e)) return;
      e.preventDefault();
      store.dispatch('theme/toggleUiMode');
    };
    window.addEventListener('keydown', onModeKey);
    onBeforeUnmount(() => window.removeEventListener('keydown', onModeKey));

    // AGNT One has no onboarding pages: a signed-in account lands in the chat,
    // already on AGNT Flash (aiProvider.applyIncludedModelDefault picks it when
    // the server has no default). Marking the old flag done keeps every gate
    // that still reads it (dashboard prefetch, the journey) open.
    watch(
      shouldShowOnboarding,
      (show) => {
        if (show) store.commit('userAuth/COMPLETE_ONBOARDING');
      },
      { immediate: true },
    );

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

    // A route One has its own page for (focusedRoutes.js) mounts Chat
    // underneath instead of the full screen: the page covers it, the
    // conversation keeps streaming, and the full screen never loads just to
    // be hidden.
    // In Studio there are no One pages: the full screen always mounts.
    const mountedScreen = computed(() => (isOne.value && focusedLocation(activeScreen.value, route.query) ? 'ChatScreen' : activeScreen.value));

    const isScreenReady = computed(() => !!screenComponents[mountedScreen.value]);

    const activeScreenComponent = computed(() => {
      return screenComponents[mountedScreen.value] || null;
    });

    const changeScreen = (requestedScreen, requestedOptions = {}) => {
      if (!isAuthenticated.value && requestedScreen !== 'SettingsScreen') return;
      const [screenName, normalized] = normalizeScreen(requestedScreen, requestedOptions);
      // A screen opened in full (?studio=1) that moves within itself (Settings'
      // own menu: another section) stays in full. Dropping the flag handed the
      // route to AGNT One's page and the section never showed (2026-10-23).
      const stayFull = route.query?.studio === '1' && screenName === activeScreen.value;
      const options = stayFull ? { ...normalized, studio: true } : normalized;
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

    // In either frame, once signed in: hand the desktop the user's teams so it
    // can open the space they were last in (useSpaces.syncTeamSpaces).
    watch(isAuthenticated, (signedIn) => { if (signedIn) syncTeamSpaces(); }, { immediate: true });

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
      isAuthenticated,
      signInComponent,
      mountedScreen,
      frameComponent,
      activeScreen,
      activeScreenComponent,
      isScreenReady,
      changeScreen,
    };
  },
};
</script>
