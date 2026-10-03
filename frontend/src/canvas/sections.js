// Canvas navigation registry — the single source of truth for which screens
// exist, which sidebar section owns each one, and what the toolbar tab says.
//
// The sidebar renders one row per section, grouped under a caption (`group`);
// the toolbar renders one tab per entry in the active section's `screens`.
// Moving a screen between surfaces is therefore a re-parent in THIS file,
// nothing else.
//
// THE RAIL IS WRITTEN FOR THE MIDDLE OF THE BELL CURVE. Four captions, each a
// single plain noun (TODAY · WORK · ASSETS · CONNECTORS); every row one plain
// noun; nothing on the rail is a word only an engineer uses (runs, traces,
// artifacts, library, plugins). Route names and screen names keep their old
// identifiers — this file is about what a person READS, not what the code is
// called.
//
// The four captions follow the delegation chain a business user already
// understands: you land and talk (TODAY), you say what you want done and see
// what came of it (WORK), you build the things that do it — agents that decide
// for themselves, workflows that run the same steps every time, and the tools
// both of them call (ASSETS) — and you plug in the outside world (CONNECTORS).
// ASSETS is the group that makes an account THEIRS: it is what they built.
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
//                 NO FORGE USES THIS. A forge is where the thing gets built,
//                 and a tab you can only see once you are already inside it
//                 cannot tell you it exists — every forge sits permanently
//                 beside the page it builds for (Workflows | Workflow Forge),
//                 so the way in is always visible. Kept for any future tab
//                 that genuinely is per-record state rather than a place.
//   badge: fn   — optional getter (store) → number | '' rendered on the rail
//                 row. Only rows with something live carry one.
//
// Every screen listed here must also exist in Terminal.vue's lazy-import map
// and screenRoutes, and in router/index.js. sections.spec.js enforces that
// agreement — if you add or move a screen and the spec fails, it is telling
// you which of the hand-maintained lists you forgot.

