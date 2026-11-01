/**
 * The Apps page's "For you" tab, as pure functions over data the page already has:
 * catalog rows (studioCatalog), sign-in cards (buildAppCards yours + discover) and the
 * connected sign-in ids.
 *
 * The journey it encodes: connect the apps you use first (one sign-in per family, e.g. one Google
 * sign-in covers Gmail, Calendar, Drive...), then the packs and utilities those connections make
 * ready. A pack "needs" the sign-ins its own tools declare (pluginProviders), so no new manifest
 * field is required.
 */
import { pluginProviders } from './appCards.js';
import { pluginKind } from './pluginDirectory.js';
import { pluginIcon, providerIcon } from './brandIcons.js';

const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const lower = (v) => String(v || '').trim().toLowerCase();

/** Families every new user is most likely to have, shown first in this order. */
const POPULAR = ['google', 'slack', 'notion', 'microsoft365', 'hubspot', 'github', 'clickup'];

/**
 * Default asks for a connected sign-in, used only when none of its plugins declares `examples`.
 * Each is real work on the user's own data, the kind of thing that saves an hour the first time.
 */
export const DEFAULT_ASKS = Object.freeze({
  google: [
    { text: 'Draft replies to my most important unread emails', icon: 'gmail-color' },
    { text: 'Plan my day from my calendar and inbox', icon: 'google-calendar' },
    { text: 'Turn my latest meeting notes into a Google Doc with action items', icon: 'google-docs' },
  ],
  slack: [{ text: 'Summarize what I missed in Slack today and draft my replies' }],
  notion: [{ text: 'Turn this week’s notes into a clean Notion page with next steps' }],
  hubspot: [{ text: 'Which of my HubSpot deals are most likely to close this month, and what should I do next?' }],
  github: [{ text: 'Summarize my open pull requests and what needs my review' }],
  clickup: [{ text: 'Plan my week from my ClickUp tasks, most urgent first' }],
  microsoft365: [{ text: 'Draft replies to my most important unread Outlook emails' }],
});

/** Asks that need nothing connected: what Annie does on her own, on the user's business. */
export const CORE_ASKS = Object.freeze([
  { text: 'Build a one-page website for my business', icon: 'web' },
  { text: 'Research my top 3 competitors and compare them in a table', icon: 'table' },
  { text: 'Turn my idea into a step-by-step launch plan', icon: 'magic' },
  { text: 'Write a week of social posts for my business', icon: 'create' },
]);

/** The sign-ins a row needs (its tools' authProvider), model providers excluded. */
export function needs(row, modelIds = new Set()) {
  return pluginProviders(row).filter((id) => !modelIds.has(id));
}

/**
 * Sign-in families: account cards that at least one Market plugin uses, connected or not. A credential
 * nothing on the Market uses (a custom API, an admin key) belongs on Accounts & keys, not here.
 * Popular ones first, Google leading.
 */
export function families({ cards = {}, rows = [], connected = new Set(), modelIds = new Set() } = {}) {
  // Only what anyone can get counts: a private plugin's sign-in (an admin tool) is not an app family.
  const usersOf = new Map();
  // Only official plugins make a sign-in worth featuring; a community plugin's sign-in is not.
  const listed = (r) => isOfficial(r) && (r.onMarket === true || (!r.installed && r.onMarket !== false));
  for (const row of list(rows).filter(listed)) for (const id of needs(row, modelIds)) {
    if (!usersOf.has(id)) usersOf.set(id, []);
    usersOf.get(id).push(row);
  }
  const accounts = [...list(cards.yours), ...list(cards.discover)]
    .filter((card) => card.kind === 'account' && card.providerId && !modelIds.has(lower(card.providerId)))
    .filter((card, i, all) => all.findIndex((c) => c.providerId === card.providerId) === i)
    .filter((card) => usersOf.has(lower(card.providerId)));
  const rank = (id) => { const i = POPULAR.indexOf(id); return i === -1 ? POPULAR.length : i; };
  return accounts.map((card) => {
    const id = lower(card.providerId);
    const users = usersOf.get(id) || [];
    const apps = users.filter((r) => pluginKind(r).id === 'app');
    return {
      id, card, name: card.name,
      icon: providerIcon(id, card.icon) || pluginIcon(apps[0] || {}, { providers: [id] }),
      connected: connected.has(id),
      status: card.status,
      apps: apps.map((r) => ({ name: r.name, displayName: r.displayName, icon: pluginIcon(r, { providers: [id] }), installed: !!r.installed })),
      toInstall: list(card.suggested),
    };
  }).sort((a, b) => rank(a.id) - rank(b.id) || b.apps.length - a.apps.length || a.name.localeCompare(b.name));
}

