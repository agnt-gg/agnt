import { createRouter, createWebHistory } from 'vue-router';
// import Marketplace from '@/views/Marketplace/Marketplace.vue';
// import ExecutionDetails from '@/views/ExecutionDetails/ExecutionDetails.vue';
import Terminal from '@/views/Terminal/Terminal.vue';
const DocsView = () => import('@/views/Docs/Docs.vue');
import OAuthCallback from '@/views/_components/utility/OAuthCallback.vue';
const PairView = () => import('@/views/Pair/Pair.vue');
const MobileHome = () => import('@/views/MobileLite/MobileHome.vue');
const MobilePair = () => import('@/views/MobileLite/MobilePair.vue');
const MobileChat = () => import('@/views/MobileLite/MobileChat.vue');
import store from '@/store/state';
import { createAuthGuard } from './authGuard.js';
import { pluginRouteRecords } from './pluginRoutes.js';

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
    // Workspaces (additive — nothing else routes here).
    {
      path: '/workspace',
      name: 'TerminalWorkspace',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'WorkspaceScreen' },
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
    ...pluginRouteRecords(Terminal),
    {
      // AI models are Settings › AI Models. Kept as a redirect rather than
      // deleted: the path shipped, and a bookmark that lands on the right page
      // beats one that 404s.
      path: '/providers',
      redirect: { path: '/settings', query: { section: 'providers' } },
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
    // Agent Forge is now the new-agent modal on Agents; old links still land.
    { path: '/agent-forge', redirect: { path: '/agents', query: { new: '1' } } },
    {
      path: '/goals',
      name: 'TerminalGoals',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'GoalsScreen' },
    },
    {
      path: '/traces',
      name: 'TerminalTraces',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'TracesScreen' },
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
      path: '/skills',
      name: 'TerminalSkills',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'SkillsScreen' },
    },
    {
      path: '/artifacts',
      name: 'TerminalArtifacts',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'ArtifactsScreen' },
    },
    {
      path: '/ball-jumper',
      name: 'TerminalBallJumper',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'BallJumperScreen' },
    },
    {
      path: '/learning',
      name: 'TerminalLearning',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'LearningScreen' },
    },
    {
      path: '/experiments',
      name: 'TerminalExperiments',
      redirect: to => ({path:'/learning',query:to.query}),
    },
    {
      path: '/memory',
      name: 'TerminalMemory',
      component: Terminal,
      meta: { requiresAuth: true, terminalScreen: 'MemoryScreen' },
    },
    {
      path: '/autonomy',
      name: 'TerminalAutonomy',
      redirect: to => ({path:to.query.section==='schedules'?'/goals':'/learning',query:to.query}),
    },
    {
      // Device pairing landing page. NOT requiresAuth — the whole point is
      // that the phone arrives with no session and trades the code for one.
      path: '/pair',
      name: 'Pair',
      component: PairView,
    },
    // ------------------------------------------------------------------
    // Mobile lite (path B) — chat-only Annie client.
    // Pairing reuses POST /api/pairing/claim; web full app keeps /pair.
    // ------------------------------------------------------------------
    {
      path: '/m',
      name: 'MobileHome',
      component: MobileHome,
      meta: { lite: true },
    },
    {
      path: '/m/pair',
      name: 'MobilePair',
      component: MobilePair,
      meta: { lite: true },
    },
    {
      path: '/m/chat',
      name: 'MobileChat',
      component: MobileChat,
      meta: { requiresAuth: true, lite: true },
    },
    {
      path: '/oauth-callback',
      name: 'OAuthCallback',
      component: OAuthCallback,
    },
  ],
});

router.beforeEach(createAuthGuard(store));

// Add error handling to prevent infinite loading on failed routes
router.onError((error) => {
  console.error('Router error:', error);
  // You might want to set isLoading to false here if you expose it globally
});

export default router;
