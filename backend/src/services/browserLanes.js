/**
 * Browser lanes — one tab per conversation in the launched browser.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO CLOSE
 * ---------------------------------------------------------------------------
 * The browser AGNT launches is one Chrome per backend, and everything about it
 * was keyed by user: one surface (`host:<user>`), one "current tab", one
 * driver. So every conversation drove and watched the SAME page. Conversation
 * B navigating took conversation A's agent with it mid-task, B's element refs
 * replaced A's, and A's live card streamed whatever B was doing.
 *
 * A lane gives each conversation its own tab in that one browser:
 *
 *   - its own surface id (`host:<user>:conv:<id>`), so it is watched and
 *     driven independently;
 *   - its own tab ownership (browserActiveTarget.js), so neither the agent
 *     nor the viewer can attach to another conversation's tab, and popups
 *     stay with the conversation whose page opened them;
 *   - shared cookies, deliberately: logging in once works in every chat.
 *
 * Tabs, not separate Chromes: a tab costs a renderer, a browser costs
 * 150-300MB. Each lane opens its tab in its own window so it is the
 * foreground page of that window rather than a background tab.
 *
 * Bounded: a lane idle for LANE_IDLE_MS closes, and a user holds at most
 * MAX_LANES_PER_USER (the least recently used closes first). A lane somebody
 * is watching is never closed from under them.
 */

import { CdpConnection } from './cdpConnection.js';
import { registerSurface, unregisterSurface, hostInstanceId } from './browserSurfaces.js';
import {
  confineScope, claimTab, visiblePages, ownedTabs, setActiveTarget, getActiveTarget, releaseScope,
} from './browserActiveTarget.js';
import { isStreaming } from './BrowserScreencastService.js';
import { dropDriversForScope, isScopeBusy } from './browserActDriver.js';
import { START_PAGE } from '../tools/library/browserEngines/browserFallbackSurface.js';

export const LANE_IDLE_MS = 30 * 60 * 1000;
export const MAX_LANES_PER_USER = 8;
const SWEEP_EVERY_MS = 60 * 1000;
const CONNECT_TIMEOUT_MS = 15000;
const TAB_TIMEOUT_MS = 15000;
/** Conversations remembered for "which browser did it last use". */
const MAX_BINDINGS = 1000;

/** A conversation id we are willing to put in a surface id. */
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The lane for a conversation, or null when it has none.
 *
 * A client-side `temp-` id is not a conversation yet: it is replaced by the
 * server's id when the turn starts, and a lane opened under it would be an
 * orphan tab nobody can reach again.
 */
export function laneForConversation(conversationId) {
  const id = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!id || id.startsWith('temp-') || !CONVERSATION_ID.test(id)) return null;
  return `conv:${id}`;
}

/**
 * The lane for a tool run. Chat turns carry their conversation id on the
 * stand-in engine (orchestrator/tools.js spreads the turn context into it);
 * a workflow run has none and keeps the shared default tab.
 */
export function laneFor(workflowEngine) {
  return laneForConversation(workflowEngine?.conversationId);
}

/** instanceId -> { userId, lane, cdpUrl, workspaceId, lastUsedAt } */
const lanes = new Map();
/** instanceId -> in-flight ensure, so two verbs of one turn get one tab. */
const ensuring = new Map();
/** `${userId}\n${lane}` -> the surface that conversation last drove. */
const bindings = new Map();
let sweeper = null;

const bindingKey = (userId, lane) => `${userId}\n${lane}`;

/**
 * Remember which browser a conversation used, so its live card shows THAT one.
 *
 * Usually the lane itself. Not always: `run` and `script` hand the browser to
 * libraries that choose their own tab, so they use the shared default; and a
 * workspace turn may drive a Browser widget. The card must follow the work,
 * wherever it actually happened.
 */
export function bindConversation(userId, lane, instanceId) {
  if (!userId || !lane || !instanceId) return;
  const key = bindingKey(userId, lane);
  bindings.delete(key); // re-insert: Map order is the LRU order
  bindings.set(key, instanceId);
  if (bindings.size > MAX_BINDINGS) bindings.delete(bindings.keys().next().value);
}

