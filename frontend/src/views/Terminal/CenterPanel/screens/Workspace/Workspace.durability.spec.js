// Workspace identity durability + orphaned-conversation recovery.
//
// THE BUG THESE PIN:
// A workspace's id IS the address of its conversation (`workspace:<id>`).
// useWorkspaces minted that id at module load but only ever wrote state from a
// WIDGET MUTATION (add/move/close). Chatting is not a widget mutation, so the
// most ordinary session there is — open the page, talk, reload — persisted
// NOTHING. The next load minted a different id, the chat rebound to a new empty
// channel, and the previous thread became unaddressable while still occupying
// localStorage. Measured on a real profile: 69 `workspace:*` channels, 0
// reachable, 11 holding real conversations.
//
// Two independent failures, so two independent guarantees:
//   1. identity is written the moment it exists (and survives a reload),
//   2. a debounced write cannot be lost to an unload.
// Plus a one-shot repair that re-attaches the conversations already orphaned.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const STORAGE_KEY = 'agnt:workspaces:v2';
const CHAT_KEY = 'unifiedChatConversations';
const RECOVERY_FLAG = 'agnt:workspaces:recovered:v1';

const CHAT_WIDGET = {
  name: 'Chat',
  icon: 'fas fa-comments',
  category: 'home',
  component: { template: '<div/>' },
  defaultSize: { cols: 4, rows: 8 },
  minSize: { cols: 3, rows: 4 },
  isScreenWidget: true,
};

/** Boot a pristine copy of the singleton against whatever storage is present. */
async function boot({ clearStorage = true } = {}) {
  // The module persists through a 250ms debounce it owns. A test ending right
  // after a mutation leaves that timer in flight, and it then fires against the
  // OLD module instance — writing its state back AFTER the next test cleared
  // storage. Purely a cross-test artifact; let pending saves land first.
  await new Promise((r) => setTimeout(r, 300));
  vi.resetModules();
  if (clearStorage) localStorage.clear();
  const reg = await import('@/canvas/widgetRegistry.js');
  reg.registerWidget('workspace-chat', CHAT_WIDGET);
  const mod = await import('./useWorkspaces.js');
  return { mod, ws: mod.useWorkspaces() };
}

const readPersisted = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');

const conversation = (messages, lastUpdate = Date.now()) => ({
  messages,
  conversationId: null,
  lastUpdate,
  suggestions: [],
});

