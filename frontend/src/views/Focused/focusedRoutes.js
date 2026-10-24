/**
 * Focused's map of the app: which Focused page answers a given route.
 *
 * Focused does not keep its own page state. Every page and every open item is
 * a real route — the SAME routes Studio uses (/agents?select=agent:ID,
 * /workflow-forge?id=ID, /artifacts?select=artifact:PATH …). So a link from a
 * chat message, the Jump palette, an entity chip, a deep link or the browser's
 * Back button lands on the Focused page in Focused and the Studio screen in
 * Studio, with nothing in between knowing which mode is on.
 *
 * A route with no Focused page (a forge's blank canvas, run traces, the
 * dashboard…) returns null and renders as borrowed Studio. `?studio=1` asks
 * for that explicitly ("Open the full editor").
 *
 * Pure: route in, location out. Terminal uses it to skip mounting a full
 * screen a page is about to cover; AGNT One's OneShell uses it to pick the page.
 */

/** Library tabs, in order, with the screen that is each tab's route. */
export const LIBRARY_TAB_SCREENS = Object.freeze({
  agents: 'AgentsScreen',
  workflows: 'WorkflowsScreen',
  tools: 'ToolsScreen',
  skills: 'SkillsScreen',
  widgets: 'WidgetManagerScreen',
  files: 'ArtifactsScreen',
});

/** The `select` kind for an item in each tab (`?select=<kind>:<id>`). */
export const LIBRARY_ITEM_KIND = Object.freeze({
  agents: 'agent',
  workflows: 'workflow',
  tools: 'tool',
  skills: 'skill',
  widgets: 'widget',
  files: 'artifact',
});

export const PAGE_SCREENS = Object.freeze({
  connectors: 'ConnectorsScreen',
  scheduled: 'GoalsScreen',
  memory: 'MemoryScreen',
  settings: 'SettingsScreen',
  market: 'MarketplaceScreen',
  activity: 'TracesScreen',
});

const str = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '');

/** `?select=kind:id` → id, when the kind matches. */
export function selected(query, kind) {
  const raw = str(query?.select);
  const prefix = `${kind}:`;
  return raw.startsWith(prefix) && raw.length > prefix.length ? raw.slice(prefix.length) : null;
}

function library(tab, item = null, extra = {}) {
  return { page: 'library', tab, item, ...extra };
}

/**
 * The Focused location for a screen + query, or null for "borrowed Studio".
 * Chat is never a Focused page: it is Focused's own home and renders itself.
 */
export function focusedLocation(screen, query = {}) {
  if (str(query.studio) === '1') return null;
  const isNew = str(query.new) === '1';

  // `?new=1` on a Library screen opens Focused's own blank editor for that
  // kind. Creating never detours through the chat.
  const item = (tab, kind) => {
    const id = selected(query, kind);
    return id ? library(tab, id) : isNew ? library(tab, null, { isNew: true }) : library(tab);
  };

  switch (screen) {
    case 'AgentsScreen':
      return item('agents', 'agent');
    case 'WorkflowsScreen':
      return item('workflows', 'workflow');
    case 'WorkflowForgeScreen':
      // Workflows are built on the canvas, with Annie's chat on its left
      // (2026-10-23): the Forge itself, in both shells.
      return null;
    case 'ToolsScreen':
      return item('tools', 'tool');
    case 'ToolForgeScreen':
      return str(query['tool-id']) ? library('tools', str(query['tool-id'])) : library('tools', null, { isNew: true });
    case 'SkillsScreen':
      return item('skills', 'skill');
    case 'WidgetManagerScreen':
      return item('widgets', 'widget');
    case 'ArtifactsScreen':
      // Files: `artifact:` opens a file (same intent Studio's Files reads),
      // `dir:` a folder. Both are resolved against the workspace by the page.
      return library('files', selected(query, 'artifact'), { dir: selected(query, 'dir') || '' });
    case 'ConnectorsScreen': {
      // AI models are not apps: the old ?section=providers link (pill, Jump,
      // bookmarks) means "which model", which is Settings in both shells.
      if (str(query.section) === 'providers') return { page: 'settings' };
      if (['oauth', 'vault', 'api-keys'].includes(str(query.section))) return { page: 'connectors', tab: 'vault', item: null };
      // Studio's Email Inbox, Webhooks and MCP sections are Apps tabs in AGNT One (2026-10-23).
      if (['email-server', 'webhooks'].includes(str(query.section))) return { page: 'connectors', tab: 'triggers', item: null };
      if (str(query.section) === 'mcp-servers') return { page: 'connectors', tab: 'mcp', item: null };
      // Public deep links use plugin:<name>; accept saved app:<name> links too.
      const plugin = selected(query, 'plugin') || selected(query, 'app');
      return { page: 'connectors', item: selected(query, 'provider') || (plugin ? `app:${plugin}` : null) };
    }
    // Plugin Forge is the advanced builder in both modes; the catalog lives on ConnectorsScreen.
    case 'PluginsScreen':
      return null;
    case 'GoalsScreen':
    case 'AutonomyScreen': {
      // Autonomy also hosts approvals and limits, which are Studio's. Only
      // its schedules are Focused's "Scheduled".
      const item = selected(query, 'schedule');
      if (str(query.section) === 'schedules' || item || isNew) return { page: 'scheduled', item, isNew };
      return null;
    }
    case 'MemoryScreen':
      return { page: 'memory', item: selected(query, 'memory'), isNew };
    case 'SettingsScreen':
      return { page: 'settings', ...(str(query.section) === 'members' ? { section: 'members' } : {}) };
    case 'MarketplaceScreen': {
      // No Market page of its own (2026-10-23): listings are sections of the
      // Library and Apps pages. A link to one listing still opens it.
      const listing = str(query.item) || selected(query, 'marketplace') || null;
      return listing ? { page: 'market', item: listing } : library('agents');
    }
    case 'TracesScreen':
      // The list of runs, or one run in full (2026-10-23).
      return { page: 'activity', item: str(query.executionId) || selected(query, 'execution') || selected(query, 'trace') || null };
    default:
      return null;
  }
}

