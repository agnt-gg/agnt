/**
 * Focused shell — the pure half.
 *
 * Everything here is a function of store data, so it is tested without a DOM
 * (focusedModel.spec.js). The components in this folder only render what these
 * return and dispatch what they are told to.
 *
 * THE ONE RULE: Focused is a FRAME, not a second client. It reads and writes
 * through the shared Vuex stores and services, and navigates by the same
 * routes Studio uses (focusedRoutes.js). It never calls the API itself; the
 * drift guard in focusedDrift.spec.js fails the build if that changes.
 */
import { buildJumpCatalog } from '@/canvas/jumpCatalog.js';
import { matches } from '@/canvas/jumpIndex.js';
import { ALL_SECTIONS } from '@/canvas/sections.js';

// ── Screens ────────────────────────────────────────────────────────────────

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

// ── Pages Focused owns (no Studio equivalent of their LOOK) ────────────────

export const FOCUSED_PAGES = Object.freeze({
  library: {
    title: 'Library',
    sub: 'Everything you\u2019ve made with AGNT. Open anything to read or change it, or ask in chat.',
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
  memory: {
    title: 'Memory',
    sub: 'What AGNT remembers about you and how you like things done.',
    icon: 'fas fa-brain',
  },
  settings: {
    title: 'Settings',
    sub: 'How AGNT looks and which model it uses.',
    icon: 'fas fa-cog',
  },
});

export function isFocusedPage(page) {
  return Object.prototype.hasOwnProperty.call(FOCUSED_PAGES, page);
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
  // Files is the workspace on disk (fileSystemService), not a store list.
  { id: 'files', label: 'Files', icon: 'fas fa-folder', noun: 'file' },
]);

export function libraryTab(id) {
  return LIBRARY_TABS.find((t) => t.id === id) || LIBRARY_TABS[0];
}

/**
 * Rows for one Library tab: label, description, icon and the item id the
 * row opens (in Focused's own editor, by route). Sorted by name
 * (case-insensitive); filtered by the same word matcher Ctrl+K uses.
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
      const icon = [source.avatar, source.icon].find((x) => typeof x === 'string' && x.trim());
      rows.push({
        id: entry.id,
        itemId: String(entry.id).slice(tab.prefix.length),
        label: entry.label || tab.label,
        description: String(source.description || source.text || '').trim(),
        icon: icon ? icon.trim() : tab.icon,
        status: tab.id === 'workflows' ? String(source.status || '') : '',
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

/**
 * Which of the three saved icon forms a string is: 'class' (Font Awesome),
 * 'name' (the app's SVG icon set: lowercase words joined by dashes), 'text'
 * (an emoji or glyph), or 'none'.
 */
export function glyphKind(icon) {
  const s = typeof icon === 'string' ? icon.trim() : '';
  if (!s) return 'none';
  if (isIconClass(s)) return 'class';
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(s) && s.length > 2) return 'name';
  return 'text';
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
 * Providers signed in through a local CLI (device codes, local files). Their
 * connect flows are multi-step and live in Studio's Connectors; Focused shows
 * their status and can disconnect them (CLI_DISCONNECT_ACTIONS).
 */
export const CLI_PROVIDERS = new Set(['claude-code', 'openai-codex', 'gemini-cli', 'antigravity']);
export const CLI_DISCONNECT_ACTIONS = Object.freeze({
  'claude-code': 'appAuth/disconnectClaudeCode',
  'openai-codex': 'appAuth/logoutCodex',
  'gemini-cli': 'appAuth/disconnectGeminiCli',
  antigravity: 'appAuth/disconnectAntigravity',
});

/** One card by id, for the connection page (null when it is not known). */
export function pluginCard(allProviders, connectedApps, id) {
  const key = String(id || '').toLowerCase();
  const { connected, available } = pluginCards(allProviders, connectedApps);
  return [...connected, ...available].find((c) => c.id === key) || null;
}

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
      providerId: String(p.id),
      name: String(p.name || p.id),
      icon: typeof p.icon === 'string' ? p.icon : '',
      connectionType: CLI_PROVIDERS.has(id) ? 'cli' : String(p.connectionType || ''),
      instructions: String(p.instructions || p.custom_prompt || ''),
      connected: connected.has(id),
      status: connected.has(id) ? (p.connectionType === 'apikey' ? 'API key' : 'Connected') : 'Not connected',
    });
  }
  // A connection the catalogue does not list (local CLI providers, custom
  // keys) is still connected and still belongs on this page.
  for (const id of connected) {
    if (seen.has(id)) continue;
    cards.push({
      id,
      providerId: id,
      name: id,
      icon: '',
      connectionType: CLI_PROVIDERS.has(id) ? 'cli' : '',
      instructions: '',
      connected: true,
      status: 'Connected',
    });
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
        goalId: isGoal ? s.target_id : null,
        label: String(goal?.title || goal?.text || s.name || '').trim() || 'Scheduled task',
        description: String(goal?.description || goal?.text || goal?.title || '').trim(),
        cron: String(s.cron || s.cron_expression || ''),
        timezone: s.timezone || '',
        cadence: cronLabel(s.cron || s.cron_expression),
        next: s.enabled ? timeOf(s.next_run) : 0,
        last: timeOf(s.last_run),
        lastStatus: s.last_status || '',
        lastError: s.last_error || '',
        runCount: Number(s.run_count) || 0,
        enabled: !!s.enabled,
      };
    })
    .filter((r) => matches(query, r.label, r.cadence))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.next || Infinity) - (b.next || Infinity) || a.label.localeCompare(b.label));
}

