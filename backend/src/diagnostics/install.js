/**
 * Per-process installer.
 *
 * One call at the top of each process wires up: the recorder, the console
 * bridge, process-level fatal handlers, and a final flush on exit.
 *
 * `fatalPolicy` differs by process on purpose:
 *   backend  — default 'stay' for compatibility (opt into exit via AGNT_FATAL_POLICY).
 *   workflow — default 'exit' after one real fatal: parent bridge restarts the worker.
 *              'stay' after EPIPE previously produced crash-file storms.
 *   main     — 'stay': quitting is decided by Electron lifecycle code.
 *
 * Benign pipe/stream errors (EPIPE after parent closes stdout/IPC) do NOT dump
 * full crash JSON and do not keep the process alive to re-throw.
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { Recorder } from './Recorder.js';
import { installConsoleBridge } from './consoleBridge.js';

let installed = null;

/** @type {{ key: string, at: number, count: number } | null} */
let lastCrashDedupe = null;

const DEDUPE_WINDOW_MS = 60_000;

/**
 * Errors that mean "the other end of stdout/stderr/IPC is gone" — not app bugs.
 * Dumping a 500KB crash per throw + stay = crash-file storms on workers.
 */
export function isBenignPipeError(err) {
  if (!err) return false;
  const code = err.code || err.errno;
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'EIO') return true;
  const msg = String(err.message || err);
  // Node sometimes surfaces only the message for broken pipes
  if (/broken pipe/i.test(msg) || /EPIPE/i.test(msg)) return true;
  return false;
}

function crashDedupeKey(reason, err) {
  return `${reason}|${err?.code || ''}|${String(err?.message || '').slice(0, 200)}`;
}

/**
 * @returns {boolean} true if this crash should be dumped (first in window)
 */
export function shouldDumpCrash(reason, err, now = Date.now()) {
  const key = crashDedupeKey(reason, err);
  if (lastCrashDedupe && lastCrashDedupe.key === key && now - lastCrashDedupe.at < DEDUPE_WINDOW_MS) {
    lastCrashDedupe.count += 1;
    return false;
  }
  lastCrashDedupe = { key, at: now, count: 1 };
  return true;
}

/** Test helper — reset module state between tests. */
export function _resetDiagnosticsInstallForTests() {
  if (installed) {
    try {
      installed.uninstall();
    } catch {
      /* ignore */
    }
  }
  installed = null;
  lastCrashDedupe = null;
}

function attachStdioPipeGuards() {
  const swallowPipe = (stream) => {
    if (!stream || typeof stream.on !== 'function') return;
    // Avoid stacking handlers if install is somehow re-entered after reset
    if (stream.__agntPipeGuard) return;
    stream.__agntPipeGuard = true;
    stream.on('error', (err) => {
      if (isBenignPipeError(err)) return;
      // Non-pipe stream errors: leave a breadcrumb; don't rethrow.
      try {
        process.stderr.write(`[diagnostics] stdio error: ${err?.message || err}\n`);
      } catch {
        /* ignore */
      }
    });
  };
  swallowPipe(process.stdout);
  swallowPipe(process.stderr);
}

/**
 * @param {object}   opts
 * @param {string}   opts.proc              'main' | 'backend' | 'workflow' | 'renderer'
 * @param {string}   opts.dir               diagnostics directory
 * @param {string}  [opts.bootId]
 * @param {string}  [opts.level]
 * @param {boolean} [opts.bridgeConsole=true]
 * @param {'exit'|'stay'} [opts.fatalPolicy='stay']
 * @param {() => object} [opts.getState]    cheap high-signal snapshot for crash records
 */
export function installDiagnostics({
  proc,
  dir,
  bootId,
  level,
  bridgeConsole = true,
  fatalPolicy = 'stay',
  getState = () => ({}),
}) {
  if (installed) return installed;

  const resolvedBoot = bootId || process.env.AGNT_BOOT_ID || randomUUID();
  process.env.AGNT_BOOT_ID = resolvedBoot; // inherited by every child we fork

  const recorder = new Recorder({ dir, proc, bootId: resolvedBoot, level });
  const uninstallBridge = bridgeConsole ? installConsoleBridge(recorder) : () => {};

  attachStdioPipeGuards();

  const safeState = () => {
    try {
      return getState() || {};
    } catch (err) {
      return { stateError: err?.message };
    }
  };

  const quietExit = (code = 0) => {
    try {
      recorder.close();
    } catch {
      /* ignore */
    }
    process.exitCode = code;
    setTimeout(() => process.exit(code), 50).unref?.();
  };

  const onFatal = (reason) => (errOrReason) => {
    const err = errOrReason instanceof Error ? errOrReason : new Error(String(errOrReason));

    // Parent closed the pipe / IPC — common when Electron or the bridge shuts down.
    // Do not write multi-hundred-KB crash dumps; do not stay alive to rethrow.
    if (isBenignPipeError(err)) {
      try {
        process.stderr.write(
          `[diagnostics] ${proc} ${reason}: benign pipe/stream error (${err.code || err.message}) — not dumping crash\n`
        );
      } catch {
        /* stderr may be the broken pipe */
      }
      // Workflow workers (and any disconnected child) should exit so the parent can restart.
      const isChild = process.env.IS_WORKFLOW_PROCESS === 'true' || typeof process.send === 'function';
      if (isChild && !process.connected) {
        quietExit(0);
        return;
      }
      if (isChild && process.env.IS_WORKFLOW_PROCESS === 'true') {
        // Even if connected flag races, EPIPE on stdout almost always means parent is gone.
        quietExit(0);
        return;
      }
      return;
    }

    if (!shouldDumpCrash(reason, err)) {
      const n = lastCrashDedupe?.count || 0;
      try {
        process.stderr.write(
          `[diagnostics] ${proc} ${reason}: suppressed duplicate crash dump (×${n} in ${DEDUPE_WINDOW_MS / 1000}s): ${err.message}\n`
        );
      } catch {
        /* ignore */
      }
      // Still honor exit policy so we don't spin forever
      if (fatalPolicy === 'exit') {
        quietExit(1);
      }
      return;
    }

    const file = recorder.dumpCrash(reason, err, safeState());
    // Bypass the bridge so this reaches the terminal even mid-teardown.
    try {
      process.stderr.write(`[diagnostics] ${proc} ${reason}: ${err.message}\n  crash record: ${file}\n`);
    } catch {
      /* ignore */
    }

    if (fatalPolicy === 'exit') {
      quietExit(1);
    }
  };

  const handlers = {
    uncaughtException: onFatal('uncaughtException'),
    unhandledRejection: onFatal('unhandledRejection'),
  };
  process.on('uncaughtException', handlers.uncaughtException);
  process.on('unhandledRejection', handlers.unhandledRejection);

  // Last chance to persist pending repeat summaries. Sync-only context.
  const onExit = () => recorder.close();
  process.once('exit', onExit);

  installed = {
    recorder,
    bootId: resolvedBoot,
    dir,
    fatalPolicy,
    uninstall() {
      uninstallBridge();
      process.off('uncaughtException', handlers.uncaughtException);
      process.off('unhandledRejection', handlers.unhandledRejection);
      process.off('exit', onExit);
      recorder.close();
      installed = null;
    },
  };
  return installed;
}

/** The active recorder, or null before install. */
export function getRecorder() {
  return installed ? installed.recorder : null;
}

/** Default diagnostics directory given AGNT's root data dir. */
export function diagnosticsDir(rootDir) {
  return path.join(rootDir, 'diagnostics');
}

export default installDiagnostics;
