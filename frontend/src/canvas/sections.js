// Canvas navigation registry — the single source of truth for which screens
// exist, which sidebar section owns each one, and what the toolbar tab says.
//
// The sidebar renders one row per section, grouped under a caption (`group`);
// the toolbar renders one tab per entry in the active section's `screens`.
// Moving a screen between surfaces is therefore a re-parent in THIS file,
// nothing else.
//
// GROUPS. Every main section declares a `group`. Sections are rendered in
// array order and a caption + divider is emitted whenever the group changes,
// so the grouping is expressed by ORDER here, not by a separate structure —
// one list stays impossible to desynchronise from itself. Adding a section
// without a group fails sections.spec.js rather than silently rendering it
// under whatever caption happens to precede it.
//
// ONE ROW PER SCREEN. No screen may be owned by two sections: the rail
// resolves the active row from the screen name alone, so a second owner would
// light the wrong row. sections.spec.js enforces that.
//
// TAB FLAGS on a screen entry:
//   tab: false  — owned and routed by the row, never drawn in the toolbar
//                 (navigated from the screen's own left panel; SYSTEM screens).
//   ctx: true   — a CONTEXTUAL tab: drawn only while it is the active screen.
//                 The forges use this. Library would otherwise carry nine tabs
//                 of which four are editors you enter from a card, not from the
//                 toolbar; showing the editor's tab only while you are inside
//                 it keeps the strip about destinations and still tells you
//                 where you are.
//   badge: fn   — optional getter (store) → number | '' rendered on the rail
//                 row. Only rows with something live carry one.
//
// Every screen listed here must also exist in Terminal.vue's lazy-import map
// and screenRoutes, and in router/index.js. sections.spec.js enforces that
// agreement — if you add or move a screen and the spec fails, it is telling
// you which of the hand-maintained lists you forgot.

export const MAIN_SECTIONS = [
  // ── WORK ── the two places you land: talk, arrange.
  {
    id: 'chat',
    group: 'WORK',
    icon: 'fas fa-comments',
    label: 'Chat',
    // Artifacts are what conversations produce. As a PLAN row it was a list
    // you reached from nowhere in particular; as Chat's second tab it sits
    // one click from the thread that made the file.
    screens: [
      { screen: 'ChatScreen', label: 'CHAT' },
      { screen: 'ArtifactsScreen', label: 'ARTIFACTS' },
    ],
  },
  {
    // Workspaces was a toolbar tab of Chat. It is its own destination now:
    // grouping made the distinction legible (Chat is a thread, a Workspace is
    // an arrangement), so it no longer needs to borrow Chat's row.
    id: 'workspaces',
    group: 'WORK',
    icon: 'fas fa-columns',
    label: 'Workspaces',
    screens: [{ screen: 'WorkspaceScreen', label: 'WORKSPACES' }],
  },

  // ── PLAN ── what you intend, and the record of what happened.
  {
    id: 'dashboard',
    group: 'PLAN',
    icon: 'fas fa-tachometer-alt',
    label: 'Dashboard',
    screens: [{ screen: 'DashboardScreen', label: 'DASHBOARD' }],
  },
  {
    id: 'goals',
    group: 'PLAN',
    icon: 'fas fa-bullseye',
    label: 'Goals',
    badge: 'goals',
    screens: [{ screen: 'GoalsScreen', label: 'GOALS' }],
  },
  {
    id: 'traces',
    group: 'PLAN',
    icon: 'fas fa-stream',
    label: 'Traces',
    badge: 'traces',
    screens: [{ screen: 'TracesScreen', label: 'TRACES' }],
  },

  // ── BUILD ── the workforce and what it can use. List first, forge
  // second: the sidebar row lands on the list, the forge is a toolbar tab.
  {
    id: 'agents',
    group: 'BUILD',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'MY AGENTS' },
      { screen: 'AgentForgeScreen', label: 'AGENT FORGE' },
    ],
  },
  {
    id: 'workflows',
    group: 'BUILD',
    icon: 'fas fa-project-diagram',
    label: 'Workflows',
    screens: [
      { screen: 'WorkflowsScreen', label: 'MY WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE' },
    ],
  },
  {
    // Tools · Skills · Plugins · Widgets · Marketplace were five rail rows for
    // one idea — "things I can use" — and the grouping that would have said
    // so was a 7px caption nobody could read. One row, five tabs, exactly the
    // mechanism Agents and Workflows already use. Marketplace is the last tab
    // because it is where the other four come from.
    id: 'library',
    group: 'BUILD',
    icon: 'fas fa-book',
    label: 'Library',
    screens: [
      { screen: 'ToolsScreen', label: 'TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE', ctx: true },
      { screen: 'SkillsScreen', label: 'SKILLS' },
      { screen: 'PluginsScreen', label: 'PLUGINS' },
      { screen: 'WidgetManagerScreen', label: 'WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE', ctx: true },
      { screen: 'MarketplaceScreen', label: 'MARKETPLACE' },
    ],
  },
];

