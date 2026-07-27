/**
 * Per-process installer.
 *
 * One call at the top of each process wires up: the recorder, the console
 * bridge, process-level fatal handlers, and a final flush on exit.
 *
 * `fatalPolicy` differs by process on purpose:
 *   backend  — 'exit': a process in an undefined state must not keep serving.
 *              The supervisor in main.js respawns it. Today this is 'stay',
 *              which produces a zombie backend that looks alive and isn't.
 *   workflow — 'stay': the parent bridge owns restart, and an in-flight
 *              workflow is often still salvageable.
 *   main     — 'stay': quitting is decided by Electron lifecycle code.
 */
import path from 'path';
import { randomUUID } from 'crypto';
import { Recorder } from './Recorder.js';
import { installConsoleBridge } from './consoleBridge.js';

let installed = null;

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

  const safeState = () => {
    try {
      return getState() || {};
    } catch (err) {
      return { stateError: err?.message };
    }
  };

  const onFatal = (reason) => (errOrReason) => {
    const err = errOrReason instanceof Error ? errOrReason : new Error(String(errOrReason));
    const file = recorder.dumpCrash(reason, err, safeState());
    // Bypass the bridge so this reaches the terminal even mid-teardown.
    process.stderr.write(`[diagnostics] ${proc} ${reason}: ${err.message}\n  crash record: ${file}\n`);

    if (fatalPolicy === 'exit') {
      recorder.close();
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 250).unref?.();
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
