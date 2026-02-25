/**
 * Register all built-in widgets.
 * Import this file once at app startup to populate the widget registry.
 */

import { registerWidget } from '../widgetRegistry.js';

// ── Dashboard card widgets (small, composable) ──
import GoalsMap from '@/views/Terminal/CenterPanel/screens/Dashboard/components/GoalsMap.vue';
import AgentsSwarm from '@/views/Terminal/CenterPanel/screens/Dashboard/components/AgentsSwarm.vue';
import RunsQueue from '@/views/Terminal/CenterPanel/screens/Dashboard/components/RunsQueue.vue';

// ── Screen widgets (full-page components adapted for widget mode) ──
// These are the existing screen components. They'll receive widgetMode=true
// but most will ignore it initially (rendering normally).
import ChatScreen from '@/views/Terminal/CenterPanel/screens/Chat/Chat.vue';
import DashboardScreen from '@/views/Terminal/CenterPanel/screens/Dashboard/Dashboard.vue';
import AgentsScreen from '@/views/Terminal/CenterPanel/screens/Agents/Agents.vue';
import ToolsScreen from '@/views/Terminal/CenterPanel/screens/Tools/Tools.vue';
import WorkflowsScreen from '@/views/Terminal/CenterPanel/screens/Workflows/Workflows.vue';
import SettingsScreen from '@/views/Terminal/CenterPanel/screens/Settings/Settings.vue';
import GoalsScreen from '@/views/Terminal/CenterPanel/screens/Goals/Goals.vue';
import RunsScreen from '@/views/Terminal/CenterPanel/screens/Runs/Runs.vue';
import SecretsScreen from '@/views/Terminal/CenterPanel/screens/Secrets/Secrets.vue';
import MarketplaceScreen from '@/views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue';
import WorkflowForgeScreen from '@/views/Terminal/CenterPanel/screens/WorkflowForge/WorkflowForge.vue';
import ToolForgeScreen from '@/views/Terminal/CenterPanel/screens/ToolForge/ToolForge.vue';
import AgentForgeScreen from '@/views/Terminal/CenterPanel/screens/AgentForge/AgentForge.vue';
import WidgetManagerScreen from '@/views/Terminal/CenterPanel/screens/WidgetManager/WidgetManager.vue';
import WidgetForgeScreen from '@/views/Terminal/CenterPanel/screens/WidgetForge/WidgetForge.vue';

export function registerAllWidgets() {
  // ── Dashboard cards (small composable widgets) ──
  registerWidget('goals-map', {
    name: 'Goals Map',
    icon: 'fas fa-bullseye',
    category: 'dashboard',
    component: GoalsMap,
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Goal progress overview',
  });

  registerWidget('agents-swarm', {
    name: 'Agents Swarm',
    icon: 'fas fa-robot',
    category: 'dashboard',
    component: AgentsSwarm,
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Agent status display',
  });

  registerWidget('runs-queue', {
    name: 'Runs Queue',
    icon: 'fas fa-play-circle',
    category: 'dashboard',
    component: RunsQueue,
    defaultSize: { cols: 4, rows: 4 },
    minSize: { cols: 2, rows: 2 },
    description: 'Execution queue stats',
  });

  // ── Full screen widgets ──
  registerWidget('chat', {
    name: 'Chat',
    icon: 'fas fa-comments',
    category: 'home',
    component: ChatScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'AI chat interface',
    isScreenWidget: true,
  });

  registerWidget('dashboard', {
    name: 'Dashboard',
    icon: 'fas fa-tachometer-alt',
    category: 'home',
    component: DashboardScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Overview dashboard',
    isScreenWidget: true,
  });

  registerWidget('agents', {
    name: 'Agents',
    icon: 'fas fa-robot',
    category: 'assets',
    component: AgentsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Agent management',
    isScreenWidget: true,
  });

  registerWidget('tools', {
    name: 'Tools',
    icon: 'fas fa-wrench',
    category: 'assets',
    component: ToolsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Tool management',
    isScreenWidget: true,
  });

  registerWidget('workflows', {
    name: 'Workflows',
    icon: 'fas fa-project-diagram',
    category: 'assets',
    component: WorkflowsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Workflow management',
    isScreenWidget: true,
  });

  registerWidget('goals', {
    name: 'Goals',
    icon: 'fas fa-bullseye',
    category: 'home',
    component: GoalsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Goal tracking & management',
    isScreenWidget: true,
  });

  registerWidget('runs', {
    name: 'Runs',
    icon: 'fas fa-play-circle',
    category: 'home',
    component: RunsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Execution history',
    isScreenWidget: true,
  });

  registerWidget('settings', {
    name: 'Settings',
    icon: 'fas fa-cog',
    category: 'system',
    component: SettingsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Application settings',
    isScreenWidget: true,
  });

  registerWidget('secrets', {
    name: 'Secrets',
    icon: 'fas fa-key',
    category: 'system',
    component: SecretsScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'API keys & secrets',
    isScreenWidget: true,
  });

  registerWidget('marketplace', {
    name: 'Marketplace',
    icon: 'fas fa-store',
    category: 'system',
    component: MarketplaceScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 4, rows: 3 },
    description: 'Plugin marketplace',
    isScreenWidget: true,
  });

  registerWidget('workflow-forge', {
    name: 'Workflow Forge',
    icon: 'fas fa-hammer',
    category: 'forge',
    component: WorkflowForgeScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Build workflows visually',
    isScreenWidget: true,
  });

  registerWidget('tool-forge', {
    name: 'Tool Forge',
    icon: 'fas fa-tools',
    category: 'forge',
    component: ToolForgeScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom tools',
    isScreenWidget: true,
  });

  registerWidget('agent-forge', {
    name: 'Agent Forge',
    icon: 'fas fa-user-cog',
    category: 'forge',
    component: AgentForgeScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom agents',
    isScreenWidget: true,
  });

  registerWidget('widget-manager', {
    name: 'Widget Manager',
    icon: 'fas fa-puzzle-piece',
    category: 'forge',
    component: WidgetManagerScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Manage custom widgets',
    isScreenWidget: true,
  });

  registerWidget('widget-forge', {
    name: 'Widget Forge',
    icon: 'fas fa-magic',
    category: 'forge',
    component: WidgetForgeScreen,
    defaultSize: { cols: 12, rows: 8 },
    minSize: { cols: 6, rows: 4 },
    description: 'Create custom widgets',
    isScreenWidget: true,
  });
}
