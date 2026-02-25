import { createRouter, createWebHistory } from 'vue-router';
// import Marketplace from '@/views/Marketplace/Marketplace.vue';
// import ExecutionDetails from '@/views/ExecutionDetails/ExecutionDetails.vue';
import Terminal from '@/views/Terminal/Terminal.vue';
import DocsView from '@/views/Docs/Docs.vue';
import OAuthCallback from '@/views/_components/utility/OAuthCallback.vue';
import store from '@/store/state';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Terminal',
      component: Terminal,
      meta: { requiresAuth: true },
    },
    {
      path: '/dashboard',
      name: 'TerminalDashboard',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'DashboardScreen' },
    },
    // {
    //   path: '/marketplace',
    //   name: 'Marketplace',
    //   component: Marketplace,
    //   meta: { requiresAuth: true },
    // },
    {
      path: '/chat',
      name: 'TerminalChat',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'ChatScreen' },
    },
    {
      path: '/tool-forge',
      name: 'TerminalToolForge',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'ToolForgeScreen' },
    },
    {
      path: '/workflow-forge',
      name: 'TerminalWorkflowForge',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'WorkflowForgeScreen' },
    },
    // {
    //   path: '/execution/:id',
    //   name: 'ExecutionDetails',
    //   component: ExecutionDetails,
    // },
    {
      path: '/docs',
      component: DocsView,
      children: [
        {
          path: '',
          name: 'Docs',
          component: DocsView,
        },
        {
          path: ':type/:page',
          name: 'DocsPage',
          component: DocsView,
        },
      ],
    },
    {
      path: '/settings',
      name: 'TerminalSettings',
      component: Terminal,
      meta: { terminalScreen: 'SettingsScreen' },
    },
    {
      path: '/secrets',
      name: 'TerminalSecrets',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'SecretsScreen' },
    },
    {
      path: '/agents',
      name: 'TerminalAgents',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'AgentsScreen' },
    },
    {
      path: '/tools',
      name: 'TerminalTools',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'ToolsScreen' },
    },
    {
      path: '/workflows',
      name: 'TerminalWorkflows',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'WorkflowsScreen' },
    },
    {
      path: '/marketplace',
      name: 'TerminalMarketplace',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'MarketplaceScreen' },
    },
    {
      path: '/agent-forge',
      name: 'TerminalAgentForge',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'AgentForgeScreen' },
    },
    {
      path: '/goals',
      name: 'TerminalGoals',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'GoalsScreen' },
    },
    {
      path: '/runs',
      name: 'TerminalRuns',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'RunsScreen' },
    },
    {
      path: '/widget-manager',
      name: 'TerminalWidgetManager',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'WidgetManagerScreen' },
    },
    {
      path: '/widget-forge',
      name: 'TerminalWidgetForge',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'WidgetForgeScreen' },
    },
    {
      path: '/ball-jumper',
      name: 'TerminalBallJumper',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'BallJumperScreen' },
    },
    {
      path: '/oauth-callback',
      name: 'OAuthCallback',
      component: OAuthCallback,
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  // Check if this is an OAuth callback (has code parameter) and redirect to settings
  if (to.path === '/settings' && to.query.code) {
    console.log('OAuth callback detected, redirecting to settings page');
    next({
      path: '/secrets',
      query: to.query, // Preserve all query parameters
    });
    return;
  }

  if (to.meta.requiresAuth && !store.state.userAuth.user) {
    try {
      // If no user in store, try to fetch user data
      await store.dispatch('userAuth/fetchUserData');

      if (!store.state.userAuth.user) {
        // If still no user after fetch attempt, redirect to login
        next('/settings');
      } else {
        next();
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      next('/settings');
    }
  } else {
    next();
  }
});

// Add error handling to prevent infinite loading on failed routes
router.onError((error) => {
  console.error('Router error:', error);
  // You might want to set isLoading to false here if you expose it globally
});

export default router;
