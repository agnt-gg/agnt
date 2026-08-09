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
 */

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
 * Resolve the browser a PARTICULAR chat turn owns.
 *
 * Identity order is strict:
 *   1. exact instanceId — the front-most browser captured when the turn sent;
 *   2. workspaceId — newest browser in that workspace, for older clients;
 *   3. account-wide newest — only when the turn is not workspace-bound.
 *
 * A workspace-bound turn NEVER falls through to another workspace. That was
 * the original cross-window bug: opening/navigating browser B made it globally
 * newest, so chat A silently started driving B.
 */
export function getActiveSurface(userId, { instanceId = null, workspaceId = null } = {}) {
  const surfaces = byUser.get(userId);
  if (!surfaces || surfaces.size === 0) return null;

  if (instanceId) {
    const exact = surfaces.get(instanceId);
    if (!exact) return null;
    if (workspaceId && exact.workspaceId !== workspaceId) return null;
    return { instanceId, ...exact };
  }

  let best = null;
  for (const [candidateId, entry] of surfaces) {
    if (workspaceId && entry.workspaceId !== workspaceId) continue;
    if (!best || entry.updatedAt > best.updatedAt) best = { instanceId: candidateId, ...entry };
  }
  return best;
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
) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const surface = getActiveSurface(userId, selector);
    if (surface) return surface;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => { setTimeout(resolve, pollMs); });
  }
}

/** Test seam. */
export function _resetSurfaces() {
  byUser.clear();
}
