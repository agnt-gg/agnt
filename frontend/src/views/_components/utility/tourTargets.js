// Curated map of tour-able UI elements. Mirror of
// backend/src/services/orchestrator/tutorialTargets.js — keep both in sync.
//
// Tag a DOM element with `data-tour-id="<id>"` to make it tour-able. The
// assistant resolves `targetTourId` → `[data-tour-id="<id>"]` server-side
// and the PopupTutorial uses that selector to highlight.
//
// The sidebar block below is held to canvas/sections.js bidirectionally by
// sections.spec.js: every section must be tour-able, and every sidebar target
// must point at a section that actually renders.
export const TOUR_TARGETS = [
  // ── Sidebar: TODAY (global — always visible) ───────────────────────
  { id: 'sidebar.chat',             selector: '[data-tour-id="sidebar.chat"]',             screen: null, description: 'Sidebar button: Chat (tabs: Chat, Workspaces)', safeToSimulate: true },
  { id: 'sidebar.dashboard',        selector: '[data-tour-id="sidebar.dashboard"]',        screen: null, description: 'Sidebar button: Dashboard', safeToSimulate: true },

  // ── Sidebar: WORK ──────────────────────────────────────────────────
  { id: 'sidebar.goals',            selector: '[data-tour-id="sidebar.goals"]',            screen: null, description: 'Sidebar button: Goals',        safeToSimulate: true },
  { id: 'sidebar.traces',           selector: '[data-tour-id="sidebar.traces"]',           screen: null, description: 'Sidebar button: Activity (every workflow, goal and agent run)', safeToSimulate: true },
  { id: 'sidebar.artifacts',         selector: '[data-tour-id="sidebar.artifacts"]',         screen: null, description: 'Sidebar button: Files (the workspace folder: what chats, runs, goals and agents produce, plus anything you drop in)', safeToSimulate: true },

  // ── Sidebar: ASSETS ────────────────────────────────────────────────
  { id: 'sidebar.agents',           selector: '[data-tour-id="sidebar.agents"]',           screen: null, description: 'Sidebar button: Agents (tabs: Agents, Skills, Memory)', safeToSimulate: true },
  { id: 'sidebar.workflows',        selector: '[data-tour-id="sidebar.workflows"]',        screen: null, description: 'Sidebar button: Workflows', safeToSimulate: true },
  { id: 'sidebar.tools',            selector: '[data-tour-id="sidebar.tools"]',            screen: null, description: 'Sidebar button: Tools (tabs: Tools, Widgets)', safeToSimulate: true },

  // ── Sidebar: CONNECTORS ────────────────────────────────────────────
  { id: 'sidebar.apps',             selector: '[data-tour-id="sidebar.apps"]',             screen: null, description: 'Sidebar button: Apps (tabs: Apps — AI providers, API/OAuth, Emails, MCP, Vault, Webhooks; Plugins — installed and marketplace)', safeToSimulate: true },
  { id: 'sidebar.store',            selector: '[data-tour-id="sidebar.store"]',            screen: null, description: 'Sidebar button: Store (the marketplace)', safeToSimulate: true },

  // ── Sidebar: foot of the rail + controls ───────────────────────────
  { id: 'sidebar.settings',         selector: '[data-tour-id="sidebar.settings"]',         screen: null, description: 'Sidebar button: Settings (Profile, Billing, Theme, Approvals, Improvements)', safeToSimulate: true },
  { id: 'sidebar.add-page',         selector: '[data-tour-id="sidebar.add-page"]',         screen: null, description: 'Sidebar button: + New custom page', safeToSimulate: true },
  { id: 'sidebar.toggle',           selector: '[data-tour-id="sidebar.toggle"]',           screen: null, description: 'Sidebar collapse/expand toggle', safeToSimulate: true },

  // ── Workflows ──────────────────────────────────────────────────────
  { id: 'workflows.add-node-button', selector: '[data-tour-id="workflows.add-node-button"]', screen: 'WorkflowsScreen', description: 'Opens the node picker to add a new workflow node', safeToSimulate: true },
  { id: 'workflows.canvas',          selector: '[data-tour-id="workflows.canvas"]',          screen: 'WorkflowsScreen', description: 'The workflow design canvas', safeToSimulate: false },
  { id: 'workflows.run-button',      selector: '[data-tour-id="workflows.run-button"]',      screen: 'WorkflowsScreen', description: 'Activates the current workflow (consumes credits)', safeToSimulate: false },

  // ── Agents ─────────────────────────────────────────────────────────
  { id: 'agents.create-button',      selector: '[data-tour-id="agents.create-button"]',      screen: 'AgentsScreen', description: 'Open the new-agent modal', safeToSimulate: true },

  // ── Dashboard ──────────────────────────────────────────────────────
  { id: 'dashboard.global-pulse-ribbon', selector: '[data-tour-id="dashboard.global-pulse-ribbon"]', screen: 'DashboardScreen', description: 'The Global Pulse ribbon showing live system metrics', safeToSimulate: false },
];

export const TOUR_TARGETS_BY_ID = Object.fromEntries(TOUR_TARGETS.map((t) => [t.id, t]));
