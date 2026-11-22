/**
 * The Apps page as plain data: each section's rows (connections, plugins, MCP
 * servers, email and webhook triggers) and the search, filters, sorting and
 * grouping its list offers. No Vue and no store: the page passes in what it
 * read and renders what comes back, so the rules live (and are tested) here.
 */
import { accountRows, compositionOf, connectionKind, hasTriggers, pluginInventory, pluginKind, trustTier } from '@/services/pluginDirectory.js';
import { appDisplayName, pluginProviders, primaryProvider } from '@/services/appCards.js';
import { titleFromSlug } from '@/services/studioApps.js';
import { brandIcon, pluginIcon } from '@/services/brandIcons.js';

const list = (value) => (Array.isArray(value) ? value : []);
const lower = (value) => String(value ?? '').trim().toLowerCase();
const time = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });

// ── Sections ─────────────────────────────────────────────────────────────

export const SECTIONS = Object.freeze([
  { id: 'connections', label: 'App connections', title: 'Connections', icon: 'plug', noun: 'connection', nouns: 'connections' },
  { id: 'plugins', label: 'Plugins', title: 'Plugins', icon: 'puzzle', noun: 'plugin', nouns: 'plugins' },
  { id: 'mcp', label: 'MCP servers', title: 'MCP servers', icon: 'server', noun: 'server', nouns: 'servers' },
  { id: 'triggers', label: 'Email & webhooks', title: 'Email & webhooks', icon: 'mail', noun: 'trigger', nouns: 'triggers' },
]);

/** The section a route tab opens. No tab, and the older 'vault', open Connections. */
export const sectionOfTab = (tab) => (['plugins', 'mcp', 'triggers'].includes(tab) ? tab : 'connections');
/** The route tab for a section. Connections is the page's default, so it has none. */
export const tabOfSection = (section) => (section === 'connections' ? '' : section);

// ── Words ────────────────────────────────────────────────────────────────

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function listNames(names) {
  const all = list(names).filter(Boolean);
  if (all.length <= 2) return all.join(' and ');
  return `${all.slice(0, 2).join(', ')} and ${plural(all.length - 2, 'other')}`;
}

