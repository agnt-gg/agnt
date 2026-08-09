/**
 * CdpBridge — lets browser-use drive a browser that AGNT owns and renders.
 *
 * THE PROBLEM THIS SOLVES
 * ----------------------
 * The Browser Agent used to launch its own Chromium. That browser lives outside
 * AGNT: you either watch a separate OS window or you watch nothing. To render a
 * real browser INSIDE the app, the ownership has to invert — AGNT owns the
 * surface (an Electron <webview>, natively painted in a widget) and browser-use
 * attaches to it as a guest via `Browser(cdp_url=…, is_local=False)`, which is a
 * first-class upstream path.
 *
 * The obstacle is a protocol mismatch. Electron exposes `webContents.debugger`,
 * which is a PAGE-level CDP endpoint: it speaks DOM, Runtime, Page, Network for
 * one page. browser-use talks to the BROWSER — it enumerates targets, attaches
 * to them, and grants permissions. A page debugger cannot answer those.
 *
 * WHAT THIS BRIDGE DOES, AND WHY IT IS SMALL
 * ------------------------------------------
 * Rather than guess at the size of that gap, it was MEASURED: a logging proxy
 * was placed between a real browser-use agent and a real Chromium for a
 * complete task (spike, 2026-08-09). The agent used 21 distinct CDP methods in
 * 207 calls, and the split was decisive:
 *
 *   browser-level (no sessionId) — must be emulated here .............  7
 *     Target.setAutoAttach(6) Page.enable(4) Target.attachToTarget(1)
 *     Target.getTargets(1) Target.setDiscoverTargets(1)
 *     Browser.grantPermissions(1) Browser.setDownloadBehavior(1)
 *
 *   session-level (page-scoped) — webContents.debugger serves natively ... 14
 *     DOM.describeNode(146) Runtime.runIfWaitingForDebugger(13)
 *     Runtime.evaluate(10) Page.getLayoutMetrics(4) DOM.getDocument(2)
 *     Page.captureScreenshot(1) Accessibility.getFullAXTree(2) …
 *
 * So 99% of the traffic — everything that actually reads and manipulates the
 * page — is forwarded verbatim. Only target lifecycle is synthesised, and the
 * synthesis is honest: there is exactly one target, and it is the webview the
 * user is looking at.
 *
 * WHY NOT --remote-debugging-port
 * -------------------------------
 * Launching Electron with a debugging port would give real browser-level CDP
 * with no emulation at all, and it is the wrong trade. That port exposes EVERY
 * webContents — including the authenticated AGNT renderer holding every
 * provider credential — to any process that can reach loopback. This bridge
 * opens one ephemeral port, requires a per-session token, and can only ever
 * reach the single webContents it was constructed with.
 */

import crypto from 'crypto';
import { WebSocketServer } from 'ws';

/** CDP error codes we return, mirroring Chromium's own numbering. */
const METHOD_NOT_FOUND = -32601;
const SERVER_ERROR = -32000;

export class CdpBridge {
  /**
   * @param {import('electron').WebContents} webContents The surface to expose.
   * @param {object} [options]
   * @param {(msg: string) => void} [options.log]
   */
  constructor(webContents, { log = () => {} } = {}) {
    this.webContents = webContents;
    this.log = log;

    // A stable identity for the one target we expose. Real Chromium target ids
    // are 32 hex chars; matching the shape avoids tripping any client-side
    // validation that assumes the Chromium format.
    this.targetId = crypto.randomBytes(16).toString('hex').toUpperCase();
    this.sessionId = crypto.randomBytes(16).toString('hex').toUpperCase();

    this.token = crypto.randomBytes(24).toString('base64url');
    this.server = null;
    this.port = null;
    this.clients = new Set();
    this.attached = false;
    this.closed = false;
  }

  /** ws://127.0.0.1:<port>/<token> — what browser-use is given as cdp_url. */
  get cdpUrl() {
    return this.port ? `ws://127.0.0.1:${this.port}/${this.token}` : null;
  }

