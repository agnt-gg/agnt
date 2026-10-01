/**
 * CONTRACT: one conversation, one tab — and nobody reaches into anyone else's.
 *
 * Every conversation used to drive and watch the SAME page of the one browser
 * AGNT launches: one surface per user, one "current tab", one driver. These
 * tests pin the fix at each layer against a real WebSocket speaking CDP — a
 * fake browser that actually opens and closes tabs — because every property
 * here is about which tab a command lands on, and a mocked transport would
 * pass while the wire was wrong.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer } from 'ws';

vi.mock('../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn() }));
vi.mock('../tools/library/browserEngines/browserFallbackSurface.js', () => ({
  START_PAGE: 'data:text/html,ready',
}));

const targets = await import('./browserActiveTarget.js');
const lanes = await import('./browserLanes.js');
const surfaces = await import('./browserSurfaces.js');
const driver = await import('./browserActDriver.js');
const screencast = await import('./BrowserScreencastService.js');

/**
 * A browser that keeps real tab state: createTarget adds a page, closeTarget
 * removes it, each attach gets a session bound to its tab, and Runtime.evaluate
 * answers with THAT tab's url — so a verb on the wrong tab is visible.
 */
async function fakeBrowser({ startPages = [{ targetId: 'START', url: 'about:blank' }] } = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const pages = startPages.map((p) => ({ type: 'page', title: '', ...p }));
  const sessions = new Map();
  const received = [];
  const sockets = new Set();
  let nextTab = 1;

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      received.push(m);
      const reply = (result) => socket.send(JSON.stringify({ id: m.id, result }));
      const fail = (message) => socket.send(JSON.stringify({ id: m.id, error: { message } }));
      switch (m.method) {
        case 'Target.getTargets': return reply({ targetInfos: pages.map((p) => ({ ...p })) });
        case 'Target.createTarget': {
          const targetId = `T${nextTab++}`;
          pages.push({ type: 'page', targetId, url: m.params.url, title: '' });
          return reply({ targetId });
        }
        case 'Target.closeTarget': {
          const at = pages.findIndex((p) => p.targetId === m.params.targetId);
          if (at >= 0) pages.splice(at, 1);
          return reply({ success: at >= 0 });
        }
        case 'Target.attachToTarget': {
          if (!pages.some((p) => p.targetId === m.params.targetId)) return fail('No target with given id found');
          const sessionId = `S-${m.params.targetId}-${received.length}`;
          sessions.set(sessionId, m.params.targetId);
          return reply({ sessionId });
        }
        case 'Runtime.evaluate': {
          if (m.params.expression === 'document.readyState') return reply({ result: { value: 'complete' } });
          const page = pages.find((p) => p.targetId === sessions.get(m.sessionId));
          return reply({ result: { value: JSON.stringify({ url: page?.url || null, title: page?.title || '' }) } });
        }
        case 'Page.handleJavaScriptDialog': return fail('No dialog is showing');
        default: return m.id !== undefined ? reply({}) : undefined;
      }
    });
  });

  return {
    url: () => `ws://127.0.0.1:${server.address().port}/devtools/browser/abc`,
    pages,
    received,
    /** Which tab a session-scoped command was sent to. */
    tabOf: (sessionId) => sessions.get(sessionId),
    addPopup: (targetId, openerId) => pages.push({ type: 'page', targetId, url: 'https://popup/', title: '', openerId }),
    close: async () => {
      for (const s of sockets) { try { s.terminate(); } catch { /* gone */ } }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

let browser;
beforeEach(async () => { browser = await fakeBrowser(); });
afterEach(async () => {
  screencast._stopAll();
  driver._resetDrivers();
  lanes._resetLanes();
  surfaces._resetSurfaces();
  targets._resetActiveTargets();
  await browser.close();
});

const ensure = (lane, userId = 'u1', extra = {}) => lanes.ensureLane(userId, lane, { cdpUrl: browser.url(), ...extra });
const tabsOf = (scope) => targets.visiblePages(scope, browser.pages).map((p) => p.targetId);

describe('which tabs a scope can see', () => {
  const info = (targetId, extra = {}) => ({ type: 'page', targetId, ...extra });

  it('a lane sees only its own tabs; everyone else sees only unowned ones', () => {
    targets.confineScope('A');
    targets.confineScope('B');
    targets.claimTab('A', 'a1');
    targets.claimTab('B', 'b1');
    const list = [info('start'), info('a1'), info('b1')];
    expect(targets.visiblePages('A', list).map((p) => p.targetId)).toEqual(['a1']);
    expect(targets.visiblePages('B', list).map((p) => p.targetId)).toEqual(['b1']);
    expect(targets.visiblePages('ws://shared', list).map((p) => p.targetId)).toEqual(['start']);
  });

  it('a popup joins the lane of the page that opened it, transitively', () => {
    targets.confineScope('A');
    targets.claimTab('A', 'a1');
    const list = [info('a1'), info('pop2', { openerId: 'pop1' }), info('pop1', { openerId: 'a1' })];
    expect(targets.visiblePages('A', list).map((p) => p.targetId).sort()).toEqual(['a1', 'pop1', 'pop2']);
    expect(targets.visiblePages('shared', list)).toEqual([]);
  });

  it('only a confined scope can claim; a closed tab stops counting', () => {
    targets.claimTab('not-confined', 'x');
    expect(targets.tabOwner('x')).toBeNull();
    targets.confineScope('A');
    targets.claimTab('A', 'a1');
    targets.visiblePages('A', []); // a1 is gone from the browser
    expect(targets.ownedTabs('A')).toEqual([]);
  });

  it('scopeFor keeps the endpoint for anything that is not a lane — the old behaviour', () => {
    expect(targets.scopeFor('widget_1', 'ws://e')).toBe('ws://e');
    targets.confineScope('host:u1:conv:c1');
    expect(targets.scopeFor('host:u1:conv:c1', 'ws://e')).toBe('host:u1:conv:c1');
  });
});

describe('a conversation gets its own tab', () => {
  it('opens one in its own window, registers it, and reuses it after', async () => {
    const first = await ensure('conv:c1');
    expect(first.instanceId).toBe('host:u1:conv:c1');
    const created = browser.received.filter((m) => m.method === 'Target.createTarget');
    expect(created).toHaveLength(1);
    // Its own window, so it is the foreground page there, never a background tab.
    expect(created[0].params.newWindow).toBe(true);
    expect(tabsOf('host:u1:conv:c1')).toEqual(['T1']);

    await ensure('conv:c1');
    expect(browser.received.filter((m) => m.method === 'Target.createTarget')).toHaveLength(1);
    expect(surfaces.getActiveSurface('u1', { instanceId: 'host:u1:conv:c1' })?.lane).toBe('conv:c1');
  });

  it('two conversations get two tabs, and the shared default sees neither', async () => {
    await ensure('conv:c1');
    await ensure('conv:c2');
    expect(tabsOf('host:u1:conv:c1')).toEqual(['T1']);
    expect(tabsOf('host:u1:conv:c2')).toEqual(['T2']);
    expect(tabsOf(browser.url())).toEqual(['START']);
  });

  it('concurrent verbs of one turn open ONE tab, not two', async () => {
    await Promise.all([ensure('conv:c1'), ensure('conv:c1'), ensure('conv:c1')]);
    expect(browser.received.filter((m) => m.method === 'Target.createTarget')).toHaveLength(1);
  });

  it('reopens its tab if the page closed it', async () => {
    await ensure('conv:c1');
    browser.pages.splice(browser.pages.findIndex((p) => p.targetId === 'T1'), 1);
    await ensure('conv:c1');
    expect(tabsOf('host:u1:conv:c1')).toEqual(['T2']);
  });

  it('starts clean after the browser was relaunched on a new endpoint', async () => {
    await ensure('conv:c1');
    const relaunched = await fakeBrowser({ startPages: [{ targetId: 'T1', url: 'about:blank' }] });
    // A recycled tab id in the NEW browser must not be mistaken for ours.
    await lanes.ensureLane('u1', 'conv:c1', { cdpUrl: relaunched.url() });
    expect(relaunched.received.some((m) => m.method === 'Target.createTarget')).toBe(true);
    await relaunched.close();
  });

  it('a lane is never offered as someone else\'s fallback', async () => {
    await ensure('conv:c1');
    expect(surfaces.getActiveSurface('u1', {})).toBeNull();
    expect(surfaces.getActiveSurface('u1', { instanceId: 'host:u1:conv:c1' })).not.toBeNull();
  });

  it('remembers what a conversation drove, for its live card', async () => {
    await ensure('conv:c1');
    expect(lanes.boundSurface('u1', 'conv:c1')).toBe('host:u1:conv:c1');
    lanes.bindConversation('u1', 'conv:c1', 'host:u1');
    expect(lanes.boundSurface('u1', 'conv:c1')).toBe('host:u1');
    expect(lanes.boundSurface('u2', 'conv:c1')).toBeNull();
  });
});

describe('which conversations get a lane', () => {
  it('only real conversation ids', () => {
    expect(lanes.laneForConversation('3f2a-91')).toBe('conv:3f2a-91');
    expect(lanes.laneForConversation('temp-1700000000')).toBeNull();
    expect(lanes.laneForConversation('')).toBeNull();
    expect(lanes.laneForConversation(undefined)).toBeNull();
    expect(lanes.laneForConversation('a/b')).toBeNull();
    expect(lanes.laneForConversation('x'.repeat(200))).toBeNull();
    expect(lanes.laneFor({ conversationId: 'c9' })).toBe('conv:c9');
    expect(lanes.laneFor({ userId: 'u1' })).toBeNull();
  });
});

describe('the driver works in its own conversation\'s tab', () => {
  it('two conversations\' verbs land on two different tabs', async () => {
    const one = await ensure('conv:c1');
    const two = await ensure('conv:c2');
    const a = await driver.performBrowserAction('u1', browser.url(), 'tabs', {}, { instanceId: one.instanceId });
    const b = await driver.performBrowserAction('u1', browser.url(), 'tabs', {}, { instanceId: two.instanceId });
    expect(a.tabs.map((t) => t.id)).toEqual(['T1']);
    expect(b.tabs.map((t) => t.id)).toEqual(['T2']);
    expect(a.url).toBe('data:text/html,ready');
  });

  it('a tab the agent opens belongs to its conversation only', async () => {
    const one = await ensure('conv:c1');
    const two = await ensure('conv:c2');
    await driver.performBrowserAction('u1', browser.url(), 'open', { url: 'https://example.org' }, { instanceId: one.instanceId });
    const a = await driver.performBrowserAction('u1', browser.url(), 'tabs', {}, { instanceId: one.instanceId });
    const b = await driver.performBrowserAction('u1', browser.url(), 'tabs', {}, { instanceId: two.instanceId });
    expect(a.tabs.map((t) => t.id).sort()).toEqual(['T1', 'T3']);
    expect(b.tabs.map((t) => t.id)).toEqual(['T2']);
  });

  it('cannot focus another conversation\'s tab', async () => {
    const one = await ensure('conv:c1');
    await ensure('conv:c2');
    await expect(driver.performBrowserAction('u1', browser.url(), 'focus', { tabId: 'T2' }, { instanceId: one.instanceId }))
      .rejects.toThrow(/No tab "T2"/);
  });

  it('the shared default (a workflow) never lands on a conversation\'s tab', async () => {
    await ensure('conv:c1');
    const shared = await driver.performBrowserAction('u1', browser.url(), 'tabs', {});
    expect(shared.tabs.map((t) => t.id)).toEqual(['START']);
  });
});

describe('the live view shows its own conversation\'s tab', () => {
  it('streams the lane\'s tab, and ignores another lane switching tabs', async () => {
    const one = await ensure('conv:c1');
    await ensure('conv:c2');
    await screencast.startViewing({ userId: 'u1', instanceId: one.instanceId, cdpUrl: browser.url() });
    const attach = browser.received.filter((m) => m.method === 'Target.attachToTarget').at(-1);
    expect(attach.params.targetId).toBe('T1');

    const before = browser.received.length;
    targets.setActiveTarget('host:u1:conv:c2', 'T2');
    await new Promise((r) => { setTimeout(r, 50); });
    expect(browser.received.slice(before).some((m) => m.method === 'Target.attachToTarget')).toBe(false);
  });
});

describe('lanes are bounded', () => {
  it('closes its tabs and forgets everything about it', async () => {
    const one = await ensure('conv:c1');
    await driver.performBrowserAction('u1', browser.url(), 'tabs', {}, { instanceId: one.instanceId });
    expect(await lanes.closeLane(one.instanceId, 'test')).toBe(true);
    expect(browser.pages.map((p) => p.targetId)).toEqual(['START']);
    expect(surfaces.getActiveSurface('u1', { instanceId: one.instanceId })).toBeNull();
    expect(lanes.boundSurface('u1', 'conv:c1')).toBeNull();
    expect(targets.isConfined(one.instanceId)).toBe(false);
  });

  it('never closes the last page of the browser, which would end it for everyone', async () => {
    const lonely = await fakeBrowser({ startPages: [] });
    const lane = await lanes.ensureLane('u1', 'conv:c1', { cdpUrl: lonely.url() });
    await lanes.closeLane(lane.instanceId);
    expect(lonely.pages).toHaveLength(1);
    expect(lonely.pages[0].targetId).not.toBe('T1');
    await lonely.close();
  });

  it(`holds at most ${lanes.MAX_LANES_PER_USER} per user, closing the least recently used`, async () => {
    for (let i = 1; i <= lanes.MAX_LANES_PER_USER + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ensure(`conv:c${i}`);
    }
    const open = lanes.lanesForUser('u1').map((l) => l.lane);
    expect(open).toHaveLength(lanes.MAX_LANES_PER_USER);
    expect(open).not.toContain('conv:c1');
    expect(lanes.lanesForUser('u2')).toEqual([]);
  });

  it('closes idle lanes, but never one somebody is watching', async () => {
    const watched = await ensure('conv:c1');
    await ensure('conv:c2');
    await screencast.startViewing({ userId: 'u1', instanceId: watched.instanceId, cdpUrl: browser.url() });

    expect(await lanes.sweepIdleLanes(Date.now())).toBe(0); // nothing idle yet
    const closed = await lanes.sweepIdleLanes(Date.now() + lanes.LANE_IDLE_MS + 1);
    expect(closed).toBe(1);
    expect(lanes.lanesForUser('u1').map((l) => l.lane)).toEqual(['conv:c1']);
  });
});
