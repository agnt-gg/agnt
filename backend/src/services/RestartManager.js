/**
 * RestartManager - supervisor-sanctioned backend self-restart.
 *
 * Exit-code protocol: the backend exits with RESTART_EXIT_CODE (42) to tell
 * the Electron supervisor (main.js handleBackendExit) "this death is
 * intentional, respawn me." Any other nonzero exit keeps the pre-existing
 * crash semantics. Code 42 collides with nothing Node emits naturally
 * (1, 3-13, 128+signal).
 *
 * A restart receipt persists timing and PID context across the process
 * boundary so the fresh instance can log verified recovery diagnostics.
 *
 * Choreography (requestRestart):
 *   1. write manifest  2. 2s grace so in-flight responses flush
 *   3. workflow child shutdown  4. server.close()  5. process.exit(42)
 * A 15s dead-man timer guarantees the exit even if steps 3-4 hang.
 */
import fs from 'fs';
import path from 'path';

export const RESTART_EXIT_CODE = 42;

// Hard ceiling on the drain. If the workflow child or HTTP server hangs
// during shutdown, we exit anyway - a slightly rude restart beats a zombie
// stuck in drain mode forever (backend-side dead-man's switch).
const DRAIN_DEADLINE_MS = 15000;

// Manifest lives in the process cwd: backend/ in dev, userData when packaged.
// Both are writable and both are the cwd of the NEXT instance too, since the
// supervisor respawns with identical options.
const MANIFEST_PATH = path.join(process.cwd(), 'restart-manifest.json');

class RestartManager {
  constructor() {
    this.state = 'running'; // 'running' | 'draining'
    this.server = null;
    this.workflowBridge = null;
    this.startedAt = Date.now();
  }

  /**
   * Called once from server.js after listen(). Injects live handles so we
   * avoid circular imports (server.js already imports the bridge).
   */
  attach({ server, workflowBridge }) {
    this.server = server;
    this.workflowBridge = workflowBridge;
  }

  isDraining() {
    return this.state === 'draining';
  }

  getStatus() {
    return {
      state: this.state,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  /**
   * Express middleware: while draining, reject new API work with 503 so
   * clients can show "Restarting..." instead of hanging on a dying socket.
   * Health and system-status stay reachable for the supervisor and frontend.
   */
  drainGuard = (req, res, next) => {
    if (this.state !== 'draining') return next();
    if (req.path === '/api/health' || req.path.startsWith('/api/system')) {
      return next();
    }
    res.set('Retry-After', '10');
    return res.status(503).json({ restarting: true, error: 'Backend is restarting' });
  };

  /**
   * Begin the restart choreography. The HTTP response to the caller must
   * already be flushed before this runs (SystemRoutes responds first).
   */
  async requestRestart({ userId = null, reason = '' } = {}) {
    if (this.state === 'draining') return;
    this.state = 'draining';
    console.log(`[RestartManager] Restart requested by user=${userId} reason="${reason}"`);

    // Dead-man's switch: no matter what hangs below, we WILL exit.
    const deadline = setTimeout(() => {
      console.error('[RestartManager] Drain deadline exceeded - forcing exit');
      process.exit(RESTART_EXIT_CODE);
    }, DRAIN_DEADLINE_MS);
    deadline.unref();

    // 1. Persist the restart receipt BEFORE anything can fail so the fresh
    //    process can log measured downtime and the PID transition.
    try {
      fs.writeFileSync(
        MANIFEST_PATH,
        JSON.stringify(
          {
            requestedAt: new Date().toISOString(),
            requestedAtMs: Date.now(),
            userId,
            reason,
            previousPid: process.pid,
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error('[RestartManager] Failed to write manifest:', err.message);
      // Non-fatal: the restart still proceeds, but recovery diagnostics are unavailable.
    }

    // 2. Grace period: let in-flight responses (including the 202 we just
    //    sent, and any streaming SSE turn wrapping up) finish cleanly.
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Workflow child first - same order as the SIGTERM handler. This
    //    tears down live plugin triggers (e.g. Discord gateway) gracefully;
    //    boot re-arms them via restartActiveWorkflows().
    try {
      await this.workflowBridge?.shutdown();
      console.log('[RestartManager] Workflow process shut down');
    } catch (err) {
      console.warn('[RestartManager] Workflow shutdown error (continuing):', err.message);
    }

    // 4. Stop accepting connections, then exit with the magic code.
    //    server.close() waits for keep-alive sockets, so give it a bounded
    //    window rather than trusting it fully.
    const closeTimeout = setTimeout(() => {
      console.warn('[RestartManager] server.close() slow - exiting anyway');
      process.exit(RESTART_EXIT_CODE);
    }, 5000);
    closeTimeout.unref();

    this.server?.close(() => {
      clearTimeout(closeTimeout);
      console.log('[RestartManager] HTTP server closed - exiting for respawn (code 42)');
      process.exit(RESTART_EXIT_CODE);
    });

    // If attach() was never called (early-boot edge), the close callback
    // never fires - the closeTimeout/deadline timers still guarantee exit.
    if (!this.server) {
      console.warn('[RestartManager] No server handle attached - relying on timers');
    }
  }

  /**
   * Called once during boot. If a restart receipt exists, log measured
   * recovery diagnostics and consume it exactly once.
   */
  async consumeRestartManifest() {
    let manifest;
    try {
      if (!fs.existsSync(MANIFEST_PATH)) return null;
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      fs.unlinkSync(MANIFEST_PATH); // consume exactly once
    } catch (err) {
      console.warn('[RestartManager] Could not consume manifest:', err.message);
      try {
        fs.unlinkSync(MANIFEST_PATH);
      } catch {
        /* best effort */
      }
      return null;
    }

    const downtimeMs = Date.now() - (manifest.requestedAtMs || Date.now());
    console.log(
      `[RestartManager] Restart complete. Downtime ~${(downtimeMs / 1000).toFixed(1)}s ` +
        `(pid ${manifest.previousPid} -> ${process.pid})`
    );


    return { downtimeMs, manifest };
  }
}

export default new RestartManager();