// ── The foot of the rail ── below a separator, captionless: two rows you
// visit to set the machine up rather than to do work with it.
//
// Both are a screen that carries its OWN left-panel nav, which is exactly why
// each gets one row instead of several. Connect had six — API/OAuth, Emails,
// MCP, Plugins, Vault, Webhooks — and every one of them landed on a screen
// already listing those same six down its left side. (Plugins has since left
// for BUILD › Library, where an installable asset belongs; AI providers has
// since ARRIVED here from Settings, because a provider is a thing AGNT
// reaches out to.)
//
// Settings is the same shape one level further: Profile, Billing, Theme,
// Memory, Evolution, Autonomy and the rest are navigated from SettingsPanel.
//
// `tab: false` — owned and routed by this row, but not drawn in the toolbar.
// Memory / Evolution / Autonomy are full screens rather than Settings
// sections, so the row has to list them: that is what keeps them inside
// SECTION_ROUTES (without it the canvas reads them as custom pages and the
// gear goes dark while you are on them) and lets them share SettingsPanel as
// their left panel (see screenRegistry.js).
export const BOTTOM_SECTIONS = [
  {
    id: 'connect',
    group: 'SYSTEM',
    icon: 'fas fa-plug',
    label: 'Connectors',
    badge: 'connect',
    screens: [{ screen: 'ConnectorsScreen', label: 'CONNECTORS' }],
  },
  {
    id: 'settings',
    group: 'SYSTEM',
    icon: 'fas fa-cog',
    label: 'Settings',
    screens: [
      { screen: 'SettingsScreen', label: 'SETTINGS' },
      { screen: 'MemoryScreen', label: 'MEMORY', tab: false },
      { screen: 'ExperimentsScreen', label: 'EVOLUTION', tab: false },
      { screen: 'AutonomyScreen', label: 'AUTONOMY', tab: false },
    ],
  },
];

export const ALL_SECTIONS = [...MAIN_SECTIONS, ...BOTTOM_SECTIONS];

// Set of all screen names that belong to a section (used to identify custom pages)
export const SECTION_ROUTES = new Set(ALL_SECTIONS.flatMap((s) => s.screens.map((t) => t.screen)));

/**
 * Sections in render order, tagged with whether they open a new caption.
 * The sidebar walks this instead of re-deriving group boundaries inline, so
 * "first section of its group" is defined in exactly one place.
 */
export function withGroupHeadings(sections) {
  let previous = null;
  return sections.map((section) => {
    const startsGroup = section.group !== previous;
    previous = section.group;
    return { section, startsGroup, caption: startsGroup ? section.group : null };
  });
}

/**
 * The toolbar tabs for a section given the screen that is active right now.
 * `tab:false` entries never draw; `ctx:true` entries draw only while active.
 * Pure so the toolbar and the tests share one definition of "visible".
 */
export function visibleTabs(section, activeScreen) {
  if (!section) return [];
  return section.screens.filter((t) => t.tab !== false && (!t.ctx || t.screen === activeScreen));
}
