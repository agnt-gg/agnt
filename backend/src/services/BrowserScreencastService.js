/**
 * Streaming a browser AGNT owns to any client that can hold a socket.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The Browser widget renders a real Chromium view through an Electron
 * <webview>. That is the best possible experience — GPU-composited, real
 * scrolling, real input — and it is available on exactly one of the topologies
 * AGNT ships. A browser tab has no <webview>; a phone has no <webview>; and the
 * desktop app pointed at a remote backend has one, but it is on the wrong
 * machine to be driven by that backend.
 *
 * In all three the AGENT still works: the backend launches a browser it owns
 * and drives it over CDP. What is missing is the PIXELS. So this service does
 * not add a second way to drive a browser — it adds a way to WATCH the one that
 * is already being driven.
 *
 * ---------------------------------------------------------------------------
 * WHY FRAMES DO NOT TRAVEL OVER THE CDP BRIDGE
 * ---------------------------------------------------------------------------
 * The obvious shortcut is to let the client speak CDP directly. That would mean
 * exposing a CDP endpoint to the network, and CdpBridge's header explains
 * exactly why that is not on the table: a browser-level debugging port exposes
 * EVERY webContents, including the authenticated AGNT renderer holding the
 * user's provider keys. The loopback restriction is not incidental, it is the
 * security model.
 *
 * So the CDP connection stays here, in the backend, on loopback. Frames go out
 * over the socket.io connection the app already authenticates — identity comes
 * from the bearer token via socketIdentity.js, and every emit is addressed to a
 * `user:<id>` room. A viewer therefore cannot see a browser that is not theirs,
 * and nothing new is listening on the network.
 *
 * ---------------------------------------------------------------------------
 * SHARED FLOW CONTROL
 * ---------------------------------------------------------------------------
 * CDP acknowledgements govern one shared capture, not independent viewers.
 * The fastest viewer or watchdog advances capture. Frame delivery is volatile:
 * a congested transport drops images rather than building a durable queue.
 * The client retains at most one decoding image and one newest pending image.
 *
 * The cost is that a client which never acks stalls its own stream forever, so
 * a watchdog re-acks after ACK_TIMEOUT_MS. A stalled stream is indistinguishable
 * from a hung browser to the person watching, and "the picture froze" is the
 * least debuggable bug report there is.
 */

import { frameViewerSockets } from './browserViewerDeliveryRegistry.js';
import { randomUUID } from 'node:crypto';
import { broadcastToUser } from '../utils/realtimeSync.js';
import { CdpConnection, attachToPage } from './cdpConnection.js';
import { getActiveTarget, onActiveTargetChange, scopeFor } from './browserActiveTarget.js';

/** How long to wait for a client's render-ack before assuming it is gone. */
const ACK_TIMEOUT_MS = 2000;

/**
 * Frames are JPEG, not PNG, and quality is deliberately not 100.
 *
 * A full-page PNG screenshot of a text-heavy site runs 300-800KB. The same
 * frame at JPEG q60 is 25-60KB, and the difference is invisible at the size a
 * browser widget is actually rendered. maxWidth caps the encode cost on a 4K
 * display, where the raw surface is four times the pixels anybody will see.
 */
const FRAME_FORMAT = { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 };

/**
 * The same stream while somebody is looking at it full-window.
 *
 * At FRAME_FORMAT a 1920x1080 page arrives as 1280x720 q60 and is stretched
 * back up across the whole window, which is visibly soft and blocky. This
 * tier sends the page at its own resolution (the cap only bounds a larger
 * visible browser) at a quality where text edges survive. It is opt-in per
 * viewer and dropped the moment that viewer leaves fullscreen or goes away,
 * so the inline card keeps paying the small-frame price. A q85 1080p frame is
 * roughly 150-400KB, well inside MAX_FRAME_CHARS.
 */
const FRAME_FORMAT_HIGH = { format: 'jpeg', quality: 85, maxWidth: 2560, maxHeight: 1600 };

/** The format the stream should use given who is watching it. */
function frameFormat(session) {
  return session.highViewers.size > 0 ? FRAME_FORMAT_HIGH : FRAME_FORMAT;
}

/** instanceId -> session */
const sessions = new Map();
let capturesInFlight = 0;
const MAX_FRAME_CHARS = 2 * 1024 * 1024;