/** The surface a conversation last drove, or null. */
export function boundSurface(userId, lane) {
  if (!userId || !lane) return null;
  return bindings.get(bindingKey(userId, lane)) || null;
}

/** Mark a lane as in use (a verb ran, a viewer attached). */
export function touchLane(instanceId) {
  const entry = lanes.get(instanceId);
  if (entry) entry.lastUsedAt = Date.now();
}

/**
 * Make sure a conversation has its tab in the launched browser at `cdpUrl`,
 * and return its surface.
 *
 * Verifies against the browser every time rather than trusting memory: the
 * tab may have been closed by the page, crashed, or died with a relaunched
 * browser, and a remembered id for a dead tab is the same "drives nothing"
 * failure browserSurfaces.js exists to prevent.
 */
export function ensureLane(userId, lane, { cdpUrl, workspaceId = null } = {}) {
  if (!userId || !lane || !cdpUrl) return Promise.reject(new Error('a lane needs a user, a lane id and a browser'));
  const instanceId = hostInstanceId(userId, lane);
  const inFlight = ensuring.get(instanceId);
  if (inFlight) return inFlight;

  const work = openOrReuseTab({ userId, lane, instanceId, cdpUrl, workspaceId })
    .finally(() => { if (ensuring.get(instanceId) === work) ensuring.delete(instanceId); });
  ensuring.set(instanceId, work);
  return work;
}

async function openOrReuseTab({ userId, lane, instanceId, cdpUrl, workspaceId }) {
  const known = lanes.get(instanceId);
  // A different endpoint is a relaunched browser: every tab id from the old
  // one is meaningless, so start the lane clean rather than chase ghosts.
  if (known && known.cdpUrl !== cdpUrl) releaseScope(instanceId);
  confineScope(instanceId);

  const connection = await new CdpConnection(cdpUrl).connect({ timeoutMs: CONNECT_TIMEOUT_MS });
  let tab;
  try {
    const { targetInfos = [] } = await connection.send('Target.getTargets');
    const mine = visiblePages(instanceId, targetInfos);
    tab = mine.find((page) => page.targetId === getActiveTarget(instanceId)) || mine[0] || null;
    if (!tab) {
      const created = await connection.send(
        'Target.createTarget',
        { url: START_PAGE, newWindow: true },
        undefined,
        { timeoutMs: TAB_TIMEOUT_MS },
      );
      if (!created?.targetId) throw new Error('the browser did not open a tab for this conversation');
      claimTab(instanceId, created.targetId);
      tab = { targetId: created.targetId, url: START_PAGE };
      console.log(`[BrowserLanes] opened a tab for ${instanceId}`);
    }
  } finally {
    connection.close();
  }

  setActiveTarget(instanceId, tab.targetId);
  const outcome = registerSurface(userId, instanceId, {
    workspaceId, cdpUrl, transport: 'host-cdp', lane, url: tab.url || null,
  });
  if (!outcome.ok) throw new Error(`could not register the conversation's browser (${outcome.reason})`);

  lanes.set(instanceId, { userId, lane, cdpUrl, workspaceId, lastUsedAt: Date.now() });
  bindConversation(userId, lane, instanceId);
  await evictOverflow(userId, instanceId);
  armSweeper();
  return { instanceId, cdpUrl, transport: 'host-cdp', lane, url: tab.url || null, workspaceId };
}

/**
 * Close a lane: its tabs, its driver, its registry entry.
 *
 * Never leaves the browser with no page at all — closing the last page of a
 * headless browser can end it, taking every other conversation's tab with
 * it — so a replacement blank page is opened first when it would.
 */
