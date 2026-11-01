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

/** Asks that become possible once a sign-in is connected. */
export const ASKS = Object.freeze({
  google: [{ text: 'Summarize my unread email from today', icon: 'gmail' }, { text: 'What’s on my calendar tomorrow?', icon: 'google-calendar' }, { text: 'Turn last week’s notes into a Google Doc', icon: 'google-docs' }],
  slack: ['Post today’s summary in Slack', 'What did I miss in Slack today?'],
  notion: ['Turn this chat into a Notion page', 'Find our onboarding doc in Notion'],
  hubspot: ['List my open HubSpot deals closing this month'],
  github: ['List my open GitHub pull requests'],
  clickup: ['What’s due this week in ClickUp?'],
  microsoft365: ['Summarize my unread Outlook email'],
});

/** Utilities that work with nothing connected, and an ask for each. */
export const NO_SETUP_ASKS = Object.freeze({
  sentinel: 'Scan agnt.gg for security issues',
  'agnt-autoresearch': 'Research the top AI agent tools',
  'fs-watcher-plugin': 'Watch my Downloads folder for new PDFs',
  'calculator-plugin': 'What’s 18% of $2,450?',
});

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
  const usersOf = new Map();
  for (const row of list(rows)) for (const id of needs(row, modelIds)) {
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

/** Packs and utilities with what they need and whether it is all connected. Ready first, AGNT's first. */
export function shelf({ rows = [], connected = new Set(), modelIds = new Set() } = {}) {
  return list(rows)
    .filter((r) => ['pack', 'utility'].includes(pluginKind(r).id))
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

/** Asks to show: those for connected sign-ins, then no-setup ones for utilities on the Market. */
export function asks({ connected = new Set(), rows = [] } = {}) {
  const rank = (id) => { const i = POPULAR.indexOf(id); return i === -1 ? POPULAR.length : i; };
  const forApps = [...connected].filter((id) => ASKS[id]).sort((a, b) => rank(a) - rank(b))
    .flatMap((id) => list(ASKS[id]).map((ask) => (typeof ask === 'string' ? { text: ask } : ask))
      .map((ask) => ({ text: ask.text, provider: id, icon: ask.icon || providerIcon(id) || 'puzzle-piece' })));
  const byName = new Map(list(rows).map((r) => [r.name, r]));
  const noSetup = Object.entries(NO_SETUP_ASKS).filter(([name]) => byName.has(name))
    .map(([name, text]) => ({ text, plugin: name, displayName: byName.get(name).displayName, icon: pluginIcon(byName.get(name)) }));
  return { forApps, noSetup: noSetup.slice(0, 3) };
}

/** The one thing to do next: connect the top family, else add the first ready pack that needs a connection. */
export function nextStep({ families: fams = [], items = [], connected = new Set() } = {}) {
  if (!connected.size) { const lead = fams.find((f) => !f.connected); return lead ? { type: 'connect', family: lead } : null; }
  // Prefer a pack your connections made possible; else any ready pack you don't have yet.
  const open = list(items).filter((s) => s.ready && !s.row.installed && s.kind.id === 'pack');
  const pack = open.find((s) => s.requires.length) || open[0];
  return pack ? { type: 'install', item: pack } : null;
}
