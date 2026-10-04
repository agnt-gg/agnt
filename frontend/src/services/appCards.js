/**
 * appCards — one card per thing a person connects.
 *
 * AGNT stores two separate things that people experience as one: a PLUGIN
 * (code installed into AGNT: tools, agents, workflows, widgets, skills) and a
 * SIGN-IN (an OAuth token or API key in the vault). Every plugin tool already
 * declares which sign-in it uses (`schema.authProvider`), so the two can be
 * joined without asking anyone to declare anything new:
 *
 *   • plugins that share a sign-in become ONE card — connect Google once and
 *     Gmail, Sheets, Drive, Docs, Slides, Calendar, Meet and YouTube are on;
 *   • a plugin with no sign-in is its own card and is ready when installed;
 *   • a sign-in with no plugin (Stripe used through Custom API) is still a
 *     card, because it is still something you connected.
 *
 * AI model providers are NOT apps — "which model Annie thinks with" lives in
 * Settings › AI Models. A plugin that bills through one (Seedance via
 * OpenRouter) keeps a card of its own named after the plugin, never after the
 * model provider, so the Apps page never turns into a model list.
 *
 * Pure: data in, cards out. Both shells render from this (Studio's Apps view
 * and Focused's Apps page), so they cannot disagree about what a card holds.
 *
 * The model-provider ids are an INPUT (`aiProviderIds`) rather than an import:
 * the registry lives in store/app/aiProvider.js, which touches localStorage
 * the moment it loads. Callers already have the store; this module stays free
 * of it and is tested without a browser.
 */
import { matches } from '@/canvas/jumpIndex.js';

/** Always model-side, whatever the registry says: AGNT's own account and local models. */
const ALWAYS_MODEL_IDS = ['agnt', 'local'];

function modelProviderSet(aiProviderIds) {
  return new Set([...(Array.isArray(aiProviderIds) ? aiProviderIds : []), ...ALWAYS_MODEL_IDS].map((id) => String(id).toLowerCase()));
}

/** Card states, in the order a person should deal with them. */
export const APP_STATUS = Object.freeze({ RECONNECT: 'reconnect', CONNECT: 'connect', READY: 'ready' });
const STATUS_RANK = { reconnect: 0, connect: 1, ready: 2 };

const key = (value) => String(value ?? '').trim().toLowerCase();
const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

/** The catalogue is snake_case remotely and camelCase locally; read both. */
function connectionTypeOf(provider) {
  return String(provider?.connectionType || provider?.connection_type || '');
}

