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
    screens: [{ screen: 'ChatScreen', label: 'CHAT' }],
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

  // ── REVIEW ── what happened, what is happening, what came out of it. The
  // day starts here: runs overnight, the files they wrote, the goals still
  // moving. Top to bottom is the morning sweep, which is why Goals is last
  // (it is what you INTEND; the rows above it are what you GOT).
  {
    id: 'dashboard',
    group: 'REVIEW',
    icon: 'fas fa-tachometer-alt',
    label: 'Dashboard',
    screens: [{ screen: 'DashboardScreen', label: 'DASHBOARD' }],
  },
  {
    id: 'goals',
    group: 'REVIEW',
    icon: 'fas fa-bullseye',
    label: 'Goals',
    badge: 'goals',
    screens: [{ screen: 'GoalsScreen', label: 'GOALS' }],
  },
  {
    // Files: the folder-backed workspace. Runs, goals, agents and chats write
    // here by default, but you also drop reference material in and Annie reads
    // it back — inputs, knowledge and outputs are one tree, so the label names
    // the place, not the direction of flow. It was a tab of Chat, which put a
    // file the nightly digest wrote under the room you talk in. ("Artifacts"
    // is the route and the store; nobody says artifact.)
    id: 'artifacts',
    group: 'REVIEW',
    icon: 'fas fa-folder',
    label: 'Files',
    screens: [{ screen: 'ArtifactsScreen', label: 'FILES' }],
  },
  {
    // "Runs" is the word; "Traces" is what engineers call the record of one.
    // Route and screen keep their names.
    id: 'traces',
    group: 'REVIEW',
    icon: 'fas fa-stream',
    label: 'Runs',
    badge: 'traces',
    screens: [{ screen: 'TracesScreen', label: 'RUNS' }],
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
    // Tools · Skills · Widgets · Marketplace were separate rail rows for one
    // idea — "things I make or get" — and the grouping that would have said
    // so was a 7px caption nobody could read. One row, four tabs, exactly the
    // mechanism Agents and Workflows already use. Marketplace is the last tab
    // because it is where the other three come from. (Plugins lived here for
    // a while; it moved to CONNECT because to a user "install the Slack
    // plugin" and "connect Slack" are the same intent.)
    id: 'library',
    group: 'BUILD',
    icon: 'fas fa-book',
    label: 'Library',
    screens: [
      { screen: 'ToolsScreen', label: 'TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE', ctx: true },
      { screen: 'SkillsScreen', label: 'SKILLS' },
      { screen: 'WidgetManagerScreen', label: 'WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE', ctx: true },
      { screen: 'MarketplaceScreen', label: 'MARKETPLACE' },
    ],
  },

  // ── CONNECT ── what AGNT reaches out to. Three rows because each is a
  // different question: which APPS can she use, which MODEL does she think
  // with, which PLUGINS extend her. It was one captionless row at the foot;
  // connecting things is most of the setup a new user does, and the rail
  // should say so. MCP servers stay under Connections (a server you point at
  // is a connection).
  {
    id: 'connect',
    group: 'CONNECT',
    icon: 'fas fa-plug',
    label: 'Connections',
    badge: 'connect',
    screens: [{ screen: 'ConnectorsScreen', label: 'CONNECTIONS' }],
  },
  {
    // The most-touched setup page: the toolbar's "no provider" pill and the
    // first-run card both land here. Settings › AI Provider draws the same
    // three cards for anyone who looks there first.
    id: 'providers',
    group: 'CONNECT',
    icon: 'fas fa-robot',
    label: 'AI Providers',
    screens: [{ screen: 'ProvidersScreen', label: 'AI PROVIDERS' }],
  },
  {
    id: 'plugins',
    group: 'CONNECT',
    icon: 'fas fa-puzzle-piece',
    label: 'Plugins',
    screens: [{ screen: 'PluginsScreen', label: 'PLUGINS' }],
  },
];

// ── The foot of the rail ── below a separator, captionless: the one row you
// visit to set the machine up rather than to do work with it. (Connect sat
// here too until it became its own captioned group above.)
//
// Settings carries its OWN left-panel nav, which is why it gets one row
// instead of several: Profile, Billing, Theme, Memory, Evolution, Autonomy
// and the rest are navigated from SettingsPanel.
//
// `tab: false` — owned and routed by this row, but not drawn in the toolbar.
// Memory / Evolution / Autonomy are full screens rather than Settings
// sections, so the row has to list them: that is what keeps them inside
// SECTION_ROUTES (without it the canvas reads them as custom pages and the
// gear goes dark while you are on them) and lets them share SettingsPanel as
// their left panel (see screenRegistry.js).
export const BOTTOM_SECTIONS = [
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
