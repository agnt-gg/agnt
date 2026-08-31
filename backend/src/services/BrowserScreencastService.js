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

import { WebSocket } from 'ws';
import { broadcastToUser } from '../utils/realtimeSync.js';

/** How long to wait for a client's render-ack before assuming it is gone. */
const ACK_TIMEOUT_MS = 2000;

/** How long a CDP command may take before we stop waiting for it. */
const COMMAND_TIMEOUT_MS = 5000;

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

let nextCommandId = 1;

/**
 * A minimal CDP client.
 *
 * Deliberately not a dependency. The full clients (puppeteer, chrome-remote-
 * interface) bring a browser-management layer whose entire job is launching and
 * owning browsers — which is the one thing this must NOT do. It attaches to a
 * browser somebody else owns and speaks eight methods to it.
 */
class CdpConnection {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
    this.socket = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.cdpUrl, { handshakeTimeout: 4000 });
      this.socket = socket;

      const failed = (err) => {
        this.closed = true;
        reject(err instanceof Error ? err : new Error('CDP connection failed'));
      };

      socket.once('open', () => {
        socket.removeListener('error', failed);
        socket.on('message', (raw) => this.#receive(raw));
        socket.on('close', () => this.#abandon('the browser connection closed'));
        socket.on('error', () => this.#abandon('the browser connection errored'));
        resolve(this);
      });
      socket.once('error', failed);
    });
  }

  #receive(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // Not something we can act on; dropping is the whole response.
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP error'));
      else resolve(message.result);
      return;
    }

    if (message.method) {
      for (const listener of this.listeners) listener(message);
    }
  }

  #abandon(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: '__closed', params: { reason } });
  }

  send(method, params = {}, sessionId = undefined) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('the browser connection is not open'));
    }
    const id = nextCommandId;
    nextCommandId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });

      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        this.socket.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Fire and forget.
   *
   * Used only for the frame ack, which arrives up to 60 times a second and
   * whose reply nobody reads. Awaiting it would allocate a pending entry and a
   * timer per frame for no information.
   */
  post(method, params = {}, sessionId = undefined) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
    const payload = { id: nextCommandId, method, params };
    nextCommandId += 1;
    if (sessionId) payload.sessionId = sessionId;
    try { this.socket.send(JSON.stringify(payload)); } catch { /* the close path handles it */ }
  }

  onEvent(listener) { this.listeners.add(listener); }

  close() {
    this.closed = true;
    try { this.socket?.close(); } catch { /* already gone */ }
  }
}

/**
 * Attach to the page inside a browser and return its CDP session id.
 *
 * `flatten: true` multiplexes the page session over the same socket rather than
 * opening a second one. CdpBridge emulates exactly this pair of methods for the
 * Electron widget, so one code path serves both a launched browser and the
 * widget's bridge.
 */
async function attachToPage(connection) {
  const { targetInfos = [] } = await connection.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  if (!page) throw new Error('that browser has no page to show');

  const { sessionId } = await connection.send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  if (!sessionId) throw new Error('the browser refused a page session');
  return { sessionId, targetId: page.targetId };
}

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
    stopSession(session.instanceId, message.params?.reason || 'the browser went away');
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

/** Drop one viewer; stop the stream when the last one leaves. */
export function stopViewing(instanceId) {
  const session = sessions.get(instanceId);
  if (!session) return { ok: true, viewers: 0 };

  session.viewers -= 1;
  if (session.viewers > 0) return { ok: true, viewers: session.viewers };

  stopSession(instanceId, 'the last viewer left');
  return { ok: true, viewers: 0 };
}

function stopSession(instanceId, reason) {
  const session = sessions.get(instanceId);
  if (!session) return;
  sessions.delete(instanceId);
  clearTimeout(session.ackTimer);

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