// CdpConnection and attachToPage live in ./cdpConnection.js — extracted when
// browserActDriver became their second consumer, because two hand-rolled CDP
// clients WILL drift, and the drift surfaces as "clicking works but watching
// doesn't" on some future browser version.

/**
 * Begin streaming a surface, or join a stream already running.
 *
 * REF-COUNTED, because two tabs watching one browser must not mean two
 * screencasts on one page — the second startScreencast silently replaces the
 * first's frame settings, and the first viewer's stream quietly changes size.
 * The last viewer leaving stops the screencast; it never closes the browser,
 * because watching and owning are different things and the agent may still be
 * mid-task.
 */
export async function startViewing({ userId, instanceId, cdpUrl }) {
  if (!userId || !instanceId || !cdpUrl) throw new Error('a viewer needs a user, an instance and an endpoint');

  const existing = sessions.get(instanceId);
  if (existing) {
    // A second viewer of a stream that is already correct.
    if (existing.userId !== userId) throw new Error('that browser belongs to someone else');
    existing.viewers += 1;
    return { ok: true, joined: true, viewers: existing.viewers, streamId: existing.streamId };
  }

  const connection = await new CdpConnection(cdpUrl).connect();

  // The tabs this stream may show: a conversation's lane streams only its own
  // tab, never whichever tab another conversation's agent moved to.
  const scope = scopeFor(instanceId, cdpUrl);
  let session;
  try {
    const { sessionId, targetId } = await attachToPage(connection, getActiveTarget(scope), { scope });
    session = {
      userId, instanceId, cdpUrl, scope, connection, sessionId, targetId, streamId: randomUUID(), viewers: 1, ackTimer: null, lastFrame: null,
      highViewers: new Set(),
    };
    sessions.set(instanceId, session);

    connection.onEvent((message) => handleEvent(session, message));

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Page.startScreencast', frameFormat(session), sessionId);
  } catch (err) {
    sessions.delete(instanceId);
    connection.close();
    throw err;
  }

  console.log(`[Screencast] streaming ${instanceId} to user ${userId}`);
  return { ok: true, joined: false, viewers: 1, streamId: session.streamId };
}

/**
 * Point a running stream at another tab, keeping its streamId and viewers.
 *
 * Two callers. The agent moved to another tab (browserActiveTarget), so the
 * view follows it — otherwise the user watches a tab nobody is working in.
 * Or the streamed tab closed or crashed; without this the view froze on its
 * last frame with nothing to say why, because only a whole-connection close
 * was ever noticed.
 *
 * Same streamId on purpose: the viewer's lease, registration and socket
 * routing stay valid, so the switch is invisible apart from the new pixels.
 */
async function retarget(session, preferredTargetId) {
  if (session.retargeting) { session.pendingTarget = preferredTargetId || session.pendingTarget || null; return; }
  session.retargeting = true;
  const previousSessionId = session.sessionId;
  try {
    session.connection.post('Page.stopScreencast', {}, previousSessionId);
    const { sessionId, targetId } = await attachToPage(session.connection, preferredTargetId, { scope: session.scope });
    if (sessions.get(session.instanceId) !== session) return;
    session.sessionId = sessionId;
    session.targetId = targetId;
    session.lastFrame = null;
    clearTimeout(session.ackTimer);
    await session.connection.send('Page.enable', {}, sessionId);
    await session.connection.send('Page.startScreencast', frameFormat(session), sessionId);
    if (previousSessionId && previousSessionId !== sessionId) {
      session.connection.post('Target.detachFromTarget', { sessionId: previousSessionId });
    }
    const info = await session.connection.send('Target.getTargetInfo', { targetId }).catch(() => null);
    broadcastToUser(session.userId, 'browser:navigated', {
      instanceId: session.instanceId, streamId: session.streamId, url: info?.targetInfo?.url || null,
    });
    console.log(`[Screencast] ${session.instanceId} now streaming tab ${targetId}`);
  } catch (err) {
    // No page left to show (the last tab closed) or the browser is going away.
    // Ending with notify sends the viewer back to polling, which picks up the
    // next browser rather than holding a dead frame.
    stopSession(session.instanceId, `could not follow the tab: ${err.message}`, { notify: true });
  } finally {
    session.retargeting = false;
    const next = session.pendingTarget;
    session.pendingTarget = null;
    if (next && next !== session.targetId && sessions.get(session.instanceId) === session) retarget(session, next);
  }
}

