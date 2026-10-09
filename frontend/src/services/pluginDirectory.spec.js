import { describe, it, expect } from 'vitest';
import {
  humanize, toolOperations, isTrigger, pluginInventory, compositionOf, isPack, hasTriggers,
  declaredAccess, capabilityLabel, trustTier, integrityLabel, reviewNotices, pluginToolIds, agentAccess,
  matchesQuery, cardNeedsYou, installedSections, accountRows, connectionKind, builtByMe, priceLabel, signInReadiness,
} from './pluginDirectory.js';

// Shapes copied from backend/plugins/dev manifests and the /plugins/installed route.
const gmail = {
  name: 'gmail-plugin', displayName: 'Gmail', description: 'Send, reply, read',
  permissions: { capabilities: [], domains: [] },
  tools: [{
    type: 'gmail-api',
    schema: {
      title: 'Gmail API', category: 'action', authProvider: 'google',
      parameters: { operation: { type: 'string', options: ['Search and Read Emails', 'Send Email', 'Reply to Email'] }, query: { type: 'string' } },
    },
  }],
};
const calendar = {
  name: 'google-calendar-plugin', displayName: 'Google Calendar',
  tools: [
    { type: 'google-calendar-api', schema: { title: 'Google Calendar API', category: 'action', authProvider: 'google', parameters: { action: { options: ['LIST_EVENTS', 'CREATE_EVENT', 'LIST_EVENTS'] } } } },
    { type: 'google-calendar-trigger', schema: { title: 'New event', category: 'trigger', authProvider: 'google', parameters: { event: { options: [{ value: 'event_created', label: 'Event created' }] } } } },
  ],
};
const discord = {
  name: 'discord-plugin', trustTier: 'official', integrityState: 'verified',
  permissions: { capabilities: ['network', 'spawn-process', 'env-access', 'filesystem'], domains: ['discord.com', 'gateway.discord.gg'] },
  grantedPermissions: ['network', 'spawn-process', 'env-access', 'filesystem'],
  tools: [{ type: 'discord-api', schema: { title: 'Discord API', authProvider: 'discord' } }],
};
const pack = {
  name: 'sales-desk', displayName: 'Sales Desk',
  tools: [{ type: 'hubspot-api', schema: { title: 'HubSpot API', authProvider: 'hubspot' } }],
  agents: [{ slug: 'lead-qualifier', name: 'Lead Qualifier' }],
  workflows: [{ slug: 'new-lead' }], skills: [], widgets: [{ slug: 'pipeline-board', name: 'Pipeline board' }],
};

describe('operations and triggers', () => {
  it('humanizes enum styles the manifests actually use', () => {
    expect(humanize('SEND_MESSAGE')).toBe('Send message');
    expect(humanize('getDatabases')).toBe('Get databases');
    expect(humanize('Search and Read Emails')).toBe('Search and read emails');
    expect(humanize('')).toBe('');
  });
  it('reads operation, action and event parameters; option objects; de-duplicates', () => {
    expect(toolOperations(gmail.tools[0])).toEqual(['Search and read emails', 'Send email', 'Reply to email']);
    expect(toolOperations(calendar.tools[0])).toEqual(['List events', 'Create event']);
    expect(toolOperations(calendar.tools[1])).toEqual(['Event created']);
  });
  it('a tool without an operation parameter does one thing', () => {
    expect(toolOperations(discord.tools[0])).toEqual([]);
    expect(toolOperations({ schema: { parameters: { query: { type: 'string' } } } })).toEqual([]);
    expect(toolOperations({})).toEqual([]);
  });
  it('splits triggers from tools by schema.category', () => {
    expect(isTrigger(calendar.tools[1])).toBe(true);
    expect(isTrigger(calendar.tools[0])).toBe(false);
    const inventory = pluginInventory(calendar);
    expect(inventory.find((g) => g.key === 'tools').items.map((i) => i.name)).toEqual(['Google Calendar API']);
    expect(inventory.find((g) => g.key === 'triggers').items.map((i) => i.name)).toEqual(['New event']);
    expect(hasTriggers(calendar)).toBe(true);
    expect(hasTriggers(gmail)).toBe(false);
  });
});

