// Canvas navigation registry — the single source of truth for which screens
// exist, which sidebar section owns each one, and what the toolbar tab says.
//
// The sidebar renders one row per section, grouped under a caption (`group`);
// the toolbar renders one tab per entry in the active section's `screens`.
// Moving a screen between surfaces is therefore a re-parent in THIS file,
// nothing else.
//
// THE RAIL IS WRITTEN FOR THE MIDDLE OF THE BELL CURVE. Captions are single
// plain words (WORK · PLAN · BUILD, with Settings at the foot);
// every row is one plain noun; nothing on the rail is a word only an engineer
// uses (runs, traces, artifacts, library, plugins). Route names and screen
// names keep their old identifiers — this file is about what a person READS,
// not what the code is called.
//
// The captions are three verbs a business user already does with a team:
//   WORK  — talk to Annie, and get more from the Market.
//   PLAN  — see what is going on: the overview, goals, what happened, files.
//   BUILD — plugins bundle agents, workflows, tools, skills and widgets.
//           Each capability also has its own row. Model connections live
//           separately in Settings › AI Models.
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
  // ── WORK ── where you land: talk, or get more.
  {
    // Canvas is a tab of Chat, not a row: a chat with a custom canvas around
    // it — the same conversation, arranged — so it lives one tab to the right
    // of the thread. Not "workspace": that word is gone from the UI. The
    // personal/team switcher is a SPACE; an arranged layout is a CANVAS.
    id: 'chat',
    group: 'WORK',
    icon: 'fas fa-comments',
    label: 'Chat',
    screens: [
      { screen: 'ChatScreen', label: 'CHAT' },
      { screen: 'WorkspaceScreen', label: 'CANVAS' },
    ],
  },
  {
    // One word everyone already understands. It sells apps, agents,
    // workflows, tools and widgets, so it is where you get more of anything
    // rather than a tab of any one thing.
    id: 'store',
    group: 'WORK',
    icon: 'fas fa-store',
    label: 'Market',
    screens: [{ screen: 'MarketplaceScreen', label: 'MARKET' }],
  },

  // ── PLAN ── the overview, what I asked for, what happened, what came of it.
  {
    id: 'dashboard',
    group: 'PLAN',
    icon: 'fas fa-th-large',
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
    // "Activity" is the word every product a business user already knows
    // uses for "what happened" (Slack, GitHub, their bank). "Runs" was the
    // engineer's word; "Traces" is what engineers call the record of one.
    id: 'traces',
    group: 'PLAN',
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
    group: 'PLAN',
    icon: 'fas fa-folder',
    label: 'Files',
    screens: [{ screen: 'ArtifactsScreen', label: 'FILES' }],
  },

  // ── BUILD ── the things that do the work. This is what makes the account theirs.
  {
    // Plugins leads BUILD. The saved 'apps' id stays stable for user nav settings.
    // Plugin Forge is a sidebar entry, not a toolbar tab; both share this row.
    id: 'apps',
    group: 'BUILD',
    icon: 'fas fa-cube',
    label: 'Plugins',
    badge: 'connect',
    screens: [
      { screen: 'ConnectorsScreen', label: 'PLUGINS' },
      { screen: 'PluginsScreen', label: 'PLUGIN FORGE', tab: false },
    ],
  },
  {
    // An agent decides for itself. Memory (what it remembers) is a property
    // of an agent and of nothing else, so it is its tab. Approvals — what it
    // may do without asking — is a rule you set once, so it is behind Settings.
    id: 'agents',
    group: 'BUILD',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'AGENTS' },
      { screen: 'MemoryScreen', label: 'MEMORY' },
    ],
  },
  {
    // A workflow runs the same steps every time — the procedure, not the
    // person. It is its own row, not a tab of Agents: a process is not staff.
    id: 'workflows',
    group: 'BUILD',
    icon: 'fas fa-project-diagram',
    label: 'Workflows',
    screens: [
      { screen: 'WorkflowsScreen', label: 'WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE' },
    ],
  },
  {
    // Tools are called by agents AND by workflows, so neither may own them.
    id: 'tools',
    group: 'BUILD',
    icon: 'fas fa-wrench',
    label: 'Tools',
    screens: [
      { screen: 'ToolsScreen', label: 'TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE' },
    ],
  },
  {
    // What an agent knows how to do. Its own row because a skill is shared:
    // many agents use one, and apps ship them.
    id: 'skills',
    group: 'BUILD',
    icon: 'fas fa-graduation-cap',
    label: 'Skills',
    screens: [{ screen: 'SkillsScreen', label: 'SKILLS' }],
  },
  {
    // A tool does something; a widget SHOWS something — made here, used on
    // the Dashboard, in a Canvas and on custom pages. Not a tool, so not a
    // tab of Tools.
    id: 'widgets',
    group: 'BUILD',
    icon: 'fas fa-shapes',
    label: 'Widgets',
    screens: [
      { screen: 'WidgetManagerScreen', label: 'WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE' },
    ],
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
      { screen: 'LearningScreen', label: 'LEARNING', tab: false },
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
