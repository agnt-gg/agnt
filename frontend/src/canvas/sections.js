// Canvas navigation registry — the single source of truth for which screens
// exist, which sidebar section owns each one, and what the toolbar tab says.
//
// The sidebar renders one icon per section; the toolbar renders one tab per
// entry in the active section's `screens`. Moving a screen between surfaces
// is therefore a re-parent in THIS file, nothing else.
//
// Every screen listed here must also exist in Terminal.vue's lazy-import map
// and screenRoutes, and in router/index.js. sections.spec.js enforces that
// agreement — if you add or move a screen and the spec fails, it is telling
// you which of the hand-maintained lists you forgot.

export const MAIN_SECTIONS = [
  {
    id: 'chat',
    icon: 'fas fa-comments',
    label: 'Chat',
    screens: [
      { screen: 'ChatScreen', label: 'CHAT' },
      // Workspaces lives as a tab beside Chat rather than as its own
      // sidebar section: it is a chat-adjacent surface (same input, the
      // system arranges itself around the work), not a separate destination.
      { screen: 'WorkspaceScreen', label: 'WORKSPACES' },
    ],
  },
  {
    id: 'dashboard',
    icon: 'fas fa-tachometer-alt',
    label: 'Dashboard',
    screens: [
      { screen: 'DashboardScreen', label: 'DASHBOARD' },
      { screen: 'GoalsScreen', label: 'GOALS' },
      { screen: 'TracesScreen', label: 'TRACES' },
    ],
  },
  {
    id: 'agents',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'MY AGENTS' },
      { screen: 'AgentForgeScreen', label: 'AGENT FORGE' },
    ],
  },
  {
    id: 'workflows',
    icon: 'fas fa-project-diagram',
    label: 'Workflows',
    screens: [
      { screen: 'WorkflowsScreen', label: 'MY WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE' },
    ],
  },
  {
    id: 'tools',
    icon: 'fas fa-wrench',
    label: 'Tools',
    screens: [
      { screen: 'ToolsScreen', label: 'MY TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE' },
    ],
  },
  { id: 'artifacts', icon: 'fas fa-cube', label: 'Artifacts', screens: [{ screen: 'ArtifactsScreen', label: 'ARTIFACTS' }] },
  {
    id: 'lab',
    icon: 'fas fa-flask',
    label: 'Lab',
    screens: [
      { screen: 'SkillsScreen', label: 'SKILLS' },
      { screen: 'MemoryScreen', label: 'MEMORY' },
      { screen: 'ExperimentsScreen', label: 'EVOLUTION' },
      { screen: 'AutonomyScreen', label: 'AUTONOMY' },
    ],
  },
];

export const SETTINGS_SECTIONS = [
  { id: 'marketplace', icon: 'fas fa-store', label: 'Marketplace', screens: [{ screen: 'MarketplaceScreen', label: 'MARKETPLACE' }] },
  {
    id: 'widgets',
    icon: 'fas fa-shapes',
    label: 'Widgets',
    screens: [
      { screen: 'WidgetManagerScreen', label: 'MY WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE' },
    ],
  },
  { id: 'connect', icon: 'fas fa-puzzle-piece', label: 'Connectors', screens: [{ screen: 'ConnectorsScreen', label: 'CONNECTORS' }] },
  { id: 'settings', icon: 'fas fa-cog', label: 'Settings', screens: [{ screen: 'SettingsScreen', label: 'SETTINGS' }] },
];

export const ALL_SECTIONS = [...MAIN_SECTIONS, ...SETTINGS_SECTIONS];

// Set of all screen names that belong to a section (used to identify custom pages)
export const SECTION_ROUTES = new Set(ALL_SECTIONS.flatMap((s) => s.screens.map((t) => t.screen)));