describe('inventory', () => {
  it('returns all six groups in display order and fills catalog assets', () => {
    const inventory = pluginInventory(pack);
    expect(inventory.map((g) => g.key)).toEqual(['tools', 'triggers', 'agents', 'workflows', 'skills', 'widgets']);
    expect(inventory.find((g) => g.key === 'agents').items[0].name).toBe('Lead Qualifier');
    expect(inventory.find((g) => g.key === 'workflows').items[0].name).toBe('New Lead');
    expect(inventory.find((g) => g.key === 'skills')).toMatchObject({ items: [], known: true });
  });
  it('links installed assets to their local ids for Open actions', () => {
    const widgets = pluginInventory(pack, [{ asset_type: 'widget', asset_slug: 'pipeline-board', local_id: 'w-9' }]).find((g) => g.key === 'widgets');
    expect(widgets.items).toEqual([expect.objectContaining({ id: 'w-9', name: 'Pipeline board' })]);
  });
  it('composition names only what is there, with operations on request', () => {
    expect(compositionOf(pluginInventory(gmail), { operations: true }).map((c) => c.label)).toEqual(['1 tool · 3 operations']);
    expect(compositionOf(pluginInventory(pack)).map((c) => c.label)).toEqual(['1 tool', '1 agent', '1 workflow', '1 widget']);
    expect(compositionOf(pluginInventory({}))).toEqual([]);
  });
  it('a pack is a plugin that ships more than tools', () => {
    expect(isPack(pack)).toBe(true);
    expect(isPack(gmail)).toBe(false);
  });
});

describe('declared access and trust', () => {
  it('reads the structured permissions block, in vocabulary order, with domains', () => {
    expect(declaredAccess(discord)).toEqual({
      capabilities: ['network', 'filesystem', 'env-access', 'spawn-process'],
      domains: ['discord.com', 'gateway.discord.gg'], undeclared: [], known: true,
    });
  });
  it('reads the legacy array and JSON-string forms', () => {
    expect(declaredAccess({ permissions: ['network'] }).capabilities).toEqual(['network']);
    expect(declaredAccess({ permissions: '{"capabilities":["filesystem"],"domains":["a.io"]}' })).toMatchObject({ capabilities: ['filesystem'], domains: ['a.io'] });
    expect(declaredAccess({ permissions: 'not json' }).capabilities).toEqual([]);
  });
  it('an explicit empty block is known-empty; no data at all is unknown', () => {
    expect(declaredAccess(gmail)).toMatchObject({ capabilities: [], known: true });
    expect(declaredAccess({})).toMatchObject({ capabilities: [], known: false });
  });
  it('flags detected-but-undeclared access on a listing', () => {
    const listing = { declaredPermissions: ['network'], detectedCapabilities: ['network', 'spawn-process'] };
    expect(declaredAccess(listing)).toMatchObject({ capabilities: ['network', 'spawn-process'], undeclared: ['spawn-process'] });
  });
  it('labels known and unknown capabilities without inventing aliases', () => {
    expect(capabilityLabel('spawn-process')).toBe('Runs other programs');
    expect(capabilityLabel('telepathy')).toBe('Uses telepathy');
  });
  it('trust tiers and integrity use plain words, unknown tiers are omitted', () => {
    expect(trustTier(discord)).toMatchObject({ id: 'official', label: 'Official' });
    expect(trustTier({ trustTier: 'mystery' })).toBeNull();
    expect(trustTier({})).toBeNull();
    expect(integrityLabel('tofu')).not.toMatch(/tofu/i);
    expect(integrityLabel('none')).toBe('');
  });
});

