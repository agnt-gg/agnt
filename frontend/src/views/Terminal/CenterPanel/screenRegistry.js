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
  AgentsScreen: { leftPanel: 'AgentsPanel', input: false }, // right: dynamic
  // Files: no side columns on desktop; the page is a file grid (FilesBrowser).
  // Phones still open FileTreePanel as their manage sheet (Artifacts passes it).
  ArtifactsScreen: { leftPanel: false, rightPanel: false, input: false },
  // ── SYSTEM screens ──
  // Approvals (Autonomy) and Improvements (Evolution) are navigated from
  // Settings' own nav, so they render SettingsPanel on the left: the SYSTEM
  // list stays on screen and you can move between them without a trip back
  // through the gear. Autonomy carries its own inline tab strip (see
  // Autonomy.vue), so its left panel was duplicate navigation.
  // Right: the approval queue (AGNT One). `null` used to fall back to Chat's
  // panel beside the policy screen.
  LearningScreen: { leftPanel: 'SettingsPanel', rightPanel: false, input: false },
  // Chat opens with the inspector (right panel) collapsed: the thread is the
  // point, the inspector is on demand. A small toggle at the top-right of the
  // canvas expands it; the choice is remembered for THIS screen only.
  ChatScreen: { input: true, rightCollapsedDefault: true },
  ConnectorsScreen: { input: false }, // right: dynamic
  // Left: a system overview — how many of everything, what is moving right
  // now, every tile a door. Right: Active Workflows + Integration Health.
  DashboardScreen: { leftPanel: 'SystemOverviewPanel', rightPanel: 'DashboardPanel', input: false },
  // Goals has no side columns: both used to show the same goal count the
  // board already shows. The selected goal's detail opens INSIDE the screen
  // (Goals.vue `goal-detail-drawer`, which hosts RightPanel/GoalsPanel).
  GoalsScreen: { leftPanel: false, rightPanel: false, input: false },
  MarketplaceScreen: { leftPanel: 'MarketplacePanel', rightPanel: 'MarketplacePanel', input: false },
  // Memory is a tab of the Agents row. Both sides render a MemoryPanel: left
  // filters the list, right shows the selected memory.
  MemoryScreen: { leftPanel: 'MemoryPanel', rightPanel: 'MemoryPanel', input: false },
  // No left column. Everything a Plugins panel could hold — the Installed /
  // Marketplace tabs, the search box, the counts — is already on the screen
  // itself, so the column had nothing to say. Right is dynamic (plugin detail
  // vs. news).
  // Shares the Apps sidebar: Plugins is a row of it (appsDirectory).
  PluginsScreen: { leftPanel: 'ConnectorsPanel', input: false },
  SettingsScreen: { input: false }, // right: dynamic
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

/**
 * The right panel's collapse state for a screen that has never been toggled.
 * Every screen remembers its own choice after that (panelCollapse.js); this is
 * only where a screen starts. Returns `undefined` when the screen has no such
 * preference.
 */
export function rightCollapsedDefault(screenId) {
  const entry = SCREEN_DEFAULTS[screenId];
  return entry && 'rightCollapsedDefault' in entry ? entry.rightCollapsedDefault : undefined;
}

/** Resolve whether the input line shows. */
export function resolveInput(propValue, screenId) {
  if (propValue !== undefined) return propValue;
  const entry = SCREEN_DEFAULTS[screenId];
  if (entry && 'input' in entry) return entry.input;
  return true; // matches the old prop default
}