/**
 * Navigation for a Focused location: the [screen, options] Terminal's
 * changeScreen takes. The inverse of focusedLocation, so a page that opens an
 * item and the route that item lives at can never disagree (tested both ways).
 */
export function routeFor(loc) {
  if (!loc) return ['ChatScreen', {}];
  if (loc.page === 'library') {
    // A workflow opens on the canvas (see WorkflowForgeScreen above).
    if (loc.tab === 'workflows' && (loc.item || loc.isNew)) return ['WorkflowForgeScreen', { workflowId: loc.item || null }];
    const screen = LIBRARY_TAB_SCREENS[loc.tab] || LIBRARY_TAB_SCREENS.agents;
    if (loc.item) return [screen, { select: { kind: LIBRARY_ITEM_KIND[loc.tab] || 'agent', id: loc.item } }];
    if (loc.isNew && loc.tab !== 'files') return [screen, { newGoal: true }]; // changeScreen's `new=1`
    if (loc.tab === 'files' && loc.dir) return [screen, { select: { kind: 'dir', id: loc.dir } }];
    return [screen, {}];
  }
  if (loc.page === 'connectors') {
    if (loc.tab === 'vault') return [PAGE_SCREENS.connectors, { section: 'oauth' }];
    if (loc.tab === 'triggers') return [PAGE_SCREENS.connectors, { section: 'webhooks' }];
    if (loc.tab === 'mcp') return [PAGE_SCREENS.connectors, { section: 'mcp-servers' }];
    if (!loc.item) return [PAGE_SCREENS.connectors, {}];
    const app = String(loc.item).startsWith('app:') ? String(loc.item).slice(4) : null;
    return [PAGE_SCREENS.connectors, { select: app ? { kind: 'plugin', id: app } : { kind: 'provider', id: loc.item } }];
  }
  if (loc.page === 'scheduled') {
    const opts = { section: 'schedules' };
    if (loc.item) opts.select = { kind: 'schedule', id: loc.item };
    if (loc.isNew) opts.newGoal = true; // changeScreen's `new=1`
    return [PAGE_SCREENS.scheduled, opts];
  }
  if (loc.page === 'memory') {
    const opts = {};
    if (loc.item) opts.select = { kind: 'memory', id: loc.item };
    if (loc.isNew) opts.newGoal = true;
    return [PAGE_SCREENS.memory, opts];
  }
  if (loc.page === 'settings') return [PAGE_SCREENS.settings, loc.section === 'members' ? { section: 'members' } : {}];
  if (loc.page === 'market') return loc.item ? [PAGE_SCREENS.market, { select: { kind: 'marketplace', id: loc.item } }] : [LIBRARY_TAB_SCREENS.agents, {}];
  if (loc.page === 'activity') return [PAGE_SCREENS.activity, loc.item ? { selectedExecutionId: loc.item } : {}];
  return ['ChatScreen', {}];
}

/** Which sidebar row a location belongs to (for its active state). */
export function sidebarPageOf(loc) {
  return loc ? loc.page : null;
}
