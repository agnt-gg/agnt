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
 * WHY THE CLIENT ACKS EVERY FRAME
 * ---------------------------------------------------------------------------
 * Page.startScreencast will not send frame N+1 until frame N is acknowledged.
 * That is usually described as a formality; it is actually the entire flow
 * control. Acking on ARRIVAL (here) streams as fast as the encoder can go and
 * buries a phone on hotel wifi under frames it cannot paint. Acking on RENDER
 * (the client, after drawing) makes a slow viewer throttle ITSELF, because the
 * pipeline simply stops until it catches up.
 *
 * The cost is that a client which never acks stalls its own stream forever, so
 * a watchdog re-acks after ACK_TIMEOUT_MS. A stalled stream is indistinguishable
 * from a hung browser to the person watching, and "the picture froze" is the
 * least debuggable bug report there is.
 */

import { broadcastToUser } from '../utils/realtimeSync.js';
import { CdpConnection, attachToPage } from './cdpConnection.js';

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

/** instanceId -> session */
const sessions = new Map();

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
    return { ok: true, joined: true, viewers: existing.viewers };
  }

  const connection = await new CdpConnection(cdpUrl).connect();

  let session;
  try {
    const { sessionId, targetId } = await attachToPage(connection);
    session = {
      userId, instanceId, cdpUrl, connection, sessionId, targetId, viewers: 1, ackTimer: null, lastFrame: null,
    };
    sessions.set(instanceId, session);

    connection.onEvent((message) => handleEvent(session, message));

    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Page.startScreencast', FRAME_FORMAT, sessionId);
  } catch (err) {
    sessions.delete(instanceId);
    connection.close();
    throw err;
  }

  console.log(`[Screencast] streaming ${instanceId} to user ${userId}`);
  return { ok: true, joined: false, viewers: 1 };
}

function handleEvent(session, message) {
  if (message.method === '__closed') {
    stopSession(session.instanceId, message.params?.reason || 'the browser went away', { notify: true });
    return;
  }

  if (message.method === 'Page.screencastFrame') {
    const { data, sessionId: frameId, metadata } = message.params || {};
    session.lastFrame = frameId;

    broadcastToUser(session.userId, 'browser:frame', {
      instanceId: session.instanceId,
      data,
      metadata,
      frameId,
    });

    // See the header: the client acks after it PAINTS, so a slow viewer
    // throttles itself. This watchdog only fires when no ack arrives at all.
    clearTimeout(session.ackTimer);
    session.ackTimer = setTimeout(() => {
      if (session.lastFrame === frameId) acknowledgeFrame(session.instanceId, frameId);
    }, ACK_TIMEOUT_MS);
    return;
  }

  // The page navigated: the URL a viewer is looking at changed, and the
  // registry's copy is now stale.
  if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId) {
    broadcastToUser(session.userId, 'browser:navigated', {
      instanceId: session.instanceId,
      url: message.params?.frame?.url || null,
    });
  }
}

/** The client has painted a frame and is ready for the next one. */
export function acknowledgeFrame(instanceId, frameId) {
  const session = sessions.get(instanceId);
  if (!session || frameId === undefined || frameId === null) return false;
  clearTimeout(session.ackTimer);
  session.connection.post('Page.screencastFrameAck', { sessionId: frameId }, session.sessionId);
  return true;
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
export function stopViewing(instanceId) {
  const session = sessions.get(instanceId);
  if (!session) return { ok: true, viewers: 0 };

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
    broadcastToUser(session.userId, 'browser:stopped', { instanceId, reason });
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
