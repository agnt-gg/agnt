/**
 * pluginDirectory — what the Plugins page says about a plugin, derived from
 * data AGNT already has. Pure: rows in, view model out. Both shells render the
 * page from AppsSection, so this is the single place that decides what a
 * plugin "contains", what access it declares and which cards need attention.
 *
 * Inputs are the existing payloads, read as they are:
 *   • /plugins/installed and /plugins/marketplace rows: manifest `tools`
 *     (schema.category 'trigger' marks a trigger; an operation-style parameter
 *     lists what a tool can do), catalog `agents|workflows|skills|widgets`,
 *     `permissions` ({ capabilities, domains } or the legacy array),
 *     trust fields (trustTier, integrityState, grantedPermissions,
 *     declaredPermissions, detectedCapabilities), `updatePolicy`.
 *   • services/appCards.js cards for the sign-in grouping.
 *   • /plugins/update-status for updates refused pending consent.
 *   • agents (`toolAccessMode`, `assignedTools`) for who can use a plugin.
 */
import { APP_STATUS } from './appCards.js';
import { pluginContents, titleFromSlug } from './studioApps.js';

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const text = (value) => (typeof value === 'string' ? value : '');
const lower = (value) => String(value ?? '').trim().toLowerCase();

/** The validator's complete capability vocabulary (backend/plugins/docs/PLUGIN-REFERENCE.md §2), in plain words. */
export const CAPABILITIES = Object.freeze({
  network: { icon: 'globe', label: 'Connects to the internet' },
  filesystem: { icon: 'file', label: 'Reads and writes files on this computer' },
  'env-access': { icon: 'env', label: 'Reads environment variables' },
  'spawn-process': { icon: 'terminal', label: 'Runs other programs' },
  'dynamic-eval': { icon: 'code', label: 'Runs code it generates' },
  'dynamic-import': { icon: 'code', label: 'Loads code while it runs' },
});
const CAPABILITY_ORDER = Object.keys(CAPABILITIES);

export function capabilityLabel(id) {
  return CAPABILITIES[id]?.label || `Uses ${titleFromSlug(id).toLowerCase() || 'an unknown capability'}`;
}

/** Trust tiers in the words Plugins.vue already uses; no backend jargon ("tofu") reaches the page. */
export const TRUST_TIERS = Object.freeze({
  official: { label: 'Official', detail: 'Built and maintained by AGNT' },
  community: { label: 'Community', detail: 'Verified, and every capability is declared' },
  unverified: { label: 'Unverified', detail: 'Uses capabilities its author has not declared' },
  unaudited: { label: 'Unaudited', detail: 'Could not be scanned' },
});

export function trustTier(plugin) {
  const tier = lower(plugin?.trustTier);
  return TRUST_TIERS[tier] ? { id: tier, ...TRUST_TIERS[tier] } : null;
}

export function integrityLabel(state) {
  if (state === 'verified') return 'Matches its marketplace record';
  if (state === 'tofu') return 'Fingerprint saved on first use, so later tampering is caught';
  if (state === 'mismatch') return 'Does not match its marketplace record';
  return '';
}

