/**
 * Shutdown that is GUARANTEED to terminate the process.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 * The SIGTERM handler in server.js used to be four lines inline:
 *
 *     process.on('SIGTERM', async () => {
 *       await WorkflowProcessBridge.shutdown();
 *       server.close(() => process.exit(0));
 *     });
 *
 * Both halves are traps.
 *
 * 1. `server.close()` stops ACCEPTING new connections and then waits for every
 *    existing one to end. AGNT holds Socket.IO and SSE streams open by design,
 *    so the callback never fired and `process.exit(0)` never ran.
 * 2. The `await` runs BEFORE any of that, so a workflow bridge that hangs
 *    stalls the shutdown before a single guarantee has been established.
 *
 * The result was a backend that ignored SIGTERM forever. Electron exited
 * anyway, leaving an orphan holding port 3333; the NEXT launch lost the bind,
 * retried, exited nonzero, and the supervisor read that as a crash and quit the
 * app. Nathan's Mac, 2026-08-06.
 *
 * It never reproduced on Windows: `.kill()` there is TerminateProcess, so the
 * handler does not run at all and the child dies instantly. Identical code,
 * opposite outcome — which is exactly why this logic now lives somewhere it can
 * be tested on any platform, with the server and the clock injected.
 *
 * THE INVARIANT, in one sentence: once shutdown starts, the process exits —
 * within `hardDeadlineMs` at the very latest, no matter what hangs.
 */

/**
 * @param {object}   spec
 * @param {import('http').Server} spec.server
 * @param {() => Promise<any>} [spec.drain]   best-effort pre-exit work
 * @param {(code: number) => void} [spec.exit] injected for tests
 * @param {number} [spec.forceCloseAfterMs]   when to destroy surviving sockets
 * @param {number} [spec.hardDeadlineMs]      when to exit regardless
 * @param {{ log: Function, warn: Function, error: Function }} [spec.log]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [spec.timers]
 * @returns {(signal: string) => void} idempotent shutdown trigger
 */
export function createGracefulShutdown({
  server,
  drain = async () => {},
  exit = (code) => process.exit(code),
  forceCloseAfterMs = 1000,
  hardDeadlineMs = 3000,
  log = console,
  timers = { setTimeout, clearTimeout },
} = {}) {
  let started = false;
  let exited = false;

  const leave = (code) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  return function shutdown(signal = 'SIGTERM') {
    // Two SIGTERMs, or a SIGINT chasing a SIGTERM, must not run the sequence
    // twice — the second pass would re-arm timers around an already-closing
    // server and log a second, contradictory exit.
    if (started) return;
    started = true;
    log.log(`${signal} received: closing HTTP server`);

    // ARMED FIRST, before any await or any call that could throw. Everything
    // below is best-effort; this is the promise.
    const hardExit = timers.setTimeout(() => {
      log.warn(`Graceful shutdown exceeded ${hardDeadlineMs}ms — exiting now.`);
      leave(0);
    }, hardDeadlineMs);
    hardExit.unref?.();

    let forceClose = null;

    try {
      server.close(() => {
        timers.clearTimeout(hardExit);
        if (forceClose) timers.clearTimeout(forceClose);
        log.log('HTTP server closed');
        leave(0);
      });
    } catch (err) {
      log.error(`server.close() threw: ${err.message}`);
      leave(0);
      return;
    }

    // The half that was missing. Idle keep-alive sockets go immediately;
    // anything still streaming (SSE, Socket.IO, a long-poll) gets a grace
    // period and is then destroyed, because otherwise server.close() waits on
    // it for the life of the connection — which for a live stream is forever.
    server.closeIdleConnections?.();
    forceClose = timers.setTimeout(() => {
      log.warn('Connections still open — destroying them.');
      server.closeAllConnections?.();
    }, forceCloseAfterMs);
    forceClose.unref?.();

    // Deliberately NOT awaited: a wedged bridge must not be able to delay the
    // socket teardown above, which is what actually lets the process exit.
    Promise.resolve()
      .then(drain)
      .catch((err) => log.error(`Shutdown drain failed: ${err?.message || err}`));
  };
}

export default { createGracefulShutdown };