export const MAIN_SECTIONS = [
  // ── TODAY ── where you land: talk, or see what is going on.
  {
    // Canvas is a tab of Chat, not a row: a chat with a custom canvas around
    // it — the same conversation, arranged — so it lives one tab to the right
    // of the thread. It was labelled WORKSPACES until "workspace" came to mean
    // one thing only: a shared cloud instance (the space switcher).
    id: 'chat',
    group: 'TODAY',
    icon: 'fas fa-comments',
    label: 'Chat',
    screens: [
      { screen: 'ChatScreen', label: 'CHAT' },
      { screen: 'WorkspaceScreen', label: 'CANVAS' },
    ],
  },
  {
    id: 'dashboard',
    group: 'TODAY',
    icon: 'fas fa-th-large',
    label: 'Dashboard',
    screens: [{ screen: 'DashboardScreen', label: 'DASHBOARD' }],
  },

  // ── WORK ── what I asked for, what happened, what came out of it.
  {
    id: 'goals',
    group: 'WORK',
    icon: 'fas fa-bullseye',
    label: 'Goals',
    badge: 'goals',
    screens: [{ screen: 'GoalsScreen', label: 'GOALS' }],
  },
  {
    // "Activity" is the word every product a business user already knows
    // uses for "what happened" (Slack, GitHub, their bank). "Runs" was the
    // engineer's word; "Traces" is what engineers call the record of one.
    id: 'traces',
    group: 'WORK',
    icon: 'fas fa-stream',
    label: 'Activity',
    badge: 'traces',
    screens: [{ screen: 'TracesScreen', label: 'ACTIVITY' }],
  },
  {
    // Files: the folder-backed workspace. Runs, goals, agents and chats write
    // here by default, but you also drop reference material in and Annie reads
    // it back — inputs, knowledge and outputs are one tree, so the label names
    // the place, not the direction of flow. ("Artifacts" is the route and the
    // store; nobody says artifact.)
    id: 'artifacts',
    group: 'WORK',
    icon: 'fas fa-folder',
    label: 'Files',
    screens: [{ screen: 'ArtifactsScreen', label: 'FILES' }],
  },

  // ── ASSETS ── the things they built. This is what makes the account theirs.
  {
    // An agent decides for itself. Skills (what it knows) and Memory (what it
    // remembers) are properties of an agent and of nothing else, so they are
    // its tabs. Approvals — what it may do without asking — is a rule you set
    // once, so it lives behind Settings, not here.
    id: 'agents',
    group: 'ASSETS',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'AGENTS' },
      { screen: 'SkillsScreen', label: 'SKILLS' },
      { screen: 'MemoryScreen', label: 'MEMORY' },
    ],
  },
  {
    // A workflow runs the same steps every time — the procedure, not the
    // person. It is its own row, not a tab of Agents: a process is not staff.
    id: 'workflows',
    group: 'ASSETS',
    icon: 'fas fa-project-diagram',
    label: 'Workflows',
    screens: [
      { screen: 'WorkflowsScreen', label: 'WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE' },
    ],
  },
  {
    // Tools are called by agents AND by workflows, so neither may own them.
    // Widgets have the same shape — made here, used on Home, in Workspaces
    // and on custom pages — so they ride this row as a tab: a tool does
    // something, a widget shows something.
    id: 'tools',
    group: 'ASSETS',
    icon: 'fas fa-wrench',
    label: 'Tools',
    screens: [
      { screen: 'ToolsScreen', label: 'TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE' },
      { screen: 'WidgetManagerScreen', label: 'WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE' },
    ],
  },

  // ── CONNECTORS ── the outside world, and where more of it comes from.
  {
    // To a business user "connect Slack" and "install the Slack plugin" are
    // the same intent, so Plugins lives in the Apps sidebar beside AI
    // Providers, API / OAuth and the rest (appsDirectory), not as a tab.
    // PluginsScreen stays a separate screen the sidebar opens; it is listed
    // here, unlabelled, only so the rail row stays highlighted on it.
    // AI Providers is deliberately not a row either: "which model" is one more
    // thing you connect, so it is the first view INSIDE Apps — see
    // CONNECT_ITEMS in LeftPanel/ConnectorsPanel. MCP servers stay there for
    // the same reason.
    id: 'apps',
    group: 'CONNECTORS',
    icon: 'fas fa-plug',
    label: 'Apps',
    badge: 'connect',
    screens: [
      { screen: 'ConnectorsScreen', label: 'APPS' },
      { screen: 'PluginsScreen', label: 'PLUGINS', tab: false },
    ],
  },
  {
    // One word everyone already understands. It sells agents, workflows,
    // tools, widgets and plugins, so it is procurement for everything above
    // rather than a tab of any one thing.
    id: 'store',
    group: 'CONNECTORS',
    icon: 'fas fa-store',
    label: 'Market',
    screens: [{ screen: 'MarketplaceScreen', label: 'MARKET' }],
  },
];

// ── The foot of the rail ── below a separator, captionless: the one row you
// visit to set the machine up rather than to do work with it.
//
// Settings carries its OWN left-panel nav, which is why it gets one row
// instead of several: Profile, Billing, Theme, Approvals, Improvements and the
// rest are navigated from SettingsPanel.
//
// `tab: false` — owned and routed by this row, but not drawn in the toolbar.
// Approvals (AutonomyScreen) and Improvements (ExperimentsScreen) are full
// screens rather than Settings sections, so the row has to list them: that is
// what keeps them inside SECTION_ROUTES (without it the canvas reads them as
// custom pages and the gear goes dark while you are on them) and lets them
// share SettingsPanel as their left panel (see screenRegistry.js). Approvals
// is a permission you grant once; Improvements is a power-user surface. Both
// stay reachable but off the rail.
export const BOTTOM_SECTIONS = [
  {
    id: 'settings',
    group: 'SYSTEM',
    icon: 'fas fa-cog',
    label: 'Settings',
    screens: [
      { screen: 'SettingsScreen', label: 'SETTINGS' },
      { screen: 'AutonomyScreen', label: 'APPROVALS', tab: false },
      { screen: 'ExperimentsScreen', label: 'IMPROVEMENTS', tab: false },
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