onActiveTargetChange((scope, targetId) => {
  for (const session of sessions.values()) {
    if (session.scope === scope && session.targetId !== targetId) retarget(session, targetId);
  }
});

function handleEvent(session, message) {
  if (sessions.get(session.instanceId) !== session) return;
  if (message.method === '__closed') {
    stopSession(session.instanceId, message.params?.reason || 'the browser went away', { notify: true });
    return;
  }

  // The streamed tab closed or crashed, but the browser lives on.
  if (message.method === 'Target.detachedFromTarget' && message.params?.sessionId === session.sessionId) {
    retarget(session, getActiveTarget(session.scope));
    return;
  }

  // A frame from a tab we have already moved away from.
  if (message.sessionId && message.sessionId !== session.sessionId) return;

  if (message.method === 'Page.screencastFrame') {
    const { data, sessionId: frameId, metadata } = message.params || {};
    session.lastFrame = frameId;

    if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS) {
      acknowledgeFrame(session.instanceId, frameId, session.streamId); return;
    }
    const recipients = frameViewerSockets(session.userId, session.instanceId, session.streamId);
    const deliver = global.io
      ? (_user, event, payload) => { if (recipients.length) global.io.to(recipients).volatile.emit(event, payload); }
      : broadcastToUser;
    deliver(session.userId, 'browser:frame', {
      instanceId: session.instanceId,
      streamId: session.streamId,
      data,
      metadata,
      frameId,
    });

    // Shared capture advances on the first render/drop ACK or this watchdog.
    clearTimeout(session.ackTimer);
    session.ackTimer = setTimeout(() => {
      if (sessions.get(session.instanceId) === session && session.lastFrame === frameId) acknowledgeFrame(session.instanceId, frameId, session.streamId);
    }, ACK_TIMEOUT_MS);
    return;
  }

  // The page navigated: the URL a viewer is looking at changed, and the
  // registry's copy is now stale.
  if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId) {
    broadcastToUser(session.userId, 'browser:navigated', {
      instanceId: session.instanceId,
      streamId: session.streamId,
      url: message.params?.frame?.url || null,
    });
  }
}

/**
 * One viewer asks for (or gives up) full-resolution frames.
 *
 * Tracked per viewer, not as a session flag: two tabs can watch one browser,
 * and the inline one leaving fullscreen must not drop the frames the other
 * is still looking at full-window. The screencast is restarted only when the
 * tier actually changes. A restart in the middle of a tab switch is skipped,
 * because retarget starts its new screencast with frameFormat() anyway.
 *
 * @returns {{ ok: boolean, high?: boolean, error?: string }}
 */
export async function setViewerQuality({ userId, instanceId, viewerId, high }) {
  const ownership = ownedSession(userId, instanceId);
  if (ownership.error) return { ok: false, error: ownership.error };
  if (typeof viewerId !== 'string' || !viewerId) return { ok: false, error: 'a viewer is required' };
  const { session } = ownership;

  const before = frameFormat(session);
  if (high === true) session.highViewers.add(viewerId);
  else session.highViewers.delete(viewerId);
  const after = frameFormat(session);

  if (after !== before && !session.retargeting) {
    try {
      await session.connection.send('Page.stopScreencast', {}, session.sessionId);
      // The pending frame belonged to the old screencast; never ack it into the new one.
      session.lastFrame = null;
      clearTimeout(session.ackTimer);
      await session.connection.send('Page.startScreencast', after, session.sessionId);
    } catch (err) {
      // The browser is going away; the close path reports that to the viewer.
      return { ok: false, error: `could not change the stream quality: ${err.message}` };
    }
  }
  return { ok: true, high: after === FRAME_FORMAT_HIGH };
}

/** A viewer left: it no longer holds the stream at full resolution. */
export function forgetViewerQuality(instanceId, viewerId) {
  const session = sessions.get(instanceId);
  if (!session || !session.highViewers.delete(viewerId)) return;
  // Fire and forget: the viewer is gone, and nobody waits on this. Skipped
  // when this was the last viewer: stopViewing ends the screencast next.
  if (session.highViewers.size === 0 && session.viewers > 1 && !session.retargeting) {
    session.connection.post('Page.stopScreencast', {}, session.sessionId);
    session.lastFrame = null;
    clearTimeout(session.ackTimer);
    session.connection.send('Page.startScreencast', FRAME_FORMAT, session.sessionId).catch(() => {});
  }
}

