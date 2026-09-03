// Registry of tour-able UI elements. Mirror of
// frontend/src/views/_components/utility/tourTargets.js — keep the two in
// sync until a build step (or HTTP endpoint) replaces the duplication.
//
// `id` is the value used in [data-tour-id="…"] on the frontend and as
// `targetTourId` in tutorial tool calls. `safeToSimulate: false` blocks
// the assistant from triggering `simulateClick` on destructive controls.
// `screen: null` means "visible on every screen" (e.g. sidebar, chrome).
export const TOUR_TARGETS = [
  // ── Sidebar: TODAY (global — always visible) ───────────────────────
  { id: 'sidebar.chat',             screen: null, description: 'Sidebar button: Chat (tabs: Chat, Workspaces)', safeToSimulate: true },
  { id: 'sidebar.dashboard',        screen: null, description: 'Sidebar button: Home (the dashboard)', safeToSimulate: true },

  // ── Sidebar: MY WORK ───────────────────────────────────────────────
  { id: 'sidebar.goals',            screen: null, description: 'Sidebar button: Goals',        safeToSimulate: true },
  { id: 'sidebar.traces',           screen: null, description: 'Sidebar button: Activity (every workflow, goal and agent run)', safeToSimulate: true },
  { id: 'sidebar.artifacts',         screen: null, description: 'Sidebar button: Files (the workspace folder: what chats, runs, goals and agents produce, plus anything you drop in)', safeToSimulate: true },

  // ── Sidebar: MY TEAM ───────────────────────────────────────────────
  { id: 'sidebar.agents',           screen: null, description: 'Sidebar button: Agents (tabs: Agents, Skills, Memory, Approvals)', safeToSimulate: true },
  { id: 'sidebar.automations',      screen: null, description: 'Sidebar button: Automations (tabs: Workflows, Tools, Widgets)', safeToSimulate: true },

  // ── Sidebar: MY TOOLKIT ────────────────────────────────────────────
  { id: 'sidebar.apps',             screen: null, description: 'Sidebar button: Apps (tabs: Connected apps — AI providers, API/OAuth, Emails, MCP, Vault, Webhooks; Add-ons — plugins)', safeToSimulate: true },
  { id: 'sidebar.store',            screen: null, description: 'Sidebar button: Store (the marketplace)', safeToSimulate: true },

  // ── Sidebar: SYSTEM + controls ─────────────────────────────────────
  { id: 'sidebar.settings',         screen: null, description: 'Sidebar button: Settings (Profile, Billing, Theme, Improvements)', safeToSimulate: true },
  { id: 'sidebar.add-page',         screen: null, description: 'Sidebar button: + New custom page', safeToSimulate: true },
  { id: 'sidebar.toggle',           screen: null, description: 'Sidebar collapse/expand toggle', safeToSimulate: true },

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
