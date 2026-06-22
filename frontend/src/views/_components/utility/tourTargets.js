// Curated map of tour-able UI elements. Mirror of
// backend/src/services/orchestrator/tutorialTargets.js — keep both in sync.
//
// Tag a DOM element with `data-tour-id="<id>"` to make it tour-able. The
// assistant resolves `targetTourId` → `[data-tour-id="<id>"]` server-side
// and the PopupTutorial uses that selector to highlight.
export const TOUR_TARGETS = [
  // ── Sidebar (global — always visible) ──────────────────────────────
  { id: 'sidebar.chat',        selector: '[data-tour-id="sidebar.chat"]',        screen: null, description: 'Sidebar button: Chat',         safeToSimulate: true },
  { id: 'sidebar.dashboard',   selector: '[data-tour-id="sidebar.dashboard"]',   screen: null, description: 'Sidebar button: Dashboard',    safeToSimulate: true },
  { id: 'sidebar.agents',      selector: '[data-tour-id="sidebar.agents"]',      screen: null, description: 'Sidebar button: Agents',       safeToSimulate: true },
  { id: 'sidebar.workflows',   selector: '[data-tour-id="sidebar.workflows"]',   screen: null, description: 'Sidebar button: Workflows',    safeToSimulate: true },
  { id: 'sidebar.tools',       selector: '[data-tour-id="sidebar.tools"]',       screen: null, description: 'Sidebar button: Tools',        safeToSimulate: true },
  { id: 'sidebar.artifacts',   selector: '[data-tour-id="sidebar.artifacts"]',   screen: null, description: 'Sidebar button: Artifacts',    safeToSimulate: true },
  { id: 'sidebar.lab',         selector: '[data-tour-id="sidebar.lab"]',         screen: null, description: 'Sidebar button: Lab (Skills, Memory, Evolution, Autonomy)', safeToSimulate: true },
  { id: 'sidebar.add-page',    selector: '[data-tour-id="sidebar.add-page"]',    screen: null, description: 'Sidebar button: + New custom page', safeToSimulate: true },
  { id: 'sidebar.marketplace', selector: '[data-tour-id="sidebar.marketplace"]', screen: null, description: 'Sidebar button: Marketplace',  safeToSimulate: true },
  { id: 'sidebar.widgets',     selector: '[data-tour-id="sidebar.widgets"]',     screen: null, description: 'Sidebar button: Widgets',      safeToSimulate: true },
  { id: 'sidebar.connect',     selector: '[data-tour-id="sidebar.connect"]',     screen: null, description: 'Sidebar button: Connectors',   safeToSimulate: true },
  { id: 'sidebar.settings',    selector: '[data-tour-id="sidebar.settings"]',    screen: null, description: 'Sidebar button: Settings',     safeToSimulate: true },
  { id: 'sidebar.toggle',      selector: '[data-tour-id="sidebar.toggle"]',      screen: null, description: 'Sidebar collapse/expand toggle', safeToSimulate: true },

  // ── Workflows ──────────────────────────────────────────────────────
  { id: 'workflows.add-node-button', selector: '[data-tour-id="workflows.add-node-button"]', screen: 'WorkflowsScreen', description: 'Opens the node picker to add a new workflow node', safeToSimulate: true },
  { id: 'workflows.canvas',          selector: '[data-tour-id="workflows.canvas"]',          screen: 'WorkflowsScreen', description: 'The workflow design canvas', safeToSimulate: false },
  { id: 'workflows.run-button',      selector: '[data-tour-id="workflows.run-button"]',      screen: 'WorkflowsScreen', description: 'Activates the current workflow (consumes credits)', safeToSimulate: false },

  // ── Agents ─────────────────────────────────────────────────────────
  { id: 'agents.create-button',      selector: '[data-tour-id="agents.create-button"]',      screen: 'AgentsScreen', description: 'Open AgentForge to create a new agent', safeToSimulate: true },

  // ── Dashboard ──────────────────────────────────────────────────────
  { id: 'dashboard.global-pulse-ribbon', selector: '[data-tour-id="dashboard.global-pulse-ribbon"]', screen: 'DashboardScreen', description: 'The Global Pulse ribbon showing live system metrics', safeToSimulate: false },
];

export const TOUR_TARGETS_BY_ID = Object.fromEntries(TOUR_TARGETS.map((t) => [t.id, t]));
