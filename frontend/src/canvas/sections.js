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
// SHARED SCREENS. A screen may be owned by more than one section as long as
// each owner declares a distinct `section` — the inner view that sidebar row
// deep-links to. CONNECT uses this: six rows, one ConnectorsScreen, six inner
// sections. `activeInnerSection` (canvas/innerSection.js) is what
// disambiguates which row is highlighted.
//
// Every screen listed here must also exist in Terminal.vue's lazy-import map
// and screenRoutes, and in router/index.js. sections.spec.js enforces that
// agreement — if you add or move a screen and the spec fails, it is telling
// you which of the hand-maintained lists you forgot.

export const MAIN_SECTIONS = [
  // ── WORK ── the three places you land: talk, browse, arrange.
  {
    id: 'chat',
    group: 'WORK',
    icon: 'fas fa-comments',
    label: 'Chat',
    screens: [{ screen: 'ChatScreen', label: 'CHAT' }],
  },
  {
    id: 'marketplace',
    group: 'WORK',
    icon: 'fas fa-store',
    label: 'Marketplace',
    screens: [{ screen: 'MarketplaceScreen', label: 'MARKETPLACE' }],
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
    screens: [{ screen: 'GoalsScreen', label: 'GOALS' }],
  },
  {
    id: 'artifacts',
    group: 'PLAN',
    icon: 'fas fa-cube',
    label: 'Artifacts',
    screens: [{ screen: 'ArtifactsScreen', label: 'ARTIFACTS' }],
  },
  {
    id: 'traces',
    group: 'PLAN',
    icon: 'fas fa-stream',
    label: 'Traces',
    screens: [{ screen: 'TracesScreen', label: 'TRACES' }],
  },

  // ── BUILD ── the workforce and what it can use. Library first, forge
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
    id: 'tools',
    group: 'BUILD',
    icon: 'fas fa-wrench',
    label: 'Tools',
    screens: [
      { screen: 'ToolsScreen', label: 'MY TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE' },
    ],
  },
  {
    id: 'skills',
    group: 'BUILD',
    icon: 'fas fa-graduation-cap',
    label: 'Skills',
    screens: [{ screen: 'SkillsScreen', label: 'SKILLS' }],
  },
  {
    id: 'widgets',
    group: 'BUILD',
    icon: 'fas fa-shapes',
    label: 'Widgets',
    screens: [
      { screen: 'WidgetManagerScreen', label: 'MY WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE' },
    ],
  },

  // ── CONNECT ── everything that reaches outside AGNT. These six rows all
  // render ConnectorsScreen; `section` selects which view it opens on. They
  // were previously buried in ConnectorsPanel's inner nav, which meant the
  // sidebar could not say what the app could actually connect to.
  {
    id: 'connect-oauth',
    group: 'CONNECT',
    section: 'oauth',
    icon: 'fas fa-plug',
    label: 'API / OAuth',
    screens: [{ screen: 'ConnectorsScreen', label: 'AUTH CONNECTIONS' }],
  },
  {
    id: 'connect-emails',
    group: 'CONNECT',
    section: 'email-server',
    icon: 'fas fa-envelope',
    label: 'Emails',
    screens: [{ screen: 'ConnectorsScreen', label: 'EMAIL SERVER' }],
  },
  {
    id: 'connect-mcp',
    group: 'CONNECT',
    section: 'mcp-servers',
    icon: 'fas fa-server',
    label: 'MCP',
    screens: [{ screen: 'ConnectorsScreen', label: 'MCP / NPM LIBRARY' }],
  },
  {
    id: 'connect-plugins',
    group: 'CONNECT',
    section: 'plugins',
    icon: 'fas fa-puzzle-piece',
    label: 'Plugins',
    screens: [{ screen: 'ConnectorsScreen', label: 'MY PLUGINS' }],
  },
  {
    // The credential store. Connectors already rendered this view; nothing
    // linked to it, so it was unreachable until it got a sidebar row.
    id: 'connect-vault',
    group: 'CONNECT',
    section: 'api-keys',
    icon: 'fas fa-key',
    label: 'Vault',
    screens: [{ screen: 'ConnectorsScreen', label: 'VAULT' }],
  },
  {
    id: 'connect-webhooks',
    group: 'CONNECT',
    section: 'webhooks',
    icon: 'fas fa-link',
    label: 'Webhooks',
    screens: [{ screen: 'ConnectorsScreen', label: 'WEBHOOKS' }],
  },
];

// ── SYSTEM ── one row at the foot of the rail. Everything under it (Profile,
// Billing, Theme, Memory, Evolution, Autonomy, …) is navigated from Settings'
// own left panel, not from the main sidebar: these are things you configure
// once, and putting twelve of them in the rail would drown the four groups
// above. Memory / Evolution / Autonomy are full screens rather than Settings
// sections, so they are listed here as toolbar tabs — that keeps them inside
// SECTION_ROUTES, keeps the gear lit while you are on them, and lets them
// share SettingsPanel as their left panel (see screenRegistry.js).
export const SETTINGS_SECTIONS = [
  {
    id: 'settings',
    group: 'SYSTEM',
    icon: 'fas fa-cog',
    label: 'Settings',
    screens: [
      { screen: 'SettingsScreen', label: 'SETTINGS' },
      { screen: 'MemoryScreen', label: 'MEMORY' },
      { screen: 'ExperimentsScreen', label: 'EVOLUTION' },
      { screen: 'AutonomyScreen', label: 'AUTONOMY' },
    ],
  },
];

export const ALL_SECTIONS = [...MAIN_SECTIONS, ...SETTINGS_SECTIONS];

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