const userMsg = (content, id = 'u1') => ({ id, role: 'user', content, timestamp: 1 });
const welcomeMsg = (channel) => ({
  id: `${channel.replace(':', '-')}-welcome-123`,
  role: 'assistant',
  content: 'Your workspace.',
  timestamp: 1,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe('workspace identity is durable the moment it exists', () => {
  it('persists a freshly minted workspace WITHOUT any widget mutation', async () => {
    const { ws } = await boot();
    const stored = readPersisted();
    expect(stored).not.toBeNull();
    expect(stored.workspaces.map((w) => w.id)).toContain(ws.active.value.id);
  });

  it('keeps the same id — and therefore the same chat channel — across a reload', async () => {
    const first = await boot();
    const firstId = first.ws.active.value.id;
    const firstChannel = first.ws.chatChannelKey.value;

    // Reload: new module instance, SAME storage. This is the exact sequence
    // that used to mint a brand-new id and strand the previous conversation.
    const second = await boot({ clearStorage: false });
    expect(second.ws.active.value.id).toBe(firstId);
    expect(second.ws.chatChannelKey.value).toBe(firstChannel);
  });

  it('does not rewrite storage when state was loaded unchanged', async () => {
    await boot();
    const before = localStorage.getItem(STORAGE_KEY);
    await boot({ clearStorage: false });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('a pending write survives the window closing', () => {
  it('flushes the debounced save on pagehide', async () => {
    const { ws } = await boot();
    ws.renameWorkspace(ws.active.value.id, 'Renamed before unload');
    // Still inside the 250ms debounce: storage holds the pre-rename state.
    expect(readPersisted().workspaces[0].name).not.toBe('Renamed before unload');

    window.dispatchEvent(new Event('pagehide'));
    expect(readPersisted().workspaces[0].name).toBe('Renamed before unload');
  });

  it('flushes on beforeunload too', async () => {
    const { ws } = await boot();
    ws.setAutoOpen(false);
    window.dispatchEvent(new Event('beforeunload'));
    expect(readPersisted().autoOpen).toBe(false);
  });

  it('cancels the pending timer so the flush is not duplicated', async () => {
    const { ws } = await boot();
    ws.renameWorkspace(ws.active.value.id, 'Flushed');
    window.dispatchEvent(new Event('pagehide'));

    const spy = vi.spyOn(Storage.prototype, 'setItem');
    await new Promise((r) => setTimeout(r, 400));
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('findRecoverableWorkspaces — which orphans are real losses', () => {
  let findRecoverableWorkspaces;
  let MAX_RECOVERED_WORKSPACES;

  beforeEach(async () => {
    const { mod } = await boot();
    ({ findRecoverableWorkspaces, MAX_RECOVERED_WORKSPACES } = mod);
  });

  it('groups a workspace primary chat and its secondary chats under one id', () => {
    const found = findRecoverableWorkspaces({
      'workspace:ws_a': conversation([userMsg('hello')]),
      'workspace:ws_a:w_two': conversation([userMsg('second chat')]),
    }, new Set());

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('ws_a');
    expect(found[0].chatKeys.sort()).toEqual(['', 'w_two']);
    expect(found[0].messageCount).toBe(2);
  });

  it('ignores channels holding only a welcome banner', () => {
    const found = findRecoverableWorkspaces({
      'workspace:ws_empty': conversation([welcomeMsg('workspace:ws_empty')]),
    }, new Set());
    expect(found).toEqual([]);
  });

  it('ignores workspaces that are still live', () => {
    const found = findRecoverableWorkspaces({
      'workspace:ws_live': conversation([userMsg('still here')]),
    }, new Set(['ws_live']));
    expect(found).toEqual([]);
  });

  it('ignores non-workspace channels', () => {
    const found = findRecoverableWorkspaces({
      'agent:agent-chat': conversation([userMsg('not a workspace')]),
      'workflow:abc': conversation([userMsg('also not')]),
    }, new Set());
    expect(found).toEqual([]);
  });

  it('returns the most recent first and caps the count', () => {
    const channels = {};
    for (let i = 0; i < MAX_RECOVERED_WORKSPACES + 5; i++) {
      channels[`workspace:ws_${i}`] = conversation([userMsg(`thread ${i}`)], 1000 + i);
    }
    const found = findRecoverableWorkspaces(channels, new Set());
    expect(found).toHaveLength(MAX_RECOVERED_WORKSPACES);
    expect(found[0].id).toBe(`ws_${MAX_RECOVERED_WORKSPACES + 4}`);
    expect(found.map((g) => g.lastUpdate)).toEqual([...found.map((g) => g.lastUpdate)].sort((a, b) => b - a));
  });

  it('titles a group from its first real user message, not the welcome banner', () => {
    const found = findRecoverableWorkspaces({
      'workspace:ws_t': conversation([
        welcomeMsg('workspace:ws_t'),
        userMsg('ideate the ideal marketing workspace for AGNT'),
      ]),
    }, new Set());
    // 40-char cap, trimmed so it never ends on a space.
    expect(found[0].title).toBe('ideate the ideal marketing workspace for');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('boot recovery re-attaches orphaned conversations', () => {
  it('re-creates the workspace under its ORIGINAL id so the channel resolves', async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      'workspace:ws_lost': conversation([userMsg('what can you see???')], 5000),
    }));

    const { mod, ws } = await boot({ clearStorage: false });
    const recovered = ws.workspaces.value.find((w) => w.id === 'ws_lost');
    expect(recovered).toBeTruthy();
    expect(recovered.name).toBe('what can you see???');

    // The whole point: the rebuilt chat widget must address the SAME channel.
    const chat = recovered.widgets.find((w) => w.widgetId === 'workspace-chat');
    expect(mod.chatChannelFor(recovered.id, chat)).toBe('workspace:ws_lost');
  });

  it('rebuilds secondary chats on their own channels', async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      'workspace:ws_multi': conversation([userMsg('primary')], 9000),
      'workspace:ws_multi:w_side': conversation([userMsg('secondary')], 9001),
    }));

    const { mod, ws } = await boot({ clearStorage: false });
    const recovered = ws.workspaces.value.find((w) => w.id === 'ws_multi');
    const channels = recovered.widgets.map((w) => mod.chatChannelFor(recovered.id, w));
    expect(channels).toContain('workspace:ws_multi');
    expect(channels).toContain('workspace:ws_multi:w_side');
  });

  it('persists the recovered workspaces immediately', async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      'workspace:ws_lost': conversation([userMsg('recover me')], 5000),
    }));
    await boot({ clearStorage: false });
    expect(readPersisted().workspaces.map((w) => w.id)).toContain('ws_lost');
  });

  it('keeps the live workspace active — recovery appends, it does not take over', async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      'workspace:ws_lost': conversation([userMsg('recover me')], 5000),
    }));
    const { ws } = await boot({ clearStorage: false });
    expect(ws.active.value.id).not.toBe('ws_lost');
    expect(ws.workspaces.value.length).toBe(2);
  });

  it('runs ONCE — a workspace closed after the repair stays closed', async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify({
      'workspace:ws_lost': conversation([userMsg('recover me')], 5000),
    }));
    const first = await boot({ clearStorage: false });
    expect(first.ws.workspaces.value.some((w) => w.id === 'ws_lost')).toBe(true);
    expect(localStorage.getItem(RECOVERY_FLAG)).toBeTruthy();

    first.ws.closeWorkspace('ws_lost');
    window.dispatchEvent(new Event('pagehide'));

    // Its conversation is still in storage — without the flag this reload
    // would resurrect the tab the user just closed.
    const second = await boot({ clearStorage: false });
    expect(second.ws.workspaces.value.some((w) => w.id === 'ws_lost')).toBe(false);
  });

  it('survives an unreadable chat store without blocking startup', async () => {
    localStorage.setItem(CHAT_KEY, '{not json');
    const { ws } = await boot({ clearStorage: false });
    expect(ws.workspaces.value.length).toBe(1);
    expect(readPersisted()).not.toBeNull();
  });

  it('also reads conversations left behind by the abandoned split-key scheme', async () => {
    localStorage.setItem(
      'conv:unified:workspace:ws_split',
      JSON.stringify(conversation([userMsg('stranded in a split key')], 7000)),
    );
    const { ws } = await boot({ clearStorage: false });
    expect(ws.workspaces.value.some((w) => w.id === 'ws_split')).toBe(true);
  });
});
