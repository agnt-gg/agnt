/**
 * Lifecycle rules for the forked workflow process, kept out of
 * WorkflowProcess.js because that file initializes itself on import (database,
 * timers) and so cannot be loaded by a unit test.
 */

/**
 * Workflows that stopping the process now would interrupt: an engine executing
 * nodes, or holding triggers it has accepted but not yet run. An armed trigger
 * waiting for an event is not running work.
 *
 * @param {Map<string, { isRunning?: boolean, triggerQueue?: unknown[] }>} activeWorkflows
 */
export function countRunningWorkflows(activeWorkflows) {
  let running = 0;
  for (const engine of activeWorkflows.values()) {
    if (engine?.isRunning || engine?.triggerQueue?.length > 0) running++;
  }
  return running;
}

/**
 * THE PARENT IS GONE: EXIT.
 *
 * The workflow process is forked with an IPC channel, and the channel closes
 * when the backend dies for any reason, graceful or not. Without this the child
 * outlived a killed backend (on Windows, the update installer's taskkill; or any
 * crash) as an orphan still holding plugin gateways and pollers, and the next
 * launch armed every trigger a second time. Nothing it does is useful without
 * its parent: results cannot be reported and nobody can stop it.
 *
 * @param {NodeJS.Process} proc
 * @param {object} opts
 * @param {() => boolean} opts.isShuttingDown  SHUTDOWN already owns the exit
 * @param {() => void} opts.markShuttingDown
 * @param {() => void} opts.release            stop pollers/gateways
 * @param {(code: number) => void} [opts.exit]
 * @param {number} [opts.graceMs]
 * @returns {boolean} whether the watch was installed
 */
export function exitWhenOrphaned(proc, { isShuttingDown, markShuttingDown, release, exit = (c) => proc.exit(c), graceMs = 500, log = console }) {
  if (typeof proc.send !== 'function') return false; // not forked
  proc.once('disconnect', () => {
    if (isShuttingDown()) return;
    markShuttingDown();
    log.warn('[WorkflowProcess] parent disconnected - releasing resources and exiting');
    try {
      release();
    } catch (err) {
      log.error(`[WorkflowProcess] release on disconnect failed: ${err.message}`);
    }
    const t = setTimeout(() => exit(0), graceMs);
    t.unref?.();
  });
  return true;
}