export async function closeLane(instanceId, reason = 'closed') {
  const entry = lanes.get(instanceId);
  if (!entry) return false;
  lanes.delete(instanceId);

  const tabs = ownedTabs(instanceId);
  dropDriversForScope(instanceId);
  unregisterSurface(entry.userId, instanceId);
  releaseScope(instanceId);
  for (const [key, bound] of bindings) {
    if (bound === instanceId) bindings.delete(key);
  }

  if (tabs.length > 0) {
    let connection = null;
    try {
      connection = await new CdpConnection(entry.cdpUrl).connect({ timeoutMs: CONNECT_TIMEOUT_MS });
      const { targetInfos = [] } = await connection.send('Target.getTargets');
      const pages = targetInfos.filter((t) => t.type === 'page');
      const closing = new Set(tabs);
      if (!pages.some((page) => !closing.has(page.targetId))) {
        await connection.send('Target.createTarget', { url: START_PAGE }, undefined, { timeoutMs: TAB_TIMEOUT_MS });
      }
      for (const targetId of tabs) {
        // eslint-disable-next-line no-await-in-loop -- a lane holds a handful of tabs at most.
        await connection.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    } catch (err) {
      // The browser is already gone, which closed the tabs for us.
      console.log(`[BrowserLanes] could not close tabs for ${instanceId}: ${err.message}`);
    } finally {
      connection?.close();
    }
  }
  console.log(`[BrowserLanes] closed ${instanceId}: ${reason}`);
  return true;
}

/**
 * A conversation was deleted: close its tab and forget what it drove.
 *
 * Unlike the idle sweep this does not wait for the lane to be free — the
 * conversation no longer exists, so nobody can legitimately be using it, and
 * a tab left open for a chat that is gone is exactly the leak this closes.
 *
 * @returns {Promise<boolean>} whether a lane was open
 */
export async function closeConversationLane(userId, conversationId) {
  const lane = laneForConversation(conversationId);
  if (!userId || !lane) return false;
  // Even with no lane (it used a widget or the shared browser), its record of
  // what it drove is now meaningless.
  bindings.delete(bindingKey(userId, lane));
  return closeLane(hostInstanceId(userId, lane), 'conversation deleted');
}

/** Busy lanes are never closed: someone is watching, or a verb is opening or using it. */
function closable(instanceId) {
  return !isStreaming(instanceId) && !ensuring.has(instanceId) && !isScopeBusy(instanceId);
}

async function evictOverflow(userId, keepInstanceId) {
  const mine = [...lanes.entries()]
    .filter(([id, entry]) => entry.userId === userId && id !== keepInstanceId)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  let excess = mine.length + 1 - MAX_LANES_PER_USER;
  for (const [id] of mine) {
    if (excess <= 0) break;
    if (!closable(id)) continue;
    // eslint-disable-next-line no-await-in-loop -- bounded by the cap
    await closeLane(id, 'too many conversation browsers open');
    excess -= 1;
  }
}

/** Close lanes nobody has used for LANE_IDLE_MS. Exported for tests. */
export async function sweepIdleLanes(now = Date.now()) {
  const stale = [...lanes.entries()]
    .filter(([id, entry]) => now - entry.lastUsedAt >= LANE_IDLE_MS && closable(id))
    .map(([id]) => id);
  for (const id of stale) {
    // eslint-disable-next-line no-await-in-loop -- sequential keeps one CDP connection open at a time
    await closeLane(id, 'idle');
  }
  if (lanes.size === 0) disarmSweeper();
  return stale.length;
}

function armSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    sweepIdleLanes().catch((err) => console.warn('[BrowserLanes] sweep failed:', err.message));
  }, SWEEP_EVERY_MS);
  // A browser lane must never be the reason the backend cannot exit.
  sweeper.unref?.();
}

function disarmSweeper() {
  if (!sweeper) return;
  clearInterval(sweeper);
  sweeper = null;
}

/** Diagnostics: a user's open lanes. */
export function lanesForUser(userId) {
  return [...lanes.entries()]
    .filter(([, entry]) => entry.userId === userId)
    .map(([instanceId, entry]) => ({ instanceId, lane: entry.lane, lastUsedAt: entry.lastUsedAt }));
}

/** Test seam. Forgets lanes without touching any browser. */
export function _resetLanes() {
  for (const id of lanes.keys()) releaseScope(id);
  lanes.clear();
  ensuring.clear();
  bindings.clear();
  disarmSweeper();
}
