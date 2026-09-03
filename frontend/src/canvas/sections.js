// Canvas navigation registry — the single source of truth for which screens
// exist, which sidebar section owns each one, and what the toolbar tab says.
//
// The sidebar renders one row per section, grouped under a caption (`group`);
// the toolbar renders one tab per entry in the active section's `screens`.
// Moving a screen between surfaces is therefore a re-parent in THIS file,
// nothing else.
//
// THE RAIL IS WRITTEN FOR THE MIDDLE OF THE BELL CURVE. Every caption is a
// possessive a person would say about their own desk (TODAY · MY WORK · MY
// TEAM · MY TOOLKIT), every row is one plain noun, and nothing on the rail is
// a word only an engineer uses (runs, traces, artifacts, connectors, library,
// plugins). Route names and screen names keep their old identifiers — this
// file is about what a person READS, not what the code is called.
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
//                 Every forge uses this. A forge is an editor you enter from a
//                 card, not a destination you pick from the strip; showing its
//                 tab only while you are inside it keeps the strip about
//                 destinations and still tells you where you are.
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
    // Workspaces is a tab of Chat, not a row. A workspace is a chat with a
    // custom canvas around it — the same conversation, arranged — so it lives
    // one tab to the right of the thread rather than one row down the rail
    // under a word ("Workspaces") that means five things to five people.
    id: 'chat',
    group: 'TODAY',
    icon: 'fas fa-comments',
    label: 'Chat',
    screens: [
      { screen: 'ChatScreen', label: 'CHAT' },
      { screen: 'WorkspaceScreen', label: 'WORKSPACES' },
    ],
  },
  {
    // "Home" is the universal first click. The route and screen are still
    // Dashboard; the person reading the rail does not need to know that.
    id: 'dashboard',
    group: 'TODAY',
    icon: 'fas fa-home',
    label: 'Home',
    screens: [{ screen: 'DashboardScreen', label: 'HOME' }],
  },

  // ── MY WORK ── what I asked for, what happened, what came out of it.
  {
    id: 'goals',
    group: 'MY WORK',
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
    group: 'MY WORK',
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
    group: 'MY WORK',
    icon: 'fas fa-folder',
    label: 'Files',
    screens: [{ screen: 'ArtifactsScreen', label: 'FILES' }],
  },

  // ── MY TEAM ── who and what does the work for me.
  {
    // One mental object — my team: who they are (Agents), what they know
    // (Skills), what they remember (Memory), what they may do without asking
    // (Approvals). Memory and Approvals were SYSTEM screens hidden behind the
    // gear; "team" is the word that makes all four obvious at once.
    id: 'agents',
    group: 'MY TEAM',
    icon: 'fas fa-robot',
    label: 'Agents',
    screens: [
      { screen: 'AgentsScreen', label: 'AGENTS' },
      { screen: 'AgentForgeScreen', label: 'AGENT FORGE', ctx: true },
      { screen: 'SkillsScreen', label: 'SKILLS' },
      { screen: 'MemoryScreen', label: 'MEMORY' },
      { screen: 'AutonomyScreen', label: 'APPROVALS' },
    ],
  },
  {
    // Workflows, tools and widgets are all "things that do work for me". One
    // row, three destinations, three contextual editors — the same mechanism
    // Agents uses. The rail row lands on Workflows.
    id: 'automations',
    group: 'MY TEAM',
    icon: 'fas fa-project-diagram',
    label: 'Automations',
    screens: [
      { screen: 'WorkflowsScreen', label: 'WORKFLOWS' },
      { screen: 'WorkflowForgeScreen', label: 'WORKFLOW FORGE', ctx: true },
      { screen: 'ToolsScreen', label: 'TOOLS' },
      { screen: 'ToolForgeScreen', label: 'TOOL FORGE', ctx: true },
      { screen: 'WidgetManagerScreen', label: 'WIDGETS' },
      { screen: 'WidgetForgeScreen', label: 'WIDGET FORGE', ctx: true },
    ],
  },

  // ── MY TOOLKIT ── what the team works with, and where more comes from.
  {
    // To a business user "connect Slack" and "install the Slack plugin" are
    // the same intent, so Connections and Plugins are two tabs of one row.
    // AI Providers is deliberately not a row either: "which model" is one more
    // thing you connect, so it is the first view INSIDE Connected apps — see
    // CONNECT_ITEMS in LeftPanel/ConnectorsPanel. MCP servers stay there for
    // the same reason.
    id: 'apps',
    group: 'MY TOOLKIT',
    icon: 'fas fa-plug',
    label: 'Apps',
    badge: 'connect',
    screens: [
      { screen: 'ConnectorsScreen', label: 'CONNECTED APPS' },
      { screen: 'PluginsScreen', label: 'ADD-ONS' },
    ],
  },
  {
    // One word everyone already understands.
    id: 'store',
    group: 'MY TOOLKIT',
    icon: 'fas fa-store',
    label: 'Store',
    screens: [{ screen: 'MarketplaceScreen', label: 'STORE' }],
  },
];

// ── The foot of the rail ── below a separator, captionless: the one row you
// visit to set the machine up rather than to do work with it.
//
// Settings carries its OWN left-panel nav, which is why it gets one row
// instead of several: Profile, Billing, Theme, Improvements and the rest are
// navigated from SettingsPanel.
//
// `tab: false` — owned and routed by this row, but not drawn in the toolbar.
// Improvements (ExperimentsScreen) is a full screen rather than a Settings
// section, so the row has to list it: that is what keeps it inside
// SECTION_ROUTES (without it the canvas reads it as a custom page and the
// gear goes dark while you are on it) and lets it share SettingsPanel as its
// left panel (see screenRegistry.js). It is genuinely a power-user surface,
// which is why it stays reachable but off the rail.
export const BOTTOM_SECTIONS = [
  {
    id: 'settings',
    group: 'SYSTEM',
    icon: 'fas fa-cog',
    label: 'Settings',
    screens: [
      { screen: 'SettingsScreen', label: 'SETTINGS' },
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