/**
 * For you promotes only what AGNT publishes and vets (trust tier official). Community plugins are
 * never featured here; they stay in Browse, labelled Community.
 */
export const isOfficial = (row) => lower(row?.trustTier) === 'official';

/** Official packs and utilities with what they need and whether it is all connected. Ready first. */
export function shelf({ rows = [], connected = new Set(), modelIds = new Set() } = {}) {
  return list(rows)
    .filter((r) => isOfficial(r) && ['pack', 'utility'].includes(pluginKind(r).id))
    .map((r) => {
      const requires = needs(r, modelIds);
      const missing = requires.filter((id) => !connected.has(id));
      return { row: r, kind: pluginKind(r), requires, missing, ready: missing.length === 0, icon: pluginIcon(r, { providers: requires }) };
    })
    .sort((a, b) => Number(b.ready) - Number(a.ready)
      || Number(lower(b.row.trustTier) === 'official') - Number(lower(a.row.trustTier) === 'official')
      || b.requires.length - a.requires.length
      || Number(b.kind.id === 'pack') - Number(a.kind.id === 'pack')
      || String(a.row.displayName).localeCompare(String(b.row.displayName)));
}

/** How many packs connecting `id` would make ready now (packs that also need another missing app don't count). */
export function unlocks(id, items, connected = new Set()) {
  return list(items).filter((s) => s.requires.includes(id) && s.requires.every((r) => r === id || connected.has(r))).length;
}

/**
 * Asks to show.
 *   forApps  for each connected sign-in (popular first): the `examples` its plugins declare
 *            (installed plugins first), else DEFAULT_ASKS for that sign-in.
 *   noSetup  CORE_ASKS: Annie on her own, nothing to connect.
 */
export function asks({ connected = new Set(), rows = [], modelIds = new Set() } = {}) {
  const rank = (id) => { const i = POPULAR.indexOf(id); return i === -1 ? POPULAR.length : i; };
  const seen = new Set();
  const once = (ask) => { const k = ask.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; };
  // Suggestions are words we put in front of users: only from official plugins.
  const withExamples = list(rows).filter((r) => isOfficial(r) && list(r.examples).length)
    .sort((a, b) => Number(!!b.installed) - Number(!!a.installed));
  const forApps = [...connected].sort((a, b) => rank(a) - rank(b)).flatMap((id) => {
    const declared = withExamples.filter((r) => needs(r, modelIds).includes(id))
      .flatMap((r) => list(r.examples).map((text) => ({ text, provider: id, plugin: r.name, displayName: r.displayName, icon: pluginIcon(r, { providers: [id] }) })));
    const fallback = list(DEFAULT_ASKS[id]).map((ask) => ({ text: ask.text, provider: id, icon: ask.icon || providerIcon(id) || 'puzzle-piece' }));
    return (declared.length ? declared : fallback).filter(once).slice(0, 3);
  });
  return { forApps, noSetup: CORE_ASKS.map((ask) => ({ ...ask })).filter(once) };
}

/** The one thing to do next: connect the top family, else add the first ready pack that needs a connection. */
export function nextStep({ families: fams = [], items = [], connected = new Set() } = {}) {
  if (!connected.size) { const lead = fams.find((f) => !f.connected); return lead ? { type: 'connect', family: lead } : null; }
  // Prefer a pack your connections made possible; else any ready pack you don't have yet.
  const open = list(items).filter((s) => s.ready && !s.row.installed && s.kind.id === 'pack');
  const pack = open.find((s) => s.requires.length) || open[0];
  return pack ? { type: 'install', item: pack } : null;
}
