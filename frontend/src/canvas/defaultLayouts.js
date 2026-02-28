/**
 * Default widget layouts per screen/route.
 * Each entry maps a screen name to an array of widget placements.
 * When a user visits a route for the first time, this layout is used.
 *
 * Full-canvas widgets (cols: 12, rows: 8) make existing screens
 * look identical to their current appearance.
 */

export const defaultLayouts = {
  // ── Home ──
  ChatScreen: [{ widgetId: 'chat', col: 0, row: 0, cols: 12, rows: 8 }],

  DashboardScreen: [{ widgetId: 'dashboard', col: 0, row: 0, cols: 12, rows: 8 }],

  RunsScreen: [{ widgetId: 'runs', col: 0, row: 0, cols: 12, rows: 8 }],

  // ── Assets ──
  WorkflowsScreen: [{ widgetId: 'workflows', col: 0, row: 0, cols: 12, rows: 8 }],
  AgentsScreen: [{ widgetId: 'agents', col: 0, row: 0, cols: 12, rows: 8 }],
  ToolsScreen: [{ widgetId: 'tools', col: 0, row: 0, cols: 12, rows: 8 }],

  // ── Forge ──
  WorkflowForgeScreen: [{ widgetId: 'workflow-forge', col: 0, row: 0, cols: 12, rows: 8 }],
  AgentForgeScreen: [{ widgetId: 'agent-forge', col: 0, row: 0, cols: 12, rows: 8 }],
  ToolForgeScreen: [{ widgetId: 'tool-forge', col: 0, row: 0, cols: 12, rows: 8 }],

  // ── System ──
  SettingsScreen: [{ widgetId: 'settings', col: 0, row: 0, cols: 12, rows: 8 }],
  ConnectorsScreen: [{ widgetId: 'connectors', col: 0, row: 0, cols: 12, rows: 8 }],
  MarketplaceScreen: [{ widgetId: 'marketplace', col: 0, row: 0, cols: 12, rows: 8 }],
  GoalsScreen: [{ widgetId: 'goals', col: 0, row: 0, cols: 12, rows: 8 }],
};

/**
 * Get the default layout for a screen name.
 * Falls back to a single full-canvas widget matching the screen name.
 */
export function getDefaultLayout(screenName) {
  if (defaultLayouts[screenName]) {
    return defaultLayouts[screenName];
  }
  // Fallback: derive widget ID from screen name
  const widgetId = screenName.replace('Screen', '').toLowerCase();
  return [{ widgetId, col: 0, row: 0, cols: 12, rows: 8 }];
}

/**
 * Route-to-screen mapping for default page creation.
 */
export const routeScreenMap = {
  '/': 'ChatScreen',
  '/chat': 'ChatScreen',
  '/dashboard': 'DashboardScreen',
  '/agents': 'AgentsScreen',
  '/tools': 'ToolsScreen',
  '/workflows': 'WorkflowsScreen',
  '/goals': 'GoalsScreen',
  '/runs': 'RunsScreen',
  '/settings': 'SettingsScreen',
  '/connectors': 'ConnectorsScreen',
  '/marketplace': 'MarketplaceScreen',
  '/workflow-forge': 'WorkflowForgeScreen',
  '/tool-forge': 'ToolForgeScreen',
  '/agent-forge': 'AgentForgeScreen',
};
