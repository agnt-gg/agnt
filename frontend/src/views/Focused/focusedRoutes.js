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
 * Pure: route in, location out. Terminal uses it to skip mounting a Studio
 * screen Focused is about to cover; FocusedShell uses it to pick the page.
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
  plugins: 'ConnectorsScreen',
  scheduled: 'GoalsScreen',
  memory: 'MemoryScreen',
  settings: 'SettingsScreen',
  market: 'MarketplaceScreen',
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

  switch (screen) {
    case 'AgentsScreen':
      // "New agent" is a request to Annie in Focused (as in the demo), so a
      // bare ?new=1 still lands on the list; the button seeds the chat.
      return library('agents', selected(query, 'agent'));
    case 'WorkflowsScreen':
      return library('workflows', selected(query, 'workflow'));
    case 'WorkflowForgeScreen':
      // An existing workflow opens in Focused; the blank canvas is Studio's.
      return str(query.id) ? library('workflows', str(query.id)) : null;
    case 'ToolsScreen':
      return library('tools', selected(query, 'tool'));
    case 'ToolForgeScreen':
      return str(query['tool-id']) ? library('tools', str(query['tool-id'])) : null;
    case 'SkillsScreen':
      return library('skills', selected(query, 'skill'));
    case 'WidgetManagerScreen':
      return library('widgets', selected(query, 'widget'));
    case 'ArtifactsScreen':
      // Files: `artifact:` opens a file (same intent Studio's Files reads),
      // `dir:` a folder. Both are resolved against the workspace by the page.
      return library('files', selected(query, 'artifact'), { dir: selected(query, 'dir') || '' });
    case 'ConnectorsScreen':
    case 'PluginsScreen':
      return { page: 'plugins', item: selected(query, 'provider') };
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
      return { page: 'settings' };
    case 'MarketplaceScreen':
      return { page: 'market', item: str(query.item) || selected(query, 'marketplace') || null };
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
    const screen = LIBRARY_TAB_SCREENS[loc.tab] || LIBRARY_TAB_SCREENS.agents;
    if (loc.item) return [screen, { select: { kind: LIBRARY_ITEM_KIND[loc.tab] || 'agent', id: loc.item } }];
    if (loc.tab === 'files' && loc.dir) return [screen, { select: { kind: 'dir', id: loc.dir } }];
    return [screen, {}];
  }
  if (loc.page === 'plugins') return [PAGE_SCREENS.plugins, loc.item ? { select: { kind: 'provider', id: loc.item } } : {}];
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
  if (loc.page === 'settings') return [PAGE_SCREENS.settings, {}];
  if (loc.page === 'market') return [PAGE_SCREENS.market, loc.item ? { select: { kind: 'marketplace', id: loc.item } } : {}];
  return ['ChatScreen', {}];
}

/** Which sidebar row a location belongs to (for its active state). */
export function sidebarPageOf(loc) {
  return loc ? loc.page : null;
}
