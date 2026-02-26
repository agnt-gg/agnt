/**
 * Register all built-in widgets.
 * Import this file once at app startup to populate the widget registry.
 * Screen components are lazy-loaded — only fetched when a widget is rendered.
 */

import { defineAsyncComponent } from 'vue';
import { registerWidget } from '../widgetRegistry.js';

export function registerAllWidgets() {
  // ── Dashboard cards (small composable widgets, lazy-loaded) ──
  registerWidget('goals-map', {
    name: 'Goals Map',
    icon: 'fas fa-bullseye',
    category: 'dashboard',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Dashboard/components/GoalsMap.vue')),
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Goal progress overview',
  });

  registerWidget('agents-swarm', {
    name: 'Agents Swarm',
    icon: 'fas fa-robot',
    category: 'dashboard',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Dashboard/components/AgentsSwarm.vue')),
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Agent status display',
  });

  registerWidget('runs-queue', {
    name: 'Runs Queue',
    icon: 'fas fa-play-circle',
    category: 'dashboard',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Dashboard/components/RunsQueue.vue')),
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Execution queue stats',
  });

  // ── Full screen widgets (lazy-loaded, only fetched when widget is rendered) ──
  registerWidget('chat', {
    name: 'Chat',
    icon: 'fas fa-comments',
    category: 'home',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Chat/Chat.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'AI chat interface',
    isScreenWidget: true,
  });

  registerWidget('dashboard', {
    name: 'Dashboard',
    icon: 'fas fa-tachometer-alt',
    category: 'home',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Dashboard/Dashboard.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Overview dashboard',
    isScreenWidget: true,
  });

  registerWidget('agents', {
    name: 'Agents',
    icon: 'fas fa-robot',
    category: 'assets',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Agents/Agents.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Agent management',
    isScreenWidget: true,
  });

  registerWidget('tools', {
    name: 'Tools',
    icon: 'fas fa-wrench',
    category: 'assets',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Tools/Tools.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Tool management',
    isScreenWidget: true,
  });

  registerWidget('workflows', {
    name: 'Workflows',
    icon: 'fas fa-project-diagram',
    category: 'assets',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Workflows/Workflows.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Workflow management',
    isScreenWidget: true,
  });

  registerWidget('goals', {
    name: 'Goals',
    icon: 'fas fa-bullseye',
    category: 'home',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Goals/Goals.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Goal tracking & management',
    isScreenWidget: true,
  });

  registerWidget('runs', {
    name: 'Runs',
    icon: 'fas fa-play-circle',
    category: 'home',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Runs/Runs.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Execution history',
    isScreenWidget: true,
  });

  registerWidget('settings', {
    name: 'Settings',
    icon: 'fas fa-cog',
    category: 'system',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Settings/Settings.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Application settings',
    isScreenWidget: true,
  });

  registerWidget('secrets', {
    name: 'Secrets',
    icon: 'fas fa-key',
    category: 'system',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Secrets/Secrets.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'API keys & secrets',
    isScreenWidget: true,
  });

  registerWidget('marketplace', {
    name: 'Marketplace',
    icon: 'fas fa-store',
    category: 'system',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Plugin marketplace',
    isScreenWidget: true,
  });

  registerWidget('workflow-forge', {
    name: 'Workflow Forge',
    icon: 'fas fa-hammer',
    category: 'forge',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/WorkflowForge/WorkflowForge.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Build workflows visually',
    isScreenWidget: true,
  });

  registerWidget('tool-forge', {
    name: 'Tool Forge',
    icon: 'fas fa-tools',
    category: 'forge',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/ToolForge/ToolForge.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom tools',
    isScreenWidget: true,
  });

  registerWidget('agent-forge', {
    name: 'Agent Forge',
    icon: 'fas fa-user-cog',
    category: 'forge',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/AgentForge/AgentForge.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom agents',
    isScreenWidget: true,
  });

  registerWidget('widget-manager', {
    name: 'Widget Manager',
    icon: 'fas fa-puzzle-piece',
    category: 'forge',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/WidgetManager/WidgetManager.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Manage custom widgets',
    isScreenWidget: true,
  });

  registerWidget('widget-forge', {
    name: 'Widget Forge',
    icon: 'fas fa-magic',
    category: 'forge',
    component: defineAsyncComponent(() => import('@/views/Terminal/CenterPanel/screens/WidgetForge/WidgetForge.vue')),
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom widgets',
    isScreenWidget: true,
  });
}