/** Every distinct sign-in a plugin's tools declare, in declaration order. */
export function pluginProviders(plugin) {
  const seen = [];
  for (const tool of list(plugin?.tools)) {
    const id = key(tool?.schema?.authProvider ?? tool?.authProvider);
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

/**
 * The sign-in a plugin's card hangs off: its first app sign-in, else the model
 * key it bills through, else none. `grouped` says whether the card is shared
 * with other plugins (app sign-ins only).
 */
export function primaryProvider(plugin, modelIds = modelProviderSet()) {
  const providers = pluginProviders(plugin);
  const app = providers.find((id) => !modelIds.has(id));
  if (app) return { providerId: app, grouped: true };
  if (providers.length) return { providerId: providers[0], grouped: false };
  return { providerId: null, grouped: false };
}

function prettyId(id) {
  return String(id || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(plugin|api)\b/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Plaid Plugin" → "Plaid": the word is never shown to people (it is an App). */
export function appDisplayName(plugin) {
  const raw = String(plugin?.displayName || prettyId(plugin?.name) || plugin?.name || '').trim();
  return raw.replace(/\s+plugin$/i, '').trim() || raw;
}

function pluginSummary(plugin, contentsByPlugin) {
  const extra = contentsByPlugin.get(key(plugin.name)) || {};
  return {
    name: String(plugin.name),
    displayName: appDisplayName(plugin),
    description: String(plugin.description || ''),
    icon: typeof plugin.icon === 'string' ? plugin.icon : '',
    tools: list(plugin.tools).length,
    widgets: list(extra.widgets),
    skills: list(extra.skills),
  };
}

/** widgets/skills carry `source_plugin`; index them by the plugin that shipped them. */
function indexContents(widgets, skills) {
  const byPlugin = new Map();
  const add = (kind, item) => {
    const owner = key(item?.source_plugin ?? item?.sourcePlugin);
    if (!owner) return;
    if (!byPlugin.has(owner)) byPlugin.set(owner, { widgets: [], skills: [] });
    byPlugin.get(owner)[kind].push({ id: String(item.id ?? item.name), name: String(item.name || item.title || item.id) });
  };
  list(widgets).forEach((w) => add('widgets', w));
  list(skills).forEach((s) => add('skills', s));
  return byPlugin;
}

/**
 * Marketplace plugins not installed yet that use this sign-in. A declared
 * `authProvider` is authoritative; a tag is a hint (45 of 48 installed plugins
 * agree with their tags), which is why these are offered, never installed
 * without a click.
 */
export function suggestedPlugins(available, installedNames, providerId) {
  const id = key(providerId);
  if (!id) return [];
  return list(available)
    .filter((p) => p?.name && !installedNames.has(key(p.name)))
    .filter((p) => pluginProviders(p).includes(id) || list(p.tags).map(key).includes(id))
    .map((p) => ({ name: String(p.name), displayName: appDisplayName(p) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function statusFor(providerId, connected, unhealthy) {
  if (!providerId) return APP_STATUS.READY;
  if (!connected.has(providerId)) return APP_STATUS.CONNECT;
  return unhealthy.has(providerId) ? APP_STATUS.RECONNECT : APP_STATUS.READY;
}

/**
 * @param {object} input
 * @param {Array}  input.installed    /plugins/installed rows (tools carry schema.authProvider)
 * @param {Array}  input.catalogue    appAuth.allProviders (names, icons, how each connects)
 * @param {Array}  input.connectedApps provider ids with a stored credential
 * @param {Array}  input.health       appAuth.connectionHealth.providers ({ provider, status })
 * @param {Array}  [input.available]  /plugins/marketplace rows, for suggestions
 * @param {Array}  [input.widgets]    widget definitions (source_plugin)
 * @param {Array}  [input.skills]     skills (source_plugin)
 * @param {Array}  [input.aiProviderIds] model-provider ids (AI_PROVIDERS_WITH_API)
 * @param {string} [query]
 * @returns {{ yours: Card[], discover: Card[] }}
 */
export function buildAppCards({ installed, catalogue, connectedApps, health, available, widgets, skills, aiProviderIds } = {}, query = '') {
  const modelIds = modelProviderSet(aiProviderIds);
  const connected = new Set(list(connectedApps).map(key));
  const unhealthy = new Set(list(health).filter((h) => h?.status === 'error').map((h) => key(h.provider)));
  const catalogueById = new Map(list(catalogue).map((p) => [key(p.id), p]));
  const installedNames = new Set(list(installed).map((p) => key(p.name)));
  const contentsByPlugin = indexContents(widgets, skills);

  const cards = new Map();
  const cardFor = (id, seed) => {
    if (!cards.has(id)) cards.set(id, { ...seed, apps: [] });
    return cards.get(id);
  };
  const accountCard = (providerId) => {
    const entry = catalogueById.get(providerId) || {};
    return {
      id: providerId,
      kind: 'account',
      providerId,
      name: String(entry.name || prettyId(providerId)),
      icon: typeof entry.icon === 'string' ? entry.icon : '',
      description: String(entry.instructions || entry.custom_prompt || ''),
      connectionType: connectionTypeOf(entry),
    };
  };

  for (const plugin of list(installed)) {
    if (!plugin?.name) continue;
    const summary = pluginSummary(plugin, contentsByPlugin);
    const { providerId, grouped } = primaryProvider(plugin, modelIds);
    if (grouped) {
      cardFor(providerId, accountCard(providerId)).apps.push(summary);
    } else {
      const card = cardFor(`app:${key(plugin.name)}`, {
        id: `app:${key(plugin.name)}`,
        kind: 'app',
        providerId,
        name: summary.displayName,
        icon: summary.icon,
        description: summary.description,
        connectionType: providerId ? connectionTypeOf(catalogueById.get(providerId)) : '',
        // Bills through a model provider: connected in Settings › AI Models.
        usesModelKey: !!providerId,
      });
      card.apps.push(summary);
    }
  }

  // A sign-in with no plugin is still yours (Stripe through Custom API).
  for (const id of connected) {
    if (!modelIds.has(id) && !cards.has(id)) cardFor(id, accountCard(id));
  }

  const finish = (card) => {
    const apps = card.apps.sort((a, b) => a.displayName.localeCompare(b.displayName));
    // A one-plugin account card reads as the plugin when the catalogue has no name for it.
    const name = card.kind === 'account' && apps.length === 1 && !catalogueById.has(card.providerId) ? apps[0].displayName : card.name;
    return {
      ...card,
      name,
      icon: card.icon || apps[0]?.icon || '',
      description: card.description || (apps.length === 1 ? apps[0].description : ''),
      apps,
      status: statusFor(card.providerId, connected, unhealthy),
      counts: {
        tools: apps.reduce((n, a) => n + a.tools, 0),
        widgets: apps.reduce((n, a) => n + a.widgets.length, 0),
        skills: apps.reduce((n, a) => n + a.skills.length, 0),
      },
      suggested: card.kind === 'account' ? suggestedPlugins(available, installedNames, card.providerId) : [],
    };
  };

  const yours = [...cards.values()].map(finish);

  // Discover: services you could connect that are not yours yet. Model
  // providers and on-this-computer CLIs are Settings' business.
  const discover = list(catalogue)
    .map((p) => key(p.id))
    .filter((id) => id && !cards.has(id) && !modelIds.has(id) && connectionTypeOf(catalogueById.get(id)) !== 'cli')
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => finish({ ...accountCard(id), apps: [] }));

  const visible = (card) =>
    matches(query, card.name, card.providerId || '', card.description, ...card.apps.map((a) => a.displayName));
  const byAttentionThenName = (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  return {
    yours: yours.filter(visible).sort(byAttentionThenName),
    discover: discover.filter(visible).sort(byName),
  };
}

/** One card by id ('google', 'app:figma-bridge'), searched across both lists. */
export function findAppCard(cards, id) {
  const wanted = key(id);
  return [...(cards?.yours || []), ...(cards?.discover || [])].find((card) => key(card.id) === wanted) || null;
}

/** "Gmail, Sheets and 6 more" — the apps a disconnect would stop. */
export function describeApps(card, max = 3) {
  const names = list(card?.apps).map((a) => a.displayName);
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
