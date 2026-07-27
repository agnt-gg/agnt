/**
 * Per-process installer.
 *
 * One call at the top of each process wires up: the recorder, the console
 * bridge, process-level fatal handlers, and a final flush on exit.
 *
 * `fatalPolicy` (default for all processes: 'stay'; opt into 'exit' via
 * AGNT_FATAL_POLICY=exit or an explicit installDiagnostics option):
 *   backend  — default 'stay' for compatibility with today's restart semantics.
 *              Preferred long-term is 'exit' so a process in an undefined state
 *              does not keep serving (main.js can respawn it); until then a
 *              fatal leaves a zombie backend that looks alive and isn't.
 *              Flipping the default is intentional and separate from this
 *              module's dumps.
 *   workflow — 'stay': the parent bridge owns restart, and an in-flight
 *              workflow is often still salvageable. (Override with AGNT_FATAL_POLICY.)
 *   main     — 'stay': quitting is decided by Electron lifecycle code.
 *
 * This module also:
 *   - skips full crash dumps for benign pipe/stream errors (EPIPE storms)
 *   - dedupes identical crash dumps within a short window
 *   - exits workflow children with a distinct nonzero code when the parent/IPC is gone
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
 * sysexits-style: "input/output error" — parent/IPC channel is gone.
 * Distinct from exit(0) (clean) and exit(1) (app fatal under fatalPolicy=exit).
 */
export const EXIT_PARENT_GONE = 74;

/**
 * Errors that mean "the other end of stdout/stderr/IPC is gone" — not app bugs.
 * Dumping a large crash per throw under fatalPolicy=stay = crash-file storms.
 */
export function isBenignPipeError(err) {
  if (!err) return false;
  const code = err.code || err.errno;
  // Do not treat generic EIO as benign — it can be real disk/FS failure.
  if (
    code === 'EPIPE' ||
    code === 'ERR_STREAM_DESTROYED' ||
    code === 'ERR_IPC_CHANNEL_CLOSED'
  ) {
    return true;
  }
  const msg = String(err.message || err);
  if (/broken pipe/i.test(msg) || /EPIPE/i.test(msg) || /IPC channel closed/i.test(msg)) {
    return true;
  }
  return false;
}

function crashDedupeKey(reason, err) {
  return `${reason}|${err?.code || ''}|${String(err?.message || '').slice(0, 200)}`;
}

/**
 * Single-slot dedupe: only the most recent crash signature is remembered. This
 * suppresses one error repeating — the EPIPE-storm case it exists for — but
 * deliberately does NOT suppress two errors alternating A→B→A→B. That is a
 * known floor, not an oversight: a map keyed by signature needs its own
 * eviction policy or it becomes an unbounded leak on a process that is already
 * failing. Do not assume this is a general storm guard.
 *
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

/** True when this process is a workflow (or similar) child of a bridge. */
export function isWorkflowChildProcess() {
  return process.env.IS_WORKFLOW_PROCESS === 'true';
}

/**
 * Parent is gone / IPC closed — worker should stop (nonzero, not 0).
 * If still connected, a pipe hiccup alone is not a reason to exit under stay policy.
 */
export function shouldExitForParentGone(err) {
  if (!isWorkflowChildProcess()) return false;
  if (typeof process.connected === 'boolean' && !process.connected) return true;
  const code = err?.code || err?.errno;
  if (code === 'ERR_IPC_CHANNEL_CLOSED') return true;
  return false;
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

  const quietExit = (code) => {
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

    // Parent closed the pipe / IPC — not an app bug. Skip multi-hundred-KB dumps.
    if (isBenignPipeError(err)) {
      try {
        process.stderr.write(
          `[diagnostics] ${proc} ${reason}: benign pipe/stream error (${err.code || err.message}) — not dumping crash\n`
        );
      } catch {
        /* stderr may be the broken pipe */
      }
      // Workflow child + parent/IPC gone → exit with distinct nonzero code (not 0).
      // Still-connected pipe hiccup → stay (default fatalPolicy); no dump storm.
      if (shouldExitForParentGone(err)) {
        quietExit(EXIT_PARENT_GONE);
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
