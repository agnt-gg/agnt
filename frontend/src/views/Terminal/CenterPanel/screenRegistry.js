/**
 * screenRegistry — the single source of truth for per-screen layout.
 *
 * One entry per screen, keyed by screenId. Values are extracted VERBATIM from
 * what each screen used to pass to <BaseScreen> as props, so adopting the
 * registry changed nothing visually — it only moved the declaration.
 *
 * Semantics (mirrors BaseScreen's long-standing prop behavior exactly):
 *   rightPanel / leftPanel:
 *     string     → that panel type renders (when the global toggle shows it)
 *     false      → (leftPanel) the screen has NO left column at all: the
 *                  panel, its resize handle and its share of the width are
 *                  all removed. Distinct from `null`, which DERIVES a name —
 *                  and deriving a name for a panel that does not exist is not
 *                  "no panel", it is ChatPanel, because LeftPanel catches the
 *                  failed import and falls back.
 *     null       → BaseScreen derives a panel name from screenId
 *                  (right: `${screenId}Panel`, left: screenId minus "Screen"
 *                  + "Panel") — same as before, unknown names render empty
 *     absent key → same as null (derive)
 *   input:
 *     true/false → whether the terminal input line renders
 *     absent     → true (BaseScreen's historical default)
 *
 * A screen with genuinely DYNAMIC panels (e.g. Workflows swaps its right
 * panel with selection state) keeps passing the prop — an explicitly passed
 * prop always wins over the registry.
 */
export const SCREEN_DEFAULTS = Object.freeze({
  AgentForgeScreen: { rightPanel: 'AgentForgePanel', input: false },
  AgentsScreen: { leftPanel: 'AgentsPanel', input: false }, // right: dynamic
  ArtifactsScreen: { leftPanel: 'ArtifactsPanel', rightPanel: 'FileTreePanel', input: false },
  // Approvals is a tab of the Agents row (canvas/sections.js). Left: its own
  // section list; right: the approval queue (AGNT One). `null` used to fall
  // back to Chat's panel beside the policy screen.
  AutonomyScreen: { leftPanel: 'AutonomyPanel', rightPanel: 'AutonomyPanel', input: false },
  ChatScreen: { input: true },
  ConnectorsScreen: { input: false }, // right: dynamic
  DashboardScreen: { leftPanel: 'DashboardPanel', rightPanel: 'DashboardPanel', input: false },
  EvalDatasetsScreen: { leftPanel: 'EvalDatasetsPanel', rightPanel: 'EvalDatasetsPanel', input: false },
  ExperimentForgeScreen: { leftPanel: 'ExperimentForgePanel', rightPanel: 'ExperimentForgePanel', input: false },
  ExperimentInsightsScreen: { leftPanel: 'ExperimentInsightsPanel', rightPanel: 'ExperimentInsightsPanel', input: false },
  // ── SYSTEM screen ──
  // Improvements (Evolution) is navigated from Settings' own nav, so it renders
  // SettingsPanel on the left: the SYSTEM list stays on screen and you can move
  // back without a trip through the gear.
  ExperimentsScreen: { leftPanel: 'SettingsPanel', rightPanel: 'ExperimentsPanel', input: false },
  GoalsScreen: { leftPanel: 'GoalsPanel', rightPanel: 'GoalsPanel', input: false },
  MarketplaceScreen: { leftPanel: 'MarketplacePanel', rightPanel: 'MarketplacePanel', input: false },
  // Memory is a tab of the Agents row. Both sides render a MemoryPanel: left
  // filters the list, right shows the selected memory.
  MemoryScreen: { leftPanel: 'MemoryPanel', rightPanel: 'MemoryPanel', input: false },
  // No left column. Everything a Plugins panel could hold — the Installed /
  // Marketplace tabs, the search box, the counts — is already on the screen
  // itself, so the column had nothing to say. Right is dynamic (plugin detail
  // vs. news).
  PluginsScreen: { leftPanel: false, input: false },
  SettingsScreen: { input: false }, // right: dynamic
  SkillForgeScreen: { rightPanel: 'SkillsPanel', input: false },
  SkillsScreen: { leftPanel: 'SkillsPanel', rightPanel: 'SkillsPanel', input: false },
  ToolForgeScreen: { leftPanel: 'ToolForgePanel', rightPanel: 'ToolForgeResponsePanel', input: false },
  ToolsScreen: { leftPanel: 'ToolsPanel', input: false }, // right: dynamic
  TracesScreen: { leftPanel: 'TracesPanel', rightPanel: 'TracesPanel', input: false },
  WidgetForgeScreen: { leftPanel: 'WidgetForgePanel', rightPanel: 'WidgetForgePanel', input: false },
  WidgetManagerScreen: { leftPanel: 'WidgetManagerPanel', rightPanel: 'WidgetManagerPanel', input: false },
  WorkflowForgeScreen: { leftPanel: 'WorkflowForgePanel', input: false }, // right: dynamic
  WorkflowsScreen: { leftPanel: 'WorkflowsPanel', input: false }, // right: dynamic
});

/**
 * Screens that do NOT render BaseScreen's three-panel frame. They lay out
 * their own surfaces (Workspace is a full-bleed widget canvas with its own
 * gutters), so the persistent PanelBackdrop must not paint under them or the
 * wallpaper between widgets fills in. Kept OUTSIDE SCREEN_DEFAULTS on
 * purpose: that table is guarded to contain only screens that mount
 * <BaseScreen screenId="…">, and a frameless screen by definition does not.
 */
export const FRAMELESS_SCREENS = Object.freeze(new Set(['WorkspaceScreen']));

export function screenHasFrame(screenId) {
  return !FRAMELESS_SCREENS.has(screenId);
}

/** Resolve a layout slot: an explicitly passed prop wins; else the registry. */
export function resolvePanel(propValue, screenId, slot) {
  if (propValue !== undefined) return propValue;
  const entry = SCREEN_DEFAULTS[screenId];
  if (entry && slot in entry) return entry[slot];
  return null; // matches the old prop default
}

/** Resolve whether the input line shows. */
export function resolveInput(propValue, screenId) {
  if (propValue !== undefined) return propValue;
  const entry = SCREEN_DEFAULTS[screenId];
  if (entry && 'input' in entry) return entry.input;
  return true; // matches the old prop default
}
