/**
 * Screen name + navigation options → the route that shows it.
 *
 * Extracted from Terminal.changeScreen so the mapping is one pure function
 * that both Terminal and anything reasoning about routes (Focused's page map,
 * its tests) share. Behaviour is the function changeScreen always had.
 *
 * Returns { path, query } to push, or null for an unknown screen.
 */

export const SCREEN_ROUTES = Object.freeze({
  ChatScreen: '/chat',
  AgentsScreen: '/agents',
  ToolsScreen: '/tools',
  WorkflowsScreen: '/workflows',
  DashboardScreen: '/dashboard',
  SettingsScreen: '/settings',
  WorkflowForgeScreen: '/workflow-forge',
  ToolForgeScreen: '/tool-forge',
  BallJumperScreen: '/ball-jumper',
  ConnectorsScreen: '/connectors',
  PluginsScreen: '/plugins',
  GoalsScreen: '/goals',
  TracesScreen: '/traces',
  MarketplaceScreen: '/marketplace',
  WidgetManagerScreen: '/widget-manager',
  WidgetForgeScreen: '/widget-forge',
  SkillsScreen: '/skills',
  ArtifactsScreen: '/artifacts',
  ExperimentsScreen: '/experiments',
  MemoryScreen: '/memory',
  AutonomyScreen: '/autonomy',
  WorkspaceScreen: '/workspace',
});

/**
 * Agent Forge became a modal on Agents. Every old entry point (dashboard,
 * nav, jump palette, chat's "edit agent") resolves here: with an agent id it
 * opens that agent, otherwise it opens the new-agent modal.
 */
export function normalizeScreen(screenName, options = {}) {
  if (screenName !== 'AgentForgeScreen') return [screenName, options];
  return [
    'AgentsScreen',
    options.agentId ? { ...options, select: { kind: 'agent', id: options.agentId } } : { ...options, newAgent: true },
  ];
}

export function screenRoute(screenName, options = {}) {
  const path = SCREEN_ROUTES[screenName];
  if (!path) return null;
  let query = {};
  let force = false;

  if (screenName === 'WorkflowForgeScreen' && options.workflowId) {
    query = { id: options.workflowId };
  } else if (screenName === 'WorkflowForgeScreen' && 'workflowId' in options) {
    // Explicitly no workflow ("+ New workflow"): drop any ?id= so the forge
    // opens its blank canvas instead of the last workflow. Pushed even when
    // already on /workflow-forge — that is exactly when ?id= must go.
    force = true;
  } else if (screenName === 'ToolForgeScreen' && options.toolId) {
    query = { 'tool-id': options.toolId };
  } else if (screenName === 'TracesScreen' && options.selectedExecutionId) {
    query = { executionId: options.selectedExecutionId };
  } else if (screenName === 'ExperimentsScreen' && options.selectedInsight) {
    query = { insightId: options.selectedInsight.id };
  } else {
    // Generic navigation intents, carried in the URL so a deep link reproduces
    // them: `select` opens an entity in the screen's inspector, `section`
    // picks a left-nav view, `status` presets a list filter, `newGoal` /
    // `newAgent` open a composer.
    if (options.select) query.select = `${options.select.kind}:${options.select.id}`;
    if (options.section) query.section = options.section;
    if (options.status) query.status = options.status;
    if (options.newGoal || options.newAgent) query.new = '1';
  }
  // Focused: render the full Studio screen even where Focused has a page.
  if (options.studio) query.studio = '1';
  return { path, query, force };
}

/**
 * Whether pushing `target` is a navigation at all. A bare path that is
 * already current is not (changeScreen never pushed one).
 */
export function isNavigation(target, currentPath) {
  if (!target) return false;
  return target.force || Object.keys(target.query).length > 0 || target.path !== currentPath;
}
