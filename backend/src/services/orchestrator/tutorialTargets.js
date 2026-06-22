// Registry of tour-able UI elements. Mirror of
// frontend/src/views/_components/utility/tourTargets.js — keep the two in
// sync until a build step (or HTTP endpoint) replaces the duplication.
//
// `id` is the value used in [data-tour-id="…"] on the frontend and as
// `targetTourId` in tutorial tool calls. `safeToSimulate: false` blocks
// the assistant from triggering `simulateClick` on destructive controls.
// `screen: null` means "visible on every screen" (e.g. sidebar, chrome).
export const TOUR_TARGETS = [
  // ── Sidebar (global — always visible) ──────────────────────────────
  { id: 'sidebar.chat',        screen: null, description: 'Sidebar button: Chat',         safeToSimulate: true },
  { id: 'sidebar.dashboard',   screen: null, description: 'Sidebar button: Dashboard',    safeToSimulate: true },
  { id: 'sidebar.agents',      screen: null, description: 'Sidebar button: Agents',       safeToSimulate: true },
  { id: 'sidebar.workflows',   screen: null, description: 'Sidebar button: Workflows',    safeToSimulate: true },
  { id: 'sidebar.tools',       screen: null, description: 'Sidebar button: Tools',        safeToSimulate: true },
  { id: 'sidebar.artifacts',   screen: null, description: 'Sidebar button: Artifacts',    safeToSimulate: true },
  { id: 'sidebar.lab',         screen: null, description: 'Sidebar button: Lab (Skills, Memory, Evolution, Autonomy)', safeToSimulate: true },
  { id: 'sidebar.add-page',    screen: null, description: 'Sidebar button: + New custom page', safeToSimulate: true },
  { id: 'sidebar.marketplace', screen: null, description: 'Sidebar button: Marketplace',  safeToSimulate: true },
  { id: 'sidebar.widgets',     screen: null, description: 'Sidebar button: Widgets',      safeToSimulate: true },
  { id: 'sidebar.connect',     screen: null, description: 'Sidebar button: Connectors',   safeToSimulate: true },
  { id: 'sidebar.settings',    screen: null, description: 'Sidebar button: Settings',     safeToSimulate: true },
  { id: 'sidebar.toggle',      screen: null, description: 'Sidebar collapse/expand toggle', safeToSimulate: true },

  // ── Workflows ──────────────────────────────────────────────────────
  { id: 'workflows.add-node-button', screen: 'WorkflowsScreen', description: 'Opens the node picker to add a new workflow node', safeToSimulate: true },
  { id: 'workflows.canvas',          screen: 'WorkflowsScreen', description: 'The workflow design canvas', safeToSimulate: false },
  { id: 'workflows.run-button',      screen: 'WorkflowsScreen', description: 'Activates the current workflow (consumes credits)', safeToSimulate: false },

  // ── Agents ─────────────────────────────────────────────────────────
  { id: 'agents.create-button',      screen: 'AgentsScreen',    description: 'Open AgentForge to create a new agent', safeToSimulate: true },

  // ── Dashboard ──────────────────────────────────────────────────────
  { id: 'dashboard.global-pulse-ribbon', screen: 'DashboardScreen', description: 'The Global Pulse ribbon showing live system metrics', safeToSimulate: false },
];

export const TOUR_TARGETS_BY_ID = Object.fromEntries(TOUR_TARGETS.map((t) => [t.id, t]));

export function listTargets(screen) {
  if (!screen) return TOUR_TARGETS;
  // Always include globals (screen === null) so sidebar/chrome entries are
  // discoverable from every screen, not just the unfiltered list.
  return TOUR_TARGETS.filter((t) => t.screen === screen || t.screen === null);
}

export function resolveTargetIdToSelector(id) {
  return TOUR_TARGETS_BY_ID[id] ? `[data-tour-id="${id}"]` : null;
}