/** The client has painted a frame and is ready for the next one. */
export function acknowledgeFrame(instanceId, frameId, streamId = undefined) {
  const session = sessions.get(instanceId);
  if (!session || (streamId !== undefined && streamId !== session.streamId) || frameId === undefined || frameId === null || session.lastFrame !== frameId) return false;
  session.lastFrame = null;
  clearTimeout(session.ackTimer);
  session.connection.post('Page.screencastFrameAck', { sessionId: frameId }, session.sessionId);
  return true;
}

/** Fresh bootstrap image, requested only AFTER the viewer registered its ID.
 * Not a replay: static/hidden pages need not emit another screencast frame.
 * Concurrent requests share capture work, not viewer ownership or delivery.
 */
export async function captureViewerFrame({ userId, instanceId }) {
  const ownership = ownedSession(userId, instanceId);
  if (ownership.error) throw new Error(ownership.error);
  const { session } = ownership;
  if (!session.capture) {
    if (capturesInFlight >= 4 || Date.now() < (session.nextCaptureAt || 0)) throw new Error('capture busy or rate limited');
    session.nextCaptureAt = Date.now() + 1000;
    capturesInFlight += 1;
    session.capture = (async () => {
      const layout = await session.connection.send('Page.getLayoutMetrics', {}, session.sessionId);
      const viewport = layout.cssVisualViewport;
      const width = viewport?.clientWidth; const height = viewport?.clientHeight;
      if (![width, height].every(v => Number.isFinite(v) && v > 0 && v <= 32768)) throw new Error('invalid viewport dimensions');
      const scale = Math.min(1, 1280 / width, 800 / height);
      const result = await session.connection.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 60, fromSurface: true, captureBeyondViewport: false,
      clip: { x: viewport.pageX || 0, y: viewport.pageY || 0, width, height, scale },
    }, session.sessionId);
      return { ...result, width, height };
    })().then(({ data, width, height }) => {
      if (typeof data !== 'string' || !data || data.length > MAX_FRAME_CHARS || sessions.get(instanceId) !== session) throw new Error('no fresh browser frame available');
      return { instanceId, streamId: session.streamId, data, metadata: { deviceWidth: width, deviceHeight: height }, source: 'snapshot', capturedAt: Date.now() };
    }).finally(() => { capturesInFlight -= 1; session.capture = null; });
  }
  return session.capture;
}

export function ownsStream(userId, instanceId, streamId = undefined) {
  const session = sessions.get(instanceId);
  return Boolean(session && session.userId === userId && (streamId === undefined || session.streamId === streamId));
}

/**
 * What a viewer may send back to the page.
 *
 * ALLOWLISTED BY METHOD NAME, not by prefix. `Input.` looks like a safe
 * namespace and is not: Input.dispatchDragEvent can initiate a file drag, and
 * the point of an allowlist is that adding to it is a decision somebody makes
 * on purpose. Everything here is a mouse, a key or a wheel — the things a
 * person does to a page they are looking at.
 */
const ALLOWED_INPUT = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
]);

/**
 * Forward one input event from a viewer to the page.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
export function dispatchInput({ userId, instanceId, method, params }) {
  const session = sessions.get(instanceId);
  if (!session) return { ok: false, error: 'nothing is streaming there' };
  // Ownership is re-checked here and not only at subscribe time: a socket can
  // re-authenticate as a different user without dropping its subscription.
  if (session.userId !== userId) return { ok: false, error: 'that browser belongs to someone else' };
  if (!ALLOWED_INPUT.has(method)) return { ok: false, error: `${method} is not a viewer input` };

  session.connection.post(method, params || {}, session.sessionId);
  return { ok: true };
}

function ownedSession(userId, instanceId) {
  const session = sessions.get(instanceId);
  if (!session) return { error: 'nothing is streaming there' };
  if (session.userId !== userId) return { error: 'that browser belongs to someone else' };
  return { session };
}

/** Read the state required to render ordinary browser chrome. */
export async function getBrowserState({ userId, instanceId }) {
  const ownership = ownedSession(userId, instanceId);
  if (ownership.error) return { ok: false, error: ownership.error };

  const { session } = ownership;
  const history = await session.connection.send('Page.getNavigationHistory', {}, session.sessionId);
  const entries = history.entries || [];
  const currentIndex = Number.isInteger(history.currentIndex) ? history.currentIndex : -1;
  const current = entries[currentIndex] || {};
  return {
    ok: true,
    url: current.url || 'about:blank',
    title: current.title || '',
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex >= 0 && currentIndex < entries.length - 1,
  };
}

