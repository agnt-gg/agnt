/**
 * Live browser surfaces — the browsers AGNT is currently rendering.
 *
 * The Browser widget hosts a real Chromium surface and opens a CDP bridge onto
 * it (electron/CdpBridge.js). That endpoint is minted in the renderer, but the
 * thing that needs it — the Browser Agent action — runs in the backend, in a
 * different process, triggered by a chat turn that knows nothing about widgets.
 *
 * This registry is the join. A widget announces "there is a browser here, at
 * this endpoint"; the action asks "is there a browser to drive?". Nobody has to
 * pass a ws:// URL through a conversation.
 *
 * IN MEMORY ON PURPOSE. A surface only exists while a renderer is holding it
 * open; an entry that survived a restart would advertise a bridge whose socket
 * died with the process that served it.
 *
 * WHY AN ENTRY IS NEVER TRUSTED ON ITS OWN
 * ---------------------------------------
 * The bridge and this registry are two records of ONE fact, kept by two
 * processes with different lifecycles. The bridge belongs to Electron's main
 * process and dies with its webContents (reload, crash, quit). The entry is
 * withdrawn by the widget's unmount hook. Every teardown that skips that hook —
 * a renderer reload, a crash, a DELETE aborted by the navigation that caused it
 * — leaves this map advertising a socket nobody is listening on, and the caller
 * gets ECONNREFUSED (WinError 1225 on Windows) several layers away from here.
 *
 * A dead ws:// URL is indistinguishable from a live one by inspection, so
 * resolution does not inspect: it CONNECTS. See getLiveSurface.
 */

import { WebSocket } from 'ws';

/** userId -> Map(instanceId -> { workspaceId, cdpUrl, url, title, updatedAt }) */
const byUser = new Map();

/** Only loopback bridges, in the shape CdpBridge mints. */
const LOOPBACK_CDP = /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/;

export function isLocalBridgeUrl(cdpUrl) {
  return typeof cdpUrl === 'string' && LOOPBACK_CDP.test(cdpUrl);
}

/**
 * Announce a browser surface, or refresh one that has navigated.
 * @returns {boolean} false when the endpoint is not a local bridge.
 */
export function registerSurface(userId, instanceId, {
  workspaceId = null, cdpUrl, url = null, title = null,
} = {}) {
  if (!userId || !instanceId || !isLocalBridgeUrl(cdpUrl)) return false;
  if (!byUser.has(userId)) byUser.set(userId, new Map());
  byUser.get(userId).set(instanceId, {
    workspaceId, cdpUrl, url, title, updatedAt: Date.now(),
  });
  return true;
}

export function unregisterSurface(userId, instanceId) {
  const surfaces = byUser.get(userId);
  if (!surfaces) return false;
  const removed = surfaces.delete(instanceId);
  if (surfaces.size === 0) byUser.delete(userId);
  return removed;
}

/**
 * Forget a surface by its endpoint.
 *
 * Used when a run fails to connect: the entry is provably dead, and leaving it
 * would hand the same refused socket to every later turn.
 */
export function forgetSurfaceByUrl(userId, cdpUrl) {
  const surfaces = byUser.get(userId);
  if (!surfaces || !cdpUrl) return false;
  for (const [instanceId, entry] of surfaces) {
    if (entry.cdpUrl === cdpUrl) return unregisterSurface(userId, instanceId);
  }
  return false;
}

/**
 * Which surfaces a selector means, best first.
 *
 * Identity order is strict:
 *   1. exact instanceId — the front-most browser captured when the turn sent;
 *   2. workspaceId — newest browser in that workspace, for older clients;
 *   3. account-wide newest — only when the turn is not workspace-bound.
 *
 * A workspace-bound turn NEVER falls through to another workspace. That was
 * the original cross-window bug: opening/navigating browser B made it globally
 * newest, so chat A silently started driving B.
 *
 * An EXACT request resolves to one candidate or none. If the browser a turn
 * named is gone, driving a different window would be worse than not running.
 */
function candidatesFor(surfaces, { instanceId = null, workspaceId = null } = {}) {
  if (instanceId) {
    const exact = surfaces.get(instanceId);
    if (!exact) return [];
    if (workspaceId && exact.workspaceId !== workspaceId) return [];
    return [{ instanceId, ...exact }];
  }

  return [...surfaces.entries()]
    .filter(([, entry]) => !workspaceId || entry.workspaceId === workspaceId)
    .map(([candidateId, entry]) => ({ instanceId: candidateId, ...entry }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** What this registry BELIEVES, without checking. Diagnostics only. */
export function getActiveSurface(userId, selector = {}) {
  const surfaces = byUser.get(userId);
  if (!surfaces || surfaces.size === 0) return null;
  return candidatesFor(surfaces, selector)[0] || null;
}

/**
 * Is anything actually listening on this bridge?
 *
 * Opens a real WebSocket rather than a bare TCP connect, because ephemeral
 * ports get recycled: a plain connect would succeed against whatever unrelated
 * process inherited the number. CdpBridge checks its per-session token at the
 * HTTP upgrade, so completing this handshake proves it is OUR bridge, on OUR
 * surface — not merely that the port is occupied.
 */
export function probeBridge(cdpUrl, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let socket = null;
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.terminate(); } catch { /* already gone */ }
      resolve(alive);
    };
    const timer = setTimeout(() => done(false), timeoutMs);

    try {
      socket = new WebSocket(cdpUrl, { handshakeTimeout: timeoutMs });
    } catch {
      return done(false);
    }
    socket.once('open', () => done(true));
    socket.once('error', () => done(false));
    socket.once('close', () => done(false));
    return undefined;
  });
}

/**
 * The browser a turn should actually drive — one that answers.
 *
 * Walks the selector's candidates best-first and returns the first that is
 * reachable, DROPPING every dead entry on the way. Pruning matters as much as
 * the check: `updatedAt` never moves for a surface whose renderer is gone, but
 * it stays the newest thing in the map, so an unpruned corpse wins the
 * "most recent" contest for the rest of the process's life.
 */
export async function getLiveSurface(userId, selector = {}, probe = probeBridge) {
  const surfaces = byUser.get(userId);
  if (!surfaces || surfaces.size === 0) return null;

  for (const candidate of candidatesFor(surfaces, selector)) {
    // eslint-disable-next-line no-await-in-loop -- ordered by preference; the
    // first live candidate wins, so probing them in parallel would waste calls.
    if (await probe(candidate.cdpUrl)) return candidate;
    console.log(`[BrowserSurfaces] dropping ${candidate.instanceId}: nothing is listening on its bridge.`);
    unregisterSurface(userId, candidate.instanceId);
  }
  return null;
}

/**
 * Wait briefly for a surface to appear.
 *
 * Calling ai_browser_use from chat ALSO auto-opens the Browser widget
 * (TOOL_WIDGET_MAP), so on a cold canvas the tool and the window race: the tool
 * runs backend-side immediately while the widget is still mounting, attaching
 * its debugger and minting a bridge. Without this the first "go look at X" of a
 * session would always miss the window it just opened.
 */
export async function waitForSurface(
  userId,
  selector = {},
  timeoutMs = 8000,
  pollMs = 200,
  probe = probeBridge,
) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- this IS the polling loop.
    const surface = await getLiveSurface(userId, selector, probe);
    if (surface) return surface;
    if (Date.now() >= deadline) return null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, pollMs); });
  }
}

/** Test seam. */
export function _resetSurfaces() {
  byUser.clear();
}