// ── Account ────────────────────────────────────────────────────────────────

// Routines: the editor's choices (the demo's), and cron in and out of them.

export const REPEATS = Object.freeze([
  ['daily', 'Every day'],
  ['weekdays', 'Weekdays'],
  ['weekly', 'Every week'],
  ['monthly', 'Every month'],
  ['hourly', 'Every hour'],
]);
export const WEEKDAYS = Object.freeze([
  ['MON', 'Monday'],
  ['TUE', 'Tuesday'],
  ['WED', 'Wednesday'],
  ['THU', 'Thursday'],
  ['FRI', 'Friday'],
  ['SAT', 'Saturday'],
  ['SUN', 'Sunday'],
]);
const DOW_CODE = { SUN: 'SUN', MON: 'MON', TUE: 'TUE', WED: 'WED', THU: 'THU', FRI: 'FRI', SAT: 'SAT', 0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 7: 'SUN' };

/** Cron → the editor's fields. Anything it cannot show is 'custom', verbatim. */
export function parseCron(cron) {
  const c = String(cron || '').trim();
  const parts = c.split(/\s+/);
  const [min, hour, dom, mon, dow] = parts;
  const num = (v) => /^\d+$/.test(v || '');
  const time = num(min) && num(hour) ? `${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : '09:00';
  const base = { time, dow: 'MON', dom: 1, minute: 0, custom: c };
  if (parts.length !== 5) return { ...base, repeat: 'custom' };
  if (num(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return { ...base, repeat: 'hourly', minute: +min };
  if (!num(min) || !num(hour) || mon !== '*') return { ...base, repeat: 'custom' };
  if (dom === '*' && dow === '*') return { ...base, repeat: 'daily' };
  if (dom === '*' && /^(MON-FRI|1-5)$/i.test(dow)) return { ...base, repeat: 'weekdays' };
  if (dom === '*' && DOW_CODE[dow.toUpperCase()]) return { ...base, repeat: 'weekly', dow: DOW_CODE[dow.toUpperCase()] };
  if (dow === '*' && num(dom) && +dom >= 1 && +dom <= 28) return { ...base, repeat: 'monthly', dom: +dom };
  return { ...base, repeat: 'custom' };
}

/** The editor's fields → cron ('' when the time is not a valid HH:MM). */
export function buildCron({ repeat, time, dow, dom, minute = 0, custom = '' }) {
  if (repeat === 'custom') return String(custom || '').trim();
  if (repeat === 'hourly') return `${Math.min(59, Math.max(0, Number(minute) || 0))} * * * *`;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  const [h, mi] = [+m[1], +m[2]];
  if (repeat === 'daily') return `${mi} ${h} * * *`;
  if (repeat === 'weekdays') return `${mi} ${h} * * MON-FRI`;
  if (repeat === 'weekly') return `${mi} ${h} * * ${DOW_CODE[String(dow).toUpperCase()] || 'MON'}`;
  if (repeat === 'monthly') return `${mi} ${h} ${Math.min(28, Math.max(1, Number(dom) || 1))} * *`;
  return '';
}

export const isCron = (c) => /^\S+(\s+\S+){4}$/.test(String(c || '').trim());

// Memory

/** The kinds a person can file a memory under (the backend's memory types). */
export const MEMORY_TYPES = Object.freeze([
  ['fact', 'Fact'],
  ['preference', 'Preference'],
  ['correction', 'Correction'],
  ['context', 'Context'],
]);

/** Memories newest first, filtered by text. Accepts the insights store rows. */
export function memoryRows(memories, query = '') {
  return (Array.isArray(memories) ? memories : [])
    .filter((m) => m && m.id != null)
    .map((m) => ({
      id: String(m.id),
      text: String(m.content ?? m.text ?? '').trim(),
      type: String(m.memory_type || m.memoryType || m.type || 'fact'),
      agentId: m.agent_id || m.agentId || null,
      at: timeOf(m.updated_at || m.created_at || m.createdAt),
    }))
    .filter((m) => m.text && matches(query, m.text, m.type))
    .sort((a, b) => b.at - a.at);
}

export function initialOf(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : 'A';
}