describe('updates, agents and search', () => {
  it('review notices come from blockedOnConsent and only for installed plugins', () => {
    const status = { blockedOnConsent: [{ name: 'obsidian-plugin', permissionDiff: { added: ['filesystem'] } }, { name: 'gone', permissionDiff: { added: ['network'] } }] };
    const notices = reviewNotices(status, ['obsidian-plugin', 'gmail-plugin']);
    expect([...notices.entries()]).toEqual([['obsidian-plugin', { added: ['filesystem'] }]]);
    expect(reviewNotices(null, ['x']).size).toBe(0);
  });
  it('matches agents by the tool ids the orchestrator assigns (dashes become underscores)', () => {
    expect([...pluginToolIds(gmail)]).toEqual(['gmail-api', 'gmail_api']);
    const agents = [
      { id: 1, name: 'Inbox Triage', toolAccessMode: 'restricted', assignedTools: ['gmail_api'] },
      { id: 2, name: 'Writer', toolAccessMode: 'restricted', assignedTools: ['web_search'] },
      { id: 3, name: 'Annie', toolAccessMode: 'open', assignedTools: ['gmail_api'] },
      { id: 4, name: 'Assistant', assignedTools: ['gmail-api'] },
    ];
    expect(agentAccess(agents, gmail)).toEqual({ openCount: 1, restricted: [{ id: '4', name: 'Assistant' }, { id: '1', name: 'Inbox Triage' }] });
    expect(agentAccess(undefined, gmail)).toEqual({ openCount: 0, restricted: [] });
  });
  it('search reaches into operations, so "reply" finds Gmail', () => {
    expect(matchesQuery(gmail, 'reply')).toBe(true);
    expect(matchesQuery(gmail, 'gmail send')).toBe(true);
    expect(matchesQuery(gmail, 'calendar')).toBe(false);
    expect(matchesQuery(pack, 'qualifier')).toBe(true);
    expect(matchesQuery(gmail, '   ')).toBe(true);
  });
});

describe('cards, accounts and authorship', () => {
  const google = { id: 'google', kind: 'account', providerId: 'google', name: 'Google', connectionType: 'oauth', status: 'ready', apps: [{ name: 'gmail-plugin' }, { name: 'google-calendar-plugin' }] };
  const notion = { id: 'notion', kind: 'account', providerId: 'notion', name: 'Notion', connectionType: 'oauth', status: 'reconnect', apps: [{ name: 'notion-plugin' }] };
  const memory = { id: 'app:memory', kind: 'app', providerId: null, name: 'Memory', status: 'ready', apps: [{ name: 'memory' }] };
  const video = { id: 'app:video', kind: 'app', providerId: 'openrouter', usesModelKey: true, name: 'Video', status: 'connect', apps: [{ name: 'video' }] };

  it('a card needs you for a missing or failing sign-in, or an update awaiting consent', () => {
    expect(cardNeedsYou(notion)).toBe(true);
    expect(cardNeedsYou(google)).toBe(false);
    expect(cardNeedsYou(google, new Map([['google-calendar-plugin', { added: ['network'] }]]))).toBe(true);
    const { needsYou, ready } = installedSections([google, notion, memory]);
    expect(needsYou.map((c) => c.id)).toEqual(['notion']);
    expect(ready.map((c) => c.id)).toEqual(['google', 'app:memory']);
  });
  it('account rows are sign-ins only; model-billed app cards stay in Settings', () => {
    const rows = accountRows([google, notion, memory, video]);
    expect(rows.map((r) => r.id)).toEqual(['google', 'notion']);
    expect(rows[0]).toMatchObject({ kind: 'Sign-in', apps: google.apps });
    expect(connectionKind('apikey')).toBe('API key');
    expect(connectionKind(undefined)).toBe('Connection');
  });
  it('built by me follows the Forge: built here or published by you', () => {
    const installed = [{ name: 'invoice-chaser' }, { name: 'analytics' }, { name: 'gmail-plugin' }];
    const published = [{ asset_type: 'plugin', asset_id: 'analytics', current_version: '0.3.0' }, { asset_type: 'agent', asset_id: 'gmail-plugin' }];
    const mine = builtByMe({ installed, builtNames: ['invoice-chaser'], published });
    expect(mine.map((m) => m.row.name)).toEqual(['invoice-chaser', 'analytics']);
    expect(mine[1].listing).toMatchObject({ current_version: '0.3.0' });
  });
  it('prices and sign-in readiness', () => {
    expect(priceLabel({ price: 9.99 })).toBe('$9.99');
    expect(priceLabel({ price: 0 })).toBe('');
    expect(signInReadiness(gmail, ['google'])).toEqual({ providers: ['google'], ready: true });
    expect(signInReadiness(gmail, [])).toEqual({ providers: ['google'], ready: false });
    expect(signInReadiness({ tools: [{ schema: { authProvider: 'openrouter' } }] }, ['openrouter'], ['openrouter'])).toEqual({ providers: [], ready: false });
  });
});