const validDate = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};
const clock = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function formatDate(iso) {
  const date = validDate(iso);
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

/** A check time for a table cell: "Today, 11:27 AM" today, else the date. */
export function formatChecked(iso, now = new Date()) {
  const date = validDate(iso);
  if (!date) return '—';
  return date.toDateString() === now.toDateString() ? `Today, ${clock(date)}` : formatDate(iso);
}

/** A check time in a sentence: "today at 11:27 AM", "Nov 3 at 9:05 PM". */
export function formatWhen(iso, now = new Date()) {
  const date = validDate(iso);
  if (!date) return '';
  const day = date.toDateString() === now.toDateString() ? 'today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} at ${clock(date)}`;
}

export const initials = (name) =>
  String(name || '?').split(/[\s._@+-]+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';

// ── Statuses ─────────────────────────────────────────────────────────────

export const CONNECTION_STATUS = Object.freeze({
  reconnect: { label: 'Stopped working', tone: 'bad', rank: 0 },
  connect: { label: 'Not connected', tone: 'warn', rank: 1 },
  ready: { label: 'Connected', tone: 'ok', rank: 2 },
});

export const PLUGIN_STATUS = Object.freeze({
  reconnect: { label: 'Stopped working', tone: 'bad', rank: 0 },
  connect: { label: 'Not connected', tone: 'warn', rank: 1 },
  ready: { label: 'Ready', tone: 'ok', rank: 2 },
  off: { label: 'Off', tone: 'off', rank: 3 },
});

export const MCP_STATUS = Object.freeze({
  bad: { label: 'Not responding', tone: 'bad', rank: 0 },
  unchecked: { label: 'Not checked', tone: 'off', rank: 1 },
  ok: { label: 'Responding', tone: 'ok', rank: 2 },
});

// ── Connections ──────────────────────────────────────────────────────────

const IDENTITY_KEYS = ['email', 'username', 'login', 'name', 'account'];

/** Who a sign-in is signed in as, when its health check says. */
export function identityOf(check) {
  const details = check?.details;
  if (!details || typeof details !== 'object') return null;
  for (const key of IDENTITY_KEYS) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** A failed check, in words someone can act on. */
export function healthProblem(error) {
  const text = String(error || '').trim();
  if (!text) return '';
  if (/valid (access )?token|expired|revoked|invalid_grant|unauthori[sz]ed|\b401\b/i.test(text)) return 'The sign-in expired or was revoked';
  if (/not signed in/i.test(text)) return 'Not signed in on this computer';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** A sign-in this account added for itself: not shared with everyone, not declared by a plugin. */
export function isCustomProvider(entry) {
  if (!entry || entry.pluginProvided || entry.localOnly) return false;
  const shared = ['1', 'true'].includes(lower(entry.is_global ?? entry.isGlobal));
  return !shared && !!(entry.created_by || entry.createdBy || entry.user_id);
}

/**
 * One row per connection: every account card (the sign-ins and keys your
 * plugins use, connected or not) and every connected AI model provider.
 */
export function connectionRows({ cards, catalogue = [], health = [], installed = [] } = {}) {
  const entries = new Map(list(catalogue).map((entry) => [lower(entry.id), entry]));
  const checks = new Map(list(health).filter((check) => check?.provider).map((check) => [lower(check.provider), check]));
  const pluginNames = new Map(list(installed).map((plugin) => [plugin?.name, appDisplayName(plugin)]));

  const row = (card, ai) => {
    const id = lower(card.providerId);
    const entry = entries.get(id) || {};
    const check = checks.get(id) || {};
    const type = lower(card.connectionType);
    const fromPlugin = entry.pluginProvided ? pluginNames.get(entry.plugin) || entry.plugin || card.name : null;
    return {
      id,
      card,
      ai,
      team: false,
      name: card.name,
      appName: card.name,
      icon: brandIcon(id, card.icon, ai ? 'agent' : 'connect'),
      kind: connectionKind(type),
      local: type === 'cli' || !!entry.localOnly,
      fromPlugin,
      custom: isCustomProvider(entry),
      status: card.status,
      identity: identityOf(check),
      problem: card.status === 'reconnect' ? healthProblem(check.error) : '',
      checked: check.lastChecked || null,
      apps: list(card.apps).map((app) => ({ name: app.name, label: app.displayName, icon: pluginIcon(app, { providers: [id] }), tools: app.tools || 0 })),
      suggested: list(card.suggested),
      // Plugin sign-ins live in this install; the health check does not cover them.
      testable: !fromPlugin && card.status !== 'connect',
    };
  };

  return [...accountRows(cards?.yours).map((entry) => row(entry.card, false)), ...list(cards?.models).map((card) => row(card, true))];
}

/** The providers a team connection can be made for, with their icons. */
export function teamProviderOptions(providers, modelIds = new Set()) {
  return list(providers).map(([id, name]) => ({
    id,
    name,
    icon: brandIcon(id, '', id === 'agnt' ? 'agent' : 'connect'),
    ai: modelIds.has(lower(id)),
  }));
}

/** A team's connections as rows: shared with the team, used by its automations. */
export function teamConnectionRows(connections, options = []) {
  const known = new Map(list(options).map((option) => [option.id, option]));
  return list(connections).map((connection) => {
    const option = known.get(connection.providerId) || {};
    return {
      id: `team:${connection.id}`,
      teamConnectionId: connection.id,
      providerId: connection.providerId,
      team: true,
      ai: false,
      name: connection.name || option.name || connection.providerId,
      appName: option.name || titleFromSlug(connection.providerId),
      icon: option.icon || brandIcon(connection.providerId),
      kind: option.ai ? 'Model key' : 'Sign-in',
      local: false,
      fromPlugin: null,
      custom: false,
      status: 'ready',
      identity: null,
      problem: '',
      checked: null,
      apps: [],
      suggested: [],
      // Only GitHub has a check the team server can run.
      testable: connection.providerId === 'github',
    };
  });
}

const HIDDEN_FROM_PICKER = new Set(['agnt', 'local', 'google-login']);

/** Everything Add connection offers: each service once, unconnected first. */
export function catalogueRows({ catalogue = [], connections = [], modelIds = new Set() } = {}) {
  const statusById = new Map(list(connections).filter((row) => !row.team).map((row) => [row.id, row.status]));
  const seen = new Set();
  return list(catalogue)
    .filter((entry) => entry?.id)
    .map((entry) => {
      const id = lower(entry.id);
      const type = lower(entry.connectionType ?? entry.connection_type);
      const status = statusById.get(id) || null;
      return {
        id,
        entry,
        name: String(entry.name || titleFromSlug(id)),
        icon: brandIcon(id, entry.icon),
        kind: connectionKind(type),
        connectionType: type,
        ai: modelIds.has(id),
        local: type === 'cli' || !!entry.localOnly,
        fromPlugin: !!entry.pluginProvided,
        custom: isCustomProvider(entry),
        status: status === 'connect' ? null : status,
      };
    })
    .filter((row) => !HIDDEN_FROM_PICKER.has(row.id) && !seen.has(row.id) && seen.add(row.id))
    .sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready') || byText(a.name, b.name));
}

export const PICKER_TABS = Object.freeze([
  { id: 'all', label: 'All', test: () => true },
  { id: 'open', label: 'Not connected', test: (row) => row.status !== 'ready' },
  { id: 'ai', label: 'AI models', test: (row) => row.ai },
  { id: 'signin', label: 'Sign-ins', test: (row) => !row.ai && row.kind === 'Sign-in' },
  { id: 'apikey', label: 'API keys', test: (row) => !row.ai && row.kind === 'API key' },
]);

// ── Plugins ──────────────────────────────────────────────────────────────

/** Compared by number: 1.10.0 is newer than 1.9.2. */
export function isNewerVersion(candidate, current) {
  const parts = (version) => String(version || '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

/** One row per installed plugin, with the sign-in it uses and whether that works. */
export function pluginRows({ installed = [], available = [], connections = [], catalogue = [], modelIds = new Set() } = {}) {
  const market = new Map(list(available).map((listing) => [listing?.name, listing]));
  const connectionById = new Map(list(connections).filter((row) => !row.team).map((row) => [row.id, row]));
  const entries = new Map(list(catalogue).map((entry) => [lower(entry.id), entry]));
  return list(installed)
    .filter((plugin) => plugin?.name)
    .map((plugin) => {
      const listing = market.get(plugin.name);
      const providerId = lower(primaryProvider(plugin, modelIds).providerId);
      const model = !!providerId && modelIds.has(providerId);
      const connection = providerId ? connectionById.get(providerId) : null;
      const status = plugin.enabled === false ? 'off' : !providerId || model ? 'ready' : connection ? connection.status : 'connect';
      const entry = entries.get(providerId);
      return {
        id: plugin.name,
        plugin,
        label: appDisplayName(plugin),
        desc: String(plugin.description || '').replace(/\s+/g, ' ').trim(),
        icon: pluginIcon(plugin, { providers: pluginProviders(plugin) }),
        version: String(plugin.version || ''),
        update: listing && isNewerVersion(listing.version, plugin.version) ? String(listing.version) : null,
        updated: plugin.updatedAt || plugin.installedAt || null,
        installedAt: plugin.installedAt || null,
        kind: pluginKind({ ...plugin, kind: listing?.kind || plugin.kind }).one,
        trust: trustTier(plugin).label,
        triggers: hasTriggers(plugin),
        contents: compositionOf(pluginInventory(plugin)).map((group) => ({ key: group.key, count: group.count })),
        provider: providerId
          ? { id: providerId, name: connection?.name || entry?.name || titleFromSlug(providerId), icon: brandIcon(providerId, entry?.icon), model }
          : null,
        status,
        author: String(plugin.author || ''),
      };
    });
}

const CONTENT_WORDS = Object.freeze({
  tools: ['tool', 'tools'],
  triggers: ['trigger', 'triggers'],
  agents: ['agent', 'agents'],
  workflows: ['workflow', 'workflows'],
  skills: ['skill', 'skills'],
  widgets: ['widget', 'widgets'],
});

/** "3 tools", "1 trigger": what a plugin put into AGNT, one phrase per kind. */
export const contentPhrases = (contents) =>
  list(contents).map((group) => {
    const words = CONTENT_WORDS[group.key] || [group.key, group.key];
    return `${group.count} ${group.count === 1 ? words[0] : words[1]}`;
  });

export const TRUST_DETAIL = Object.freeze({
  Official: 'Published by AGNT',
  Community: 'Published by someone other than AGNT',
  Unverified: 'Uses capabilities its author has not declared',
  Unaudited: 'Could not be scanned',
});

// ── MCP servers ──────────────────────────────────────────────────────────

/** What a server test answered: reachable or not, and what it said. */
export function mcpTestResult(answer, at = new Date().toISOString()) {
  const ok = !!answer?.success && !!answer?.connected;
  return {
    ok,
    at,
    message: String(answer?.message || answer?.error || (ok ? 'Responding' : 'Not responding')),
    tools: Number.isFinite(answer?.toolCount) ? answer.toolCount : null,
  };
}

export function mcpRows(servers = [], tests = {}) {
  return list(servers)
    .filter((server) => server?.name)
    .map((server) => {
      const transport = lower(server.transport && typeof server.transport === 'object' ? server.transport.type : server.transport) || 'stdio';
      const remote = transport !== 'stdio';
      const test = tests[server.name] || null;
      return {
        id: server.name,
        name: server.name,
        transport,
        remote,
        runs: remote ? 'Remote server' : 'On this computer',
        status: !test ? 'unchecked' : test.ok ? 'ok' : 'bad',
        checked: test?.at || null,
        message: test?.message || '',
        tools: test?.tools ?? null,
      };
    });
}

// ── Email & webhooks ─────────────────────────────────────────────────────

export function triggerRows(webhooks = [], listeners = []) {
  return [
    ...list(listeners).map((listener) => ({
      id: `email:${listener.id}`,
      kind: 'Email',
      workflowId: listener.workflow_id,
      workflow: listener.workflow_name || 'Untitled workflow',
      wfStatus: lower(listener.workflow_status),
      address: String(listener.email_address || ''),
      created: listener.created_at || null,
      updated: listener.updated_at || listener.created_at || null,
    })),
    ...list(webhooks).map((webhook) => ({
      id: `webhook:${webhook.id}`,
      kind: 'Webhook',
      workflowId: webhook.workflow_id,
      workflow: webhook.workflow_name || 'Untitled workflow',
      wfStatus: lower(webhook.workflow_status),
      url: String(webhook.webhook_url || ''),
      method: String(webhook.method || 'POST').toUpperCase(),
      protected: !!webhook.auth_type && lower(webhook.auth_type) !== 'none',
      created: webhook.created_at || null,
      updated: webhook.updated_at || webhook.created_at || null,
    })),
  ];
}

// ── Lists: search, filters, sorting, grouping ────────────────────────────

const rankOf = (statuses) => (a, b) => (statuses[a.status]?.rank ?? 9) - (statuses[b.status]?.rank ?? 9);
const option = (id, label, test) => ({ id, label, test });

const connectionGroup = (row) => {
  if (row.team) return 'Team';
  if (row.custom) return 'Custom apps';
  if (row.ai) return 'AI models';
  if (row.local) return 'On this computer';
  if (row.kind === 'Sign-in') return 'Sign-ins';
  if (row.kind === 'API key') return 'API keys';
  return 'Other';
};
const pluginTotal = (row) => row.contents.reduce((n, group) => n + group.count, 0);
const pluginUses = (row) => (!row.provider ? 'Nothing to connect' : row.provider.model ? 'Your AI model' : row.provider.name);

export const LISTS = Object.freeze({
  connections: {
    search: 'Search connection or app name',
    text: (row) => [row.name, row.appName, row.id, row.identity, row.kind, ...row.apps.map((app) => app.label)].join(' '),
    views: [['flat', 'Connections'], ['status', 'Status'], ['kind', 'Kind']],
    filters: [
      {
        id: 'status',
        label: 'Status',
        options: [
          option('ready', 'Connected', (row) => row.status === 'ready'),
          option('reconnect', 'Stopped working', (row) => row.status === 'reconnect'),
          option('connect', 'Not connected', (row) => row.status === 'connect'),
        ],
      },
      {
        id: 'kind',
        label: 'Kind',
        options: [
          option('signin', 'Sign-in', (row) => row.kind === 'Sign-in' && !row.ai),
          option('apikey', 'API key', (row) => row.kind === 'API key' && !row.ai),
          option('ai', 'AI model', (row) => row.ai),
          option('local', 'On this computer', (row) => row.local),
          option('plugin', 'Plugin sign-in', (row) => !!row.fromPlugin),
          option('custom', 'Custom app', (row) => row.custom),
        ],
      },
    ],
    sorts: {
      name: (a, b) => byText(a.name, b.name),
      app: (a, b) => byText(a.appName, b.appName) || byText(a.kind, b.kind),
      status: rankOf(CONNECTION_STATUS),
      used: (a, b) => (a.ai ? 99 : a.apps.length) - (b.ai ? 99 : b.apps.length),
      checked: (a, b) => time(a.checked) - time(b.checked),
    },
    defaultSort: ['status', 1],
    groups: {
      status: { of: (row) => (row.status === 'ready' ? 'Connected' : 'Needs you'), order: ['Needs you', 'Connected'] },
      kind: { of: connectionGroup, order: ['Team', 'Sign-ins', 'API keys', 'Custom apps', 'AI models', 'On this computer', 'Other'] },
    },
  },
  plugins: {
    search: 'Search plugins and what’s inside',
    text: (row) => [row.label, row.id, row.desc, row.kind, row.provider?.name, row.author].join(' '),
    views: [['flat', 'Plugins'], ['kind', 'Kind'], ['uses', 'Connection']],
    filters: [
      {
        id: 'status',
        label: 'Status',
        options: [
          option('ready', 'Ready', (row) => row.status === 'ready'),
          option('needs', 'Needs you', (row) => row.status === 'reconnect' || row.status === 'connect'),
          option('off', 'Off', (row) => row.status === 'off'),
        ],
      },
      {
        id: 'kind',
        label: 'Kind',
        options: [option('App', 'Apps', (row) => row.kind === 'App'), option('Pack', 'Packs', (row) => row.kind === 'Pack'), option('Utility', 'Utilities', (row) => row.kind === 'Utility')],
      },
      {
        id: 'trust',
        label: 'Published by',
        options: [
          option('Official', 'Official', (row) => row.trust === 'Official'),
          option('Community', 'Community', (row) => row.trust === 'Community'),
          option('Unverified', 'Unverified', (row) => row.trust === 'Unverified' || row.trust === 'Unaudited'),
        ],
      },
      {
        id: 'more',
        label: 'More',
        options: [option('triggers', 'Has triggers', (row) => row.triggers), option('update', 'Update available', (row) => !!row.update)],
      },
    ],
    sorts: {
      name: (a, b) => byText(a.label, b.label),
      uses: (a, b) => byText(a.provider?.name || '~', b.provider?.name || '~'),
      status: rankOf(PLUGIN_STATUS),
      contents: (a, b) => pluginTotal(a) - pluginTotal(b),
      version: (a, b) => String(a.version).localeCompare(String(b.version), undefined, { numeric: true }),
      updated: (a, b) => time(a.updated) - time(b.updated),
    },
    defaultSort: ['status', 1],
    groups: {
      kind: { of: (row) => ({ App: 'Apps', Pack: 'Packs', Utility: 'Utilities' })[row.kind] || 'Utilities', order: ['Apps', 'Packs', 'Utilities'] },
      uses: { of: pluginUses, order: [], last: ['Your AI model', 'Nothing to connect'] },
    },
  },
  mcp: {
    search: 'Search MCP servers',
    text: (row) => [row.name, row.transport, row.runs].join(' '),
    views: [['flat', 'Servers'], ['runs', 'Where it runs']],
    filters: [
      {
        id: 'runs',
        label: 'Runs',
        options: [option('local', 'On this computer', (row) => !row.remote), option('remote', 'Remote server', (row) => row.remote)],
      },
    ],
    sorts: {
      name: (a, b) => byText(a.name, b.name),
      runs: (a, b) => byText(a.runs, b.runs),
      status: rankOf(MCP_STATUS),
    },
    defaultSort: ['name', 1],
    groups: { runs: { of: (row) => row.runs, order: ['On this computer', 'Remote server'] } },
  },
  triggers: {
    search: 'Search workflows, addresses and methods',
    text: (row) => [row.workflow, row.kind, row.address, row.method, row.wfStatus].join(' '),
    views: [['flat', 'Triggers'], ['kind', 'Type'], ['wf', 'Workflow status']],
    filters: [
      { id: 'kind', label: 'Type', options: [option('Email', 'Email', (row) => row.kind === 'Email'), option('Webhook', 'Webhook', (row) => row.kind === 'Webhook')] },
      {
        id: 'wf',
        label: 'Workflow status',
        options: [option('listening', 'Listening', (row) => row.wfStatus === 'listening'), option('stopped', 'Stopped', (row) => row.wfStatus !== 'listening')],
      },
    ],
    sorts: {
      name: (a, b) => byText(a.workflow, b.workflow),
      workflow: (a, b) => byText(a.workflow, b.workflow),
      trigger: (a, b) => byText(a.kind, b.kind),
      wf: (a, b) => byText(a.wfStatus, b.wfStatus),
      created: (a, b) => time(a.created) - time(b.created),
      updated: (a, b) => time(a.updated) - time(b.updated),
    },
    defaultSort: ['updated', -1],
    groups: {
      kind: { of: (row) => (row.kind === 'Email' ? 'Email' : 'Webhooks'), order: ['Email', 'Webhooks'] },
      wf: { of: (row) => (row.wfStatus === 'listening' ? 'Listening' : 'Stopped'), order: ['Listening', 'Stopped'] },
    },
  },
});

/**
 * A list's rows after its search, filters and sort. Within a facet the chosen
 * options are alternatives (any); across facets they all apply.
 */
export function visibleRows(rows, spec, { q = '', chosen = {}, sort = spec.defaultSort } = {}) {
  const query = lower(q);
  let out = list(rows).filter((row) => !query || lower(spec.text(row)).includes(query));
  for (const facet of spec.filters) {
    const picked = chosen[facet.id];
    if (!picked || !picked.size) continue;
    const tests = facet.options.filter((choice) => picked.has(choice.id)).map((choice) => choice.test);
    out = out.filter((row) => tests.some((test) => test(row)));
  }
  const [key, direction] = sort && spec.sorts[sort[0]] ? sort : spec.defaultSort;
  const compare = spec.sorts[key];
  const byName = spec.sorts.name;
  return out.slice().sort((a, b) => compare(a, b) * direction || byName(a, b));
}

/** Rows under headings: the group's order first, then any others by name, then its `last`. */
export function groupRows(rows, group) {
  const byGroup = new Map();
  for (const row of list(rows)) {
    const label = group.of(row);
    if (!byGroup.has(label)) byGroup.set(label, []);
    byGroup.get(label).push(row);
  }
  const order = list(group.order);
  const last = list(group.last);
  const known = order.filter((label) => byGroup.has(label));
  const others = [...byGroup.keys()].filter((label) => !order.includes(label) && !last.includes(label)).sort(byText);
  const tail = last.filter((label) => byGroup.has(label));
  return [...known, ...others, ...tail].map((label) => ({ label, rows: byGroup.get(label) }));
}

// ── Custom apps ──────────────────────────────────────────────────────────

export const CUSTOM_NAME_MAX = 60;

/** What stops a custom app from being added, field by field. */
export function customAppErrors(form, catalogue = []) {
  const errors = {};
  const name = String(form?.name || '').trim();
  if (!name) errors.name = 'Enter the app’s name';
  else if (name.length > CUSTOM_NAME_MAX) errors.name = `Keep the name under ${CUSTOM_NAME_MAX} characters`;
  else if (list(catalogue).some((entry) => lower(entry?.name) === lower(name))) errors.name = `${name} is already in the list. Connect it from there.`;
  if (!String(form?.key || '').trim()) errors.key = 'Paste the API key';
  return errors;
}

/** A catalogue id for a custom app: readable from its name, unused by anything listed, made unique by `suffix`. */
export function customProviderId(name, takenIds = [], suffix = '') {
  const slug =
    lower(name)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'app';
  const base = suffix ? `custom-${slug}-${lower(suffix)}` : `custom-${slug}`;
  const taken = new Set(list([...takenIds]).map(lower));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Four random letters and digits, for customProviderId. */
export const randomSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** The catalogue entry a custom API-key app is created with. */
export function customProviderData(form, id) {
  const name = String(form?.name || '').trim();
  const where = String(form?.where || '').trim();
  return {
    id,
    name,
    icon: 'custom',
    categories: ['Custom'],
    connectionType: 'apikey',
    instructions: where || `Paste your ${name} API key.`,
    customPrompt: '',
  };
}

/** "1 needs you", "2 need you". */
export const needYou = (n) => `${n} ${n === 1 ? 'needs' : 'need'} you`;
