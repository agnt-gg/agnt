/**
 * Simple shell — the pure half.
 *
 * Everything here is a function of store data, so it is tested without a DOM
 * (simpleModel.spec.js). The components in this folder only render what these
 * return and dispatch what they are told to.
 *
 * THE ONE RULE: Simple is a FRAME, not a second client. It reads the shared
 * Vuex stores and opens things through the same executor the Jump palette
 * uses (canvas/jumpActions.js). It never calls the API itself; the drift
 * guard in simpleDrift.spec.js fails the build if that changes.
 */
import { buildJumpCatalog } from '@/canvas/jumpCatalog.js';
import { matches } from '@/canvas/jumpIndex.js';
import { ALL_SECTIONS } from '@/canvas/sections.js';

// ── Screens ────────────────────────────────────────────────────────────────

/**
 * Screens Simple renders bare, as its own. Everything else is "borrowed
 * Studio": rendered in full, untouched, under a bar that leads back.
 */
export const SIMPLE_NATIVE_SCREENS = Object.freeze(['ChatScreen']);

export function isBorrowedScreen(screen) {
  return !!screen && !SIMPLE_NATIVE_SCREENS.includes(screen);
}

/** The name Studio's own rail uses for a screen, so the two never disagree. */
export function screenTitle(screen) {
  for (const section of ALL_SECTIONS) {
    const tab = section.screens.find((t) => t.screen === screen);
    if (!tab) continue;
    if (tab.screen === section.screens[0].screen) return section.label;
    const word = String(tab.label || '').toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return String(screen || '').replace(/Screen$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// ── Pages Simple owns (no Studio equivalent of their LOOK) ────────────────

export const SIMPLE_PAGES = Object.freeze({
  library: {
    title: 'Library',
    sub: 'Everything you\u2019ve made with AGNT. Ask in chat to create or change anything.',
    icon: 'fas fa-book',
  },
  plugins: {
    title: 'Plugins',
    sub: 'Apps and AI models AGNT can use for you. It asks before sending, buying or changing anything.',
    icon: 'fas fa-plug',
  },
  scheduled: {
    title: 'Scheduled',
    sub: 'Things AGNT does for you on a schedule.',
    icon: 'fas fa-redo',
  },
});

export function isSimplePage(page) {
  return Object.prototype.hasOwnProperty.call(SIMPLE_PAGES, page);
}

// ── Library ────────────────────────────────────────────────────────────────

/**
 * One tab per kind of thing a user makes. `getter`/`fetch` name the shared
 * store; `catalogKey` is the buildJumpCatalog source key, so opening a row is
 * exactly what opening it from Ctrl+K does. `ask` seeds the chat input for
 * the "New …" button — creation goes through Annie, as in the AGNT One demo.
 */
export const LIBRARY_TABS = Object.freeze([
  { id: 'agents', label: 'Agents', icon: 'fas fa-robot', getter: 'agents/allAgents', fetch: 'agents/fetchAgents', catalogKey: 'agents', prefix: 'agent:', noun: 'agent', ask: 'Create an agent that ' },
  { id: 'workflows', label: 'Workflows', icon: 'fas fa-project-diagram', getter: 'workflows/allWorkflows', fetch: 'workflows/fetchWorkflows', catalogKey: 'workflows', prefix: 'workflow:', noun: 'workflow', ask: 'Build a workflow that ' },
  { id: 'tools', label: 'Tools', icon: 'fas fa-wrench', getter: 'tools/customTools', fetch: 'tools/fetchTools', catalogKey: 'tools', prefix: 'tool:', noun: 'tool', ask: 'Make a tool that ' },
  { id: 'skills', label: 'Skills', icon: 'fas fa-graduation-cap', getter: 'skills/allSkills', fetch: 'skills/fetchSkills', catalogKey: 'skills', prefix: 'skill:', noun: 'skill', ask: 'Write a skill for ' },
  { id: 'widgets', label: 'Widgets', icon: 'fas fa-shapes', getter: 'widgetDefinitions/allDefinitions', fetch: 'widgetDefinitions/fetchDefinitions', catalogKey: 'widgets', prefix: 'widget:', noun: 'widget', ask: 'Make a widget that shows ' },
]);

/** Files is a tab that opens the real file browser rather than a copy of it. */
export const LIBRARY_FILES_ACTION = Object.freeze({ type: 'screen', screen: 'ArtifactsScreen', opts: {} });

export function libraryTab(id) {
  return LIBRARY_TABS.find((t) => t.id === id) || LIBRARY_TABS[0];
}

/**
 * Rows for one Library tab: label, description, icon and the jump action that
 * opens it. Sorted by name (case-insensitive) like the demo; filtered by the
 * same word matcher Ctrl+K uses.
 */
export function libraryRows(tabId, items, query = '') {
  const tab = libraryTab(tabId);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const byId = new Map(list.map((item) => [String(item.id ?? item.name), item]));
  const catalog = buildJumpCatalog({ [tab.catalogKey]: list });
  const rows = [];
  for (const group of catalog) {
    for (const entry of group.items) {
      if (!String(entry.id).startsWith(tab.prefix)) continue;
      const source = byId.get(String(entry.id).slice(tab.prefix.length)) || {};
      rows.push({
        id: entry.id,
        label: entry.label || tab.label,
        description: String(source.description || source.text || '').trim(),
        icon: typeof source.icon === 'string' && source.icon.trim() ? source.icon.trim() : tab.icon,
        action: entry.action,
      });
    }
  }
  return rows
    .filter((r) => matches(query, r.label, r.description))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** An icon string is either a Font Awesome class list or a literal glyph/emoji. */
export function isIconClass(icon) {
  return typeof icon === 'string' && /^(fa[srlbd]?|fas|far|fab|fa)\s/.test(icon.trim());
}

// ── Recents ────────────────────────────────────────────────────────────────

function timeOf(value) {
  const t = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The conversation list: newest activity first, titled, filtered by title.
 * Input is contentOutputs/visibleOutputs (archived rows already excluded).
 */
export function recentConversations(outputs, query = '', limit = 60) {
  const rows = (Array.isArray(outputs) ? outputs : [])
    .filter((o) => o && o.id)
    .map((o) => ({
      id: o.id,
      title: String(o.title || '').trim() || 'Untitled chat',
      at: timeOf(o.updated_at || o.created_at),
      unread: !!o.last_read_at && timeOf(o.updated_at) > timeOf(o.last_read_at),
    }))
    .filter((r) => matches(query, r.title))
    .sort((a, b) => b.at - a.at);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

// ── Plugins ────────────────────────────────────────────────────────────────

const providerKey = (p) => String((typeof p === 'string' ? p : p?.id) || '').toLowerCase();

/**
 * Connected first (what AGNT can already use), then everything it could.
 * connectedApps is a list of provider ids; allProviders carries the names.
 */
export function pluginCards(allProviders, connectedApps, query = '') {
  const connected = new Set((Array.isArray(connectedApps) ? connectedApps : []).map(providerKey).filter(Boolean));
  const seen = new Set();
  const cards = [];
  for (const p of Array.isArray(allProviders) ? allProviders : []) {
    const id = providerKey(p);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cards.push({
      id,
      name: String(p.name || p.id),
      icon: typeof p.icon === 'string' ? p.icon : '',
      connected: connected.has(id),
      status: connected.has(id) ? (p.connectionType === 'apikey' ? 'API key' : 'Connected') : 'Not connected',
    });
  }
  // A connection the catalogue does not list (local CLI providers, custom
  // keys) is still connected and still belongs on this page.
  for (const id of connected) {
    if (seen.has(id)) continue;
    cards.push({ id, name: id, icon: '', connected: true, status: 'Connected' });
  }
  const filtered = cards.filter((c) => matches(query, c.name, c.id));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return {
    connected: filtered.filter((c) => c.connected).sort(byName),
    available: filtered.filter((c) => !c.connected).sort(byName),
  };
}

// ── Scheduled ──────────────────────────────────────────────────────────────

const DAY_NAMES = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday',
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };

/**
 * A cron expression in words, for the common shapes the demo offered
 * (hourly, daily, weekdays, weekly, monthly). Anything else is shown as-is
 * rather than mistranslated.
 */
export function cronLabel(cron) {
  const c = String(cron || '').trim();
  const parts = c.split(/\s+/);
  if (parts.length !== 5) return c || 'Custom schedule';
  const [min, hour, dom, mon, dow] = parts;
  const num = (v) => /^\d+$/.test(v);
  if (num(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return +min === 0 ? 'Every hour' : `Every hour at :${min.padStart(2, '0')}`;
  }
  if (!num(min) || !num(hour) || mon !== '*') return c;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && dow === '*') return `Every day at ${time}`;
  if (dom === '*' && /^(MON-FRI|1-5)$/i.test(dow)) return `Weekdays at ${time}`;
  if (dom === '*' && DAY_NAMES[dow.toUpperCase()]) return `Every ${DAY_NAMES[dow.toUpperCase()]} at ${time}`;
  if (dow === '*' && num(dom)) return `Monthly on day ${+dom} at ${time}`;
  return c;
}

/**
 * Scheduled rows, enabled first, soonest first; each opens where it is managed.
 *
 * A schedule row has no name of its own (id, target_type, target_id, cron,
 * next_run, enabled …), so it is named after the goal it runs — `goals` is
 * goals/allGoals, titled the way the Jump catalog titles goals.
 */
export function scheduleRows(schedules, query = '', goals = []) {
  const goalById = new Map((Array.isArray(goals) ? goals : []).filter((g) => g && g.id != null).map((g) => [String(g.id), g]));
  return (Array.isArray(schedules) ? schedules : [])
    .filter((s) => s && s.id != null)
    .map((s) => {
      const isGoal = s.target_type === 'goal' && s.target_id != null;
      const goal = isGoal ? goalById.get(String(s.target_id)) : null;
      return {
        id: s.id,
        label: String(goal?.title || goal?.text || s.name || '').trim() || 'Scheduled task',
        cadence: cronLabel(s.cron || s.cron_expression),
        next: s.enabled ? timeOf(s.next_run) : 0,
        enabled: !!s.enabled,
        action: isGoal
          ? { type: 'inspect', kind: 'goal', id: s.target_id, screen: 'GoalsScreen' }
          : { type: 'screen', screen: 'AutonomyScreen', opts: { section: 'schedules' } },
      };
    })
    .filter((r) => matches(query, r.label, r.cadence))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.next || Infinity) - (b.next || Infinity) || a.label.localeCompare(b.label));
}

// ── Account ────────────────────────────────────────────────────────────────

export function initialOf(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : 'A';
}
