/**
 * A minimal CDP client, shared by everything backend-side that speaks to a
 * browser AGNT owns.
 *
 * Extracted from BrowserScreencastService when browserActDriver became its
 * second consumer — two hand-rolled CDP clients WILL drift, and the drift will
 * surface as "clicking works but watching doesn't" on some browser version.
 *
 * Deliberately not a dependency. The full clients (puppeteer, chrome-remote-
 * interface) bring a browser-management layer whose entire job is launching and
 * owning browsers — which is the one thing this must NOT do. It attaches to a
 * browser somebody else owns and speaks a handful of methods to it.
 */

import { WebSocket } from 'ws';

/**
 * How long a CDP command may take before we stop waiting for it.
 *
 * This is the budget for a QUESTION — read a property, describe a node, get a
 * box model. Commands that make the browser do WORK do not belong under it:
 * MEASURED, a cold Chromium's first Page.navigate on a loaded machine takes
 * longer than five seconds, and judging it failed here surfaces as
 * "Page.navigate timed out" on a navigation that was about to succeed, drops
 * the driver, and makes the browser look broken to the user. Callers pass
 * their own budget for those — see NAVIGATE_TIMEOUT_MS / TREE_TIMEOUT_MS /
 * TAB_TIMEOUT_MS in browserActDriver.js.
 */
const COMMAND_TIMEOUT_MS = 5000;

let nextCommandId = 1;

export class CdpConnection {
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

  send(method, params = {}, sessionId = undefined, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('the browser connection is not open'));
    }
    const id = nextCommandId;
    nextCommandId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
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
   * Used for the screencast frame ack, which arrives up to 60 times a second
   * and whose reply nobody reads. Awaiting it would allocate a pending entry
   * and a timer per frame for no information.
   */
  post(method, params = {}, sessionId = undefined) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
    const payload = { id: nextCommandId, method, params };
    nextCommandId += 1;
    if (sessionId) payload.sessionId = sessionId;
    try { this.socket.send(JSON.stringify(payload)); } catch { /* the close path handles it */ }
  }

  onEvent(listener) { this.listeners.add(listener); }

  offEvent(listener) { this.listeners.delete(listener); }

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
export async function attachToPage(connection) {
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
