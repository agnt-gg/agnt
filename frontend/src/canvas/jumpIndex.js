// Jump index — what ⌘K can reach, as data.
//
// Three groups, one list:
//   Go to  — every rail destination and every toolbar tab (from sections.js)
//   Open   — entities already in the stores: agents, workflows, goals, chats
//   Do     — the handful of verbs the toolbar pills imply
// and when nothing matches, the typed text becomes a message to Annie.
//
// Pure: takes plain arrays, returns plain objects. JumpPalette.vue feeds it
// from the store and renders; the spec feeds it fixtures.

const norm = (s) => String(s || '').toLowerCase();

/** Very small fuzzy match: every query token must appear in the haystack. */
export function matches(query, ...fields) {
  const q = norm(query).trim();
  if (!q) return true;
  const hay = fields.map(norm).join(' ');
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

const SCREEN_ICONS = {
  ChatScreen: 'fas fa-comments',
  ArtifactsScreen: 'fas fa-cube',
  WorkspaceScreen: 'fas fa-columns',
  DashboardScreen: 'fas fa-tachometer-alt',
  GoalsScreen: 'fas fa-bullseye',
  TracesScreen: 'fas fa-stream',
  AgentsScreen: 'fas fa-robot',
  AgentForgeScreen: 'fas fa-robot',
  WorkflowsScreen: 'fas fa-project-diagram',
  WorkflowForgeScreen: 'fas fa-project-diagram',
  ToolsScreen: 'fas fa-wrench',
  ToolForgeScreen: 'fas fa-wrench',
  SkillsScreen: 'fas fa-graduation-cap',
  PluginsScreen: 'fas fa-puzzle-piece',
  WidgetManagerScreen: 'fas fa-shapes',
  WidgetForgeScreen: 'fas fa-shapes',
  MarketplaceScreen: 'fas fa-store',
  ConnectorsScreen: 'fas fa-plug',
  SettingsScreen: 'fas fa-cog',
  MemoryScreen: 'fas fa-brain',
  ExperimentsScreen: 'fas fa-dna',
  AutonomyScreen: 'fas fa-user-shield',
};

const title = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ');

/**
 * @param {object} src
 * @param {Array} src.sections       ALL_SECTIONS from sections.js
 * @param {Array} [src.agents]
 * @param {Array} [src.workflows]
 * @param {Array} [src.goals]
 * @param {Array} [src.chats]        content outputs (conversations)
 * @param {number} [src.approvals]   escalated insight count
 * @param {boolean} [src.hasProvider]
 * @param {string} [src.query]
 * @returns {{groups: Array<{id:string,label:string,items:Array}>, fallthrough: object|null}}
 */
export function buildJumpIndex(src) {
  const q = src.query || '';
  const goto = [];
  for (const section of src.sections || []) {
    for (const tab of section.screens) {
      if (tab.tab === false) {
        // SYSTEM screens are still reachable from ⌘K even though they have no tab.
      }
      const label = tab.screen === section.screens[0].screen ? section.label : `${section.label} › ${title(tab.label.toLowerCase())}`;
      goto.push({
        id: `go:${tab.screen}`,
        icon: SCREEN_ICONS[tab.screen] || section.icon,
        label,
        // Keyed on the screen name, not on tab.ctx: the forges stopped being
        // contextual tabs when they became permanent ones, and this hint is
        // about what the destination IS, not about how its tab is drawn.
        hint: /ForgeScreen$/.test(tab.screen) || tab.ctx ? 'editor' : '',
        action: { type: 'screen', screen: tab.screen },
        _hay: [label, tab.label, section.group],
      });
    }
  }

  const open = [];
  for (const a of src.agents || []) {
    open.push({ id: `agent:${a.id}`, icon: 'fas fa-robot', label: a.name || 'Agent', hint: `agent · ${a.status || a.category || ''}`.replace(/ · $/, ''), action: { type: 'inspect', kind: 'agent', id: a.id, screen: 'AgentsScreen' }, _hay: [a.name, a.category, 'agent'] });
  }
  for (const w of src.workflows || []) {
    open.push({ id: `workflow:${w.id}`, icon: 'fas fa-project-diagram', label: w.name || 'Workflow', hint: `workflow · ${w.status || ''}`.replace(/ · $/, ''), action: { type: 'inspect', kind: 'workflow', id: w.id, screen: 'WorkflowsScreen' }, _hay: [w.name, 'workflow', w.status] });
  }
  for (const g of src.goals || []) {
    open.push({ id: `goal:${g.id}`, icon: 'fas fa-bullseye', label: g.title || g.text || 'Goal', hint: `goal · ${g.status || ''}`.replace(/ · $/, ''), action: { type: 'inspect', kind: 'goal', id: g.id, screen: 'GoalsScreen' }, _hay: [g.title, g.text, 'goal', g.status] });
  }
  for (const c of src.chats || []) {
    open.push({ id: `chat:${c.id}`, icon: 'fas fa-comments', label: c.title || c.name || 'Chat', hint: 'chat', action: { type: 'chat', id: c.id }, _hay: [c.title, c.name, 'chat', 'conversation'] });
  }

  const doItems = [
    { id: 'do:new-chat', icon: 'fas fa-plus', label: 'New chat', kbd: '⌘N', action: { type: 'new-chat' }, _hay: ['new chat', 'conversation'] },
    { id: 'do:new-agent', icon: 'fas fa-robot', label: 'New agent', hint: 'Agent Forge', action: { type: 'screen', screen: 'AgentForgeScreen' }, _hay: ['new agent', 'create agent', 'forge'] },
    { id: 'do:new-workflow', icon: 'fas fa-project-diagram', label: 'New workflow', hint: 'Workflow Forge', action: { type: 'screen', screen: 'WorkflowForgeScreen' }, _hay: ['new workflow', 'create workflow', 'forge'] },
    { id: 'do:new-tool', icon: 'fas fa-wrench', label: 'New tool', hint: 'Tool Forge', action: { type: 'screen', screen: 'ToolForgeScreen' }, _hay: ['new tool', 'create tool', 'forge'] },
    { id: 'do:new-goal', icon: 'fas fa-bullseye', label: 'Run a goal…', hint: 'Goals', action: { type: 'screen', screen: 'GoalsScreen', opts: { newGoal: true } }, _hay: ['new goal', 'run goal', 'create goal'] },
  ];
  if (src.approvals > 0) {
    doItems.unshift({ id: 'do:approvals', icon: 'fas fa-user-shield', label: `Review ${src.approvals} pending approval${src.approvals === 1 ? '' : 's'}`, hint: 'Autonomy', action: { type: 'screen', screen: 'AutonomyScreen' }, _hay: ['approve', 'approvals', 'autonomy', 'pending'] });
  }
  if (src.hasProvider === false) {
    doItems.unshift({ id: 'do:provider', icon: 'fas fa-robot', label: 'Connect an AI provider', hint: 'Connections › AI Providers', action: { type: 'screen', screen: 'ConnectorsScreen', opts: { section: 'providers' } }, _hay: ['provider', 'connect', 'api key', 'model'] });
  }
  doItems.push({ id: 'do:docs', icon: 'fas fa-book', label: 'Docs', hint: 'Quick start · tools · spec', action: { type: 'route', path: '/docs' }, _hay: ['docs', 'documentation', 'help', 'guide'] });
  doItems.push({ id: 'do:about', icon: 'fas fa-info-circle', label: 'About · GitHub · Discord · Feedback', hint: 'Settings › About', action: { type: 'screen', screen: 'SettingsScreen', opts: { section: 'about' } }, _hay: ['about', 'github', 'discord', 'feedback', 'version', 'resources'] });

  const filt = (items) => items.filter((i) => matches(q, ...i._hay)).map(({ _hay, ...rest }) => rest);
  const groups = [
    { id: 'goto', label: 'Go to', items: filt(goto) },
    { id: 'open', label: 'Open', items: filt(open).slice(0, 12) },
    { id: 'do', label: 'Do', items: filt(doItems) },
  ].filter((g) => g.items.length);

  const fallthrough = q.trim() && !groups.length ? { id: 'ask', icon: 'fas fa-comment-dots', label: `"${q.trim()}" — send to Annie`, action: { type: 'ask', text: q.trim() } } : null;
  return { groups, fallthrough };
}

/** Flat ordered list of selectable rows (for ↑↓ navigation). */
export function flatten(index) {
  const rows = index.groups.flatMap((g) => g.items);
  return index.fallthrough ? [index.fallthrough] : rows;
}