  get currentUrl() {
    try { return this.webContents.getURL(); } catch { return null; }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start() {
    if (this.server) return this.cdpUrl;

    this.#attachDebugger();

    await new Promise((resolve, reject) => {
      // Port 0 = let the OS choose. Never a fixed port: two windows would
      // collide, and a predictable port is a predictable thing to probe.
      this.server = new WebSocketServer({
        port: 0,
        host: '127.0.0.1',
        // The token is checked at the HTTP UPGRADE, before any WebSocket
        // exists. Checking it in the 'connection' handler instead would let an
        // unauthorized caller complete the handshake and hold a live socket,
        // however briefly — a caller with no credential should never get a
        // WebSocket at all, only a 401.
        verifyClient: ({ req }) => {
          const ok = (req.url || '').replace(/^\//, '') === this.token;
          if (!ok) this.log('rejected an upgrade with a bad token');
          return ok;
        },
      }, resolve);
      this.server.once('error', reject);
    });
    this.port = this.server.address().port;

    this.server.on('connection', (socket) => this.#onClient(socket));

    this.log(`bridge listening on ${this.cdpUrl}`);
    return this.cdpUrl;
  }

  #attachDebugger() {
    if (this.attached) return;
    try {
      this.webContents.debugger.attach('1.3');
      this.attached = true;
    } catch (err) {
      // Already attached is fine — DevTools may hold it, or a previous bridge.
      if (!/already attached/i.test(err.message)) throw err;
      this.attached = true;
    }

    this.webContents.debugger.on('message', (_event, method, params, sessionId) => {
      // Everything the page emits is re-labelled with OUR synthetic session id,
      // because that is the id the client attached to.
      this.#broadcast({ method, params, sessionId: sessionId || this.sessionId });
    });

    // Real Chromium pushes Target.targetInfoChanged every time a target's URL or
    // title changes, and browser-use tracks the page it is on from those events
    // rather than by polling. Announcing the target ONCE at attach time (when it
    // is still about:blank) therefore leaves the agent permanently convinced the
    // page never moved: measured on a live run, it drove the real window to the
    // right article and then spent eight steps reasoning about "about:blank".
    // These three Electron events are the navigation surface that matters.
    for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      this.webContents.on(event, () => this.#announceTargetChanged());
    }

    this.webContents.debugger.on('detach', (_event, reason) => {
      this.attached = false;
      this.log(`debugger detached: ${reason}`);
      this.#broadcast({
        method: 'Target.detachedFromTarget',
        params: { sessionId: this.sessionId, targetId: this.targetId },
      });
    });
  }

  /**
   * Tear down. Deliberately does NOT close or navigate the webContents: the
   * agent is a guest, and a guest leaving must not take the user's browser
   * with it.
   */
  close() {
    if (this.closed) return;
    this.closed = true;

    for (const socket of this.clients) {
      try { socket.close(1001, 'bridge closing'); } catch { /* already gone */ }
    }
    this.clients.clear();

    if (this.server) {
      try { this.server.close(); } catch { /* already gone */ }
      this.server = null;
    }

    if (this.attached) {
      try { this.webContents.debugger.detach(); } catch { /* window may be gone */ }
      this.attached = false;
    }
    this.log('bridge closed');
  }

  // ── protocol ────────────────────────────────────────────────────────────

  #onClient(socket) {
    this.clients.add(socket);
    this.log(`client attached (${this.clients.size} total)`);