/** "SEND_MESSAGE" → "Send message", "getDatabases" → "Get databases". */
export function humanize(value) {
  const words = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

const schemaOf = (tool) => (tool && typeof tool.schema === 'object' && tool.schema) || tool || {};
export const isTrigger = (tool) => lower(schemaOf(tool).category ?? tool?.category) === 'trigger';
const OPERATION_PARAM = /^(operation|action|op|method|event|trigger|command)$/i;

/** What a tool can be asked to do, from its operation-style parameter. Empty when it does one thing. */
export function toolOperations(tool) {
  const params = schemaOf(tool).parameters;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  const entries = Object.entries(params);
  const pick = entries.find(([name, def]) => OPERATION_PARAM.test(name) && Array.isArray(def?.options ?? def?.enum))
    || entries.find(([name, def]) => /operation|action/i.test(name) && Array.isArray(def?.options ?? def?.enum));
  if (!pick) return [];
  const options = pick[1].options ?? pick[1].enum;
  const labels = options
    .map((option) => (option && typeof option === 'object' ? option.label || option.title || option.value || option.name : option))
    .map(humanize)
    .filter(Boolean);
  return [...new Set(labels)];
}

const toolName = (tool) => text(schemaOf(tool).title) || text(tool?.title) || titleFromSlug(tool?.type || tool?.name) || 'Tool';
const toolItem = (tool) => ({ id: String(tool?.type || tool?.name || toolName(tool)), name: toolName(tool), description: text(schemaOf(tool).description), operations: toolOperations(tool) });

export const INVENTORY_GROUPS = Object.freeze([
  { key: 'tools', label: 'Tools', one: 'tool', icon: 'tool' },
  { key: 'triggers', label: 'Triggers', one: 'trigger', icon: 'trigger' },
  { key: 'agents', label: 'Agents', one: 'agent', icon: 'agent' },
  { key: 'workflows', label: 'Workflows', one: 'workflow', icon: 'flow' },
  { key: 'skills', label: 'Skills', one: 'skill', icon: 'book' },
  { key: 'widgets', label: 'Widgets', one: 'widget', icon: 'grid' },
]);

/**
 * Everything a plugin brings, grouped. `assets` (from /plugins/:name/assets)
 * links installed agents/widgets/… to their local ids, as studioApps does.
 * Every group is returned, empty or not, so callers choose what to show.
 */
export function pluginInventory(plugin = {}, assets = []) {
  const tools = list(plugin.tools);
  const contents = new Map(pluginContents(plugin, assets).map((group) => [group.key, group]));
  return INVENTORY_GROUPS.map((group) => {
    if (group.key === 'tools') return { ...group, items: tools.filter((t) => !isTrigger(t)).map(toolItem), known: Array.isArray(plugin.tools) };
    if (group.key === 'triggers') return { ...group, items: tools.filter(isTrigger).map(toolItem), known: Array.isArray(plugin.tools) };
    const existing = contents.get(group.key);
    return { ...group, items: existing?.items || [], known: !!existing?.known };
  });
}

/** "1 tool · 7 operations", "2 agents" — non-empty groups only, for rows and the install sheet. */
export function compositionOf(inventory, { operations = false } = {}) {
  return list(inventory)
    .filter((group) => group.items.length)
    .map((group) => {
      const n = group.items.length;
      let label = `${n} ${n === 1 ? group.one : group.label.toLowerCase()}`;
      if (operations && group.key === 'tools') {
        const ops = group.items.reduce((total, item) => total + item.operations.length, 0);
        if (ops) label += ` · ${ops} operations`;
      }
      return { key: group.key, icon: group.icon, count: n, label };
    });
}

export const isPack = (plugin) => ['agents', 'workflows', 'skills', 'widgets'].some((key) => list(plugin?.[key]).length > 0);
export const hasTriggers = (plugin) => list(plugin?.tools).some(isTrigger);

function parsePermissions(value) {
  if (typeof value === 'string') {
    try { return parsePermissions(JSON.parse(value)); } catch { return { capabilities: [], domains: [] }; }
  }
  if (Array.isArray(value)) return { capabilities: value.map(String), domains: [] };
  if (value && typeof value === 'object') return { capabilities: list(value.capabilities).map(String), domains: list(value.domains).map(String) };
  return { capabilities: [], domains: [] };
}
const byVocabulary = (ids) => [...new Set(ids)].sort((a, b) => {
  const ia = CAPABILITY_ORDER.indexOf(a), ib = CAPABILITY_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});

/**
 * The access a plugin declares and what the scan found. For an installed
 * plugin `grantedPermissions` is what AGNT actually granted (declared ∪
 * detected); for a listing, `declaredPermissions` is the publisher's word.
 * `undeclared` = detected but not declared — what makes a tier "Unverified".
 */
export function declaredAccess(plugin = {}) {
  const manifest = parsePermissions(plugin.permissions);
  const declared = byVocabulary([...manifest.capabilities, ...list(plugin.declaredPermissions).map(String)]);
  const detected = byVocabulary(list(plugin.detectedCapabilities).map(String));
  const granted = byVocabulary(list(plugin.grantedPermissions).map(String));
  const capabilities = byVocabulary([...declared, ...granted, ...detected]);
  return {
    capabilities,
    domains: [...new Set(manifest.domains)],
    undeclared: detected.filter((id) => !declared.includes(id)),
    known: plugin.permissions != null || declared.length > 0 || detected.length > 0 || granted.length > 0,
  };
}

/** Updates the background pass refused because they ask for new access: name → { added }. Installed plugins only. */
export function reviewNotices(status, installedNames = []) {
  const installed = new Set(list(installedNames).map(lower));
  const notices = new Map();
  for (const entry of list(status?.blockedOnConsent)) {
    if (!entry?.name || !installed.has(lower(entry.name))) continue;
    notices.set(String(entry.name), { added: list(entry.permissionDiff?.added).map(String) });
  }
  return notices;
}

/** Plugin tool ids as agents store them: the manifest type with dashes as underscores (ToolsRoutes /orchestrator-tools). */
export function pluginToolIds(plugin) {
  const ids = new Set();
  for (const tool of list(plugin?.tools)) {
    const type = String(tool?.type || '');
    if (!type) continue;
    ids.add(type);
    ids.add(type.replace(/-/g, '_'));
  }
  return ids;
}

/**
 * Who can use a plugin's tools. Agents with Open tool access get every
 * installed tool; restricted agents only what they were given.
 */
export function agentAccess(agents, plugin) {
  const ids = pluginToolIds(plugin);
  const all = list(agents);
  return {
    openCount: all.filter((agent) => agent.toolAccessMode === 'open').length,
    restricted: all
      .filter((agent) => agent.toolAccessMode !== 'open' && list(agent.assignedTools).some((id) => ids.has(String(id))))
      .map((agent) => ({ id: String(agent.id ?? agent.name), name: text(agent.name) || 'Agent' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Lower-cased text a search box can match: names, descriptions, contents, every tool operation. */
export function searchTextOf(plugin = {}) {
  const parts = [plugin.name, plugin.displayName, plugin.description, plugin.category, plugin.author, plugin.authorName];
  for (const group of pluginInventory(plugin)) {
    for (const item of group.items) parts.push(item.name, ...(item.operations || []));
  }
  return parts.filter((part) => typeof part === 'string').join(' ').toLowerCase();
}

export function matchesQuery(plugin, query) {
  const terms = lower(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = searchTextOf(plugin);
  return terms.every((term) => haystack.includes(term));
}

/** A card needs you when its sign-in is missing or failing, or one of its plugins has an update waiting on consent. */
export function cardNeedsYou(card, notices = new Map()) {
  if (card?.status === APP_STATUS.RECONNECT || card?.status === APP_STATUS.CONNECT) return true;
  return list(card?.apps).some((app) => notices.has(app.name));
}

export function installedSections(cards, notices = new Map()) {
  const needsYou = [], ready = [];
  for (const card of list(cards)) (cardNeedsYou(card, notices) ? needsYou : ready).push(card);
  return { needsYou, ready };
}

export function connectionKind(connectionType) {
  const type = lower(connectionType);
  if (type === 'oauth') return 'Sign-in';
  if (type === 'apikey') return 'API key';
  if (type === 'cli') return 'On this computer';
  return 'Connection';
}

/**
 * One row per sign-in on the Accounts tab: account cards from appCards.
 * App cards that bill through an AI model key are Settings' business.
 */
export function accountRows(cards) {
  return list(cards)
    .filter((card) => card.kind === 'account' && card.providerId)
    .map((card) => ({
      id: card.providerId,
      card,
      name: card.name,
      icon: card.icon,
      kind: connectionKind(card.connectionType),
      connectionType: lower(card.connectionType),
      status: card.status,
      apps: list(card.apps),
    }));
}

/**
 * Plugins this person made, as the Forge's own library counts them
 * (Plugins.vue myBuildPlugins): built in the Forge here, or published by them.
 */
export function builtByMe({ installed = [], builtNames = [], published = [] } = {}) {
  const built = new Set(list(builtNames).map(String));
  const listings = list(published).filter((item) => item.asset_type === 'plugin');
  return list(installed)
    .filter((row) => row?.name && (built.has(row.name) || listings.some((item) => item.asset_id === row.name)))
    .map((row) => ({ row, listing: listings.find((item) => item.asset_id === row.name) || null }));
}

export function priceLabel(plugin) {
  const amount = Number(plugin?.price);
  return Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount) : '';
}

/**
 * The app sign-ins a plugin needs that are already connected. A listing is
 * "ready with your sign-in" only when every app sign-in it declares is there.
 */
export function signInReadiness(plugin, connectedIds = [], modelIds = []) {
  const connected = new Set(list(connectedIds).map(lower));
  const models = new Set(list(modelIds).map(lower));
  const providers = [];
  for (const tool of list(plugin?.tools)) {
    const id = lower(schemaOf(tool).authProvider ?? tool?.authProvider);
    if (id && !models.has(id) && !providers.includes(id)) providers.push(id);
  }
  return { providers, ready: providers.length > 0 && providers.every((id) => connected.has(id)) };
}