/**
 * Execute one user-facing browser-chrome command.
 *
 * This allowlist is intentionally separate from ALLOWED_INPUT. A page click may
 * never become Page.navigate merely because both arrived from the same viewer.
 */
export async function controlBrowser({ userId, instanceId, action, url }) {
  const ownership = ownedSession(userId, instanceId);
  if (ownership.error) return { ok: false, error: ownership.error };
  const { session } = ownership;

  const history = await session.connection.send('Page.getNavigationHistory', {}, session.sessionId);
  const entries = history.entries || [];
  const currentIndex = Number.isInteger(history.currentIndex) ? history.currentIndex : -1;

  if (action === 'back' || action === 'forward') {
    const targetIndex = currentIndex + (action === 'back' ? -1 : 1);
    const entry = entries[targetIndex];
    if (!entry) return { ok: false, error: `cannot go ${action}` };
    await session.connection.send('Page.navigateToHistoryEntry', { entryId: entry.id }, session.sessionId);
  } else if (action === 'reload') {
    await session.connection.send('Page.reload', { ignoreCache: false }, session.sessionId);
  } else if (action === 'navigate') {
    let destination;
    try { destination = new URL(String(url || '')); } catch { return { ok: false, error: 'enter a valid web address' }; }
    if (!['http:', 'https:'].includes(destination.protocol)) {
      return { ok: false, error: 'only HTTP and HTTPS addresses can be opened' };
    }
    await session.connection.send('Page.navigate', { url: destination.href }, session.sessionId, { timeoutMs: 30000 });
  } else {
    return { ok: false, error: 'unknown browser command' };
  }

  return getBrowserState({ userId, instanceId });
}

/** Drop one viewer; stop the stream when the last one leaves. */
export function stopViewing(instanceId, streamId = undefined) {
  const session = sessions.get(instanceId);
  if (!session || (streamId !== undefined && session.streamId !== streamId)) return { ok: true, viewers: 0 };

  session.viewers -= 1;
  if (session.viewers > 0) return { ok: true, viewers: session.viewers };

  stopSession(instanceId, 'the last viewer left');
  return { ok: true, viewers: 0 };
}

function stopSession(instanceId, reason, { notify = false } = {}) {
  const session = sessions.get(instanceId);
  if (!session) return;
  sessions.delete(instanceId);
  clearTimeout(session.ackTimer);

  // A viewer whose browser died would otherwise sit on its last frame forever,
  // looking like a page that simply stopped changing. Telling it lets it go
  // back to polling and pick up whatever opens next. Only sent when the stream
  // ended on its OWN — a viewer that deliberately left does not need to hear
  // that leaving worked.
  if (notify) {
    broadcastToUser(session.userId, 'browser:stopped', { instanceId, streamId: session.streamId, reason });
  }

  // Best effort: if the browser is already gone this throws, and that is fine —
  // the point of stopping the screencast is to leave a browser that SURVIVES in
  // a clean state, not to succeed against one that did not.
  try { session.connection.post('Page.stopScreencast', {}, session.sessionId); } catch { /* gone */ }
  session.connection.close();
  console.log(`[Screencast] stopped ${instanceId}: ${reason}`);
}

/** Is this surface currently being watched? */
export function isStreaming(instanceId) {
  return sessions.has(instanceId);
}

/** Every stream belonging to a user. Diagnostics, and disconnect cleanup. */
export function streamsForUser(userId) {
  return [...sessions.values()]
    .filter((s) => s.userId === userId)
    .map((s) => ({ instanceId: s.instanceId, viewers: s.viewers }));
}

/** Test seam, and the shutdown path. */
export function _stopAll() {
  for (const instanceId of [...sessions.keys()]) stopSession(instanceId, 'shutting down');
}