    socket.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return; // A frame we cannot parse is not a command we can answer.
      }
      await this.#dispatch(socket, message);
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      this.log(`client detached (${this.clients.size} remain)`);
    });
    socket.on('error', () => this.clients.delete(socket));
  }

  async #dispatch(socket, message) {
    const { id, method, params = {}, sessionId } = message;

    // Anything addressed to our session is real page work — forward verbatim.
    // This is the 99% path and it is deliberately dumb: no interpretation, no
    // filtering, no chance of this bridge subtly changing page semantics.
    if (sessionId) {
      if (sessionId !== this.sessionId) {
        return this.#send(socket, { id, error: { code: SERVER_ERROR, message: `Unknown sessionId ${sessionId}` } });
      }
      try {
        const result = await this.webContents.debugger.sendCommand(method, params);
        return this.#send(socket, { id, result: result ?? {}, sessionId });
      } catch (err) {
        this.log(`page command failed: ${method} -> ${err.message}`);
        return this.#send(socket, { id, error: { code: SERVER_ERROR, message: err.message }, sessionId });
      }
    }

    // Browser-level. Only the seven measured methods (plus a couple of obvious
    // neighbours) are emulated; anything else is refused BY NAME rather than
    // silently acked, so an unsupported call shows up as itself instead of as a
    // mysterious hang three layers away.
    switch (method) {
      case 'Target.getTargets':
        return this.#send(socket, { id, result: { targetInfos: [this.#targetInfo()] } });

      case 'Target.getTargetInfo':
        // Answerable at browser level as well as through the page session, and
        // always computed fresh — a cached answer here would reintroduce the
        // stale-URL bug from the other direction.
        return this.#send(socket, { id, result: { targetInfo: this.#targetInfo() } });

      case 'Target.setDiscoverTargets':
        this.#send(socket, { id, result: {} });
        if (params.discover) {
          this.#broadcast({ method: 'Target.targetCreated', params: { targetInfo: this.#targetInfo() } });
        }
        return undefined;

      case 'Target.setAutoAttach':
        // The client asks to be attached to new targets automatically. We have
        // exactly one and it already exists, so announce it immediately —
        // otherwise the client waits forever for a target that will never be
        // "created" because it predates the connection.
        this.#send(socket, { id, result: {} });
        if (params.autoAttach) this.#announceAttached();
        return undefined;

      case 'Target.attachToTarget': {
        if (params.targetId && params.targetId !== this.targetId) {
          return this.#send(socket, { id, error: { code: SERVER_ERROR, message: `No such target ${params.targetId}` } });
        }
        this.#send(socket, { id, result: { sessionId: this.sessionId } });
        this.#announceAttached();
        return undefined;
      }

      case 'Target.detachFromTarget':
      case 'Target.closeTarget':
        // A guest may not close the host surface. Acknowledge so the client's
        // shutdown path completes cleanly; the widget owns the real lifecycle.
        return this.#send(socket, { id, result: { success: true } });

      case 'Target.activateTarget':
        try { this.webContents.focus(); } catch { /* window may be hidden */ }
        return this.#send(socket, { id, result: {} });

      case 'Target.createTarget':
        // Deliberately unsupported: a second target would be a page with nowhere
        // to render. Refusing by name is better than returning a target id that
        // maps to nothing the user can see.
        return this.#send(socket, {
          id,
          error: { code: SERVER_ERROR, message: 'The AGNT browser surface hosts a single tab; Target.createTarget is not available.' },
        });

      case 'Browser.getVersion':
        return this.#send(socket, {
          id,
          result: {
            protocolVersion: '1.3',
            product: `AGNT/${process.versions.chrome ? `Chrome/${process.versions.chrome}` : 'Electron'}`,
            revision: '@agnt',
            userAgent: this.webContents.getUserAgent ? this.webContents.getUserAgent() : '',
            jsVersion: process.versions.v8 || '',
          },
        });

      case 'Browser.grantPermissions':
      case 'Browser.setDownloadBehavior':
      case 'Browser.setWindowBounds':
        // Accepted as no-ops. The Electron session already governs permissions
        // and downloads for this surface (main.js owns that allowlist), and the
        // widget owns the geometry. Answering "ok" is truthful: the caller's
        // intent is satisfied, just not by them.
        return this.#send(socket, { id, result: {} });

      case 'Page.enable':
      case 'Page.disable':
        // Observed at browser level in the spike. Harmless to forward to the
        // page, and forwarding keeps lifecycle events flowing.
        try {
          await this.webContents.debugger.sendCommand(method, params);
        } catch { /* the page may not be ready; not fatal */ }
        return this.#send(socket, { id, result: {} });

      default:
        // Logged, not just refused. A method this bridge does not implement is
        // a measurable gap, and the log is how the next gap gets found in one
        // run instead of by inference from odd agent behaviour.
        this.log(`UNSUPPORTED browser-level method: ${method}`);
        return this.#send(socket, {
          id,
          error: { code: METHOD_NOT_FOUND, message: `${method} is not supported by the AGNT browser bridge` },
        });
    }
  }

  #announceTargetChanged() {
    if (this.closed || this.clients.size === 0) return;
    this.#broadcast({ method: 'Target.targetInfoChanged', params: { targetInfo: this.#targetInfo() } });
  }

  #announceAttached() {
    this.#broadcast({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: this.sessionId,
        targetInfo: this.#targetInfo(),
        waitingForDebugger: false,
      },
    });
  }

  #targetInfo() {
    return {
      targetId: this.targetId,
      type: 'page',
      title: (() => { try { return this.webContents.getTitle(); } catch { return ''; } })(),
      url: this.currentUrl || 'about:blank',
      attached: true,
      canAccessOpener: false,
      browserContextId: this.targetId,
    };
  }

  #send(socket, payload) {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }

  #broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const socket of this.clients) {
      if (socket.readyState === 1) socket.send(text);
    }
  }
}

export default CdpBridge;
