/**
 * Side-effect bootstrap for Node-side AGNT processes.
 *
 * Import this FIRST in an entry point and diagnostics are live before any other
 * module's top-level code runs:
 *
 *     import './src/diagnostics/bootstrap.js';
 *
 * Deliberately a side-effect module so the change to server.js and
 * WorkflowProcess.js is exactly one line each. Observability should not require
 * restructuring the thing it observes.
 *
 * NOTE ON FATAL POLICY — this ships as 'stay', which is byte-for-byte today's
 * behaviour: uncaught exceptions are logged and the process keeps running.
 * That is almost certainly wrong (a process in an undefined state should not
 * keep serving; the supervisor in main.js exists precisely to respawn it), but
 * flipping it changes restart semantics, and bundling a behaviour change into
 * an observability change is how you end up unable to tell which one broke
 * things. Set AGNT_FATAL_POLICY=exit to opt in.
 */
import PathManager from '../utils/PathManager.js';
import { installDiagnostics } from './install.js';

const isWorkflow = process.env.IS_WORKFLOW_PROCESS === 'true';
const proc = isWorkflow ? 'workflow' : 'backend';

const fatalPolicy = process.env.AGNT_FATAL_POLICY === 'exit' ? 'exit' : 'stay';

/** Cheap, high-signal state for crash records. Must never throw. */
function getState() {
  const state = {
    proc,
    argv1: process.argv[1],
    // Helps distinguish parent-gone vs app bugs in crash JSON when dumps do occur
    connected: process.connected,
    ppid: process.ppid,
  };
  try {
    state.cwd = process.cwd();
  } catch {
    /* ignore */
  }
  return state;
}

export const diagnostics = installDiagnostics({
  proc,
  dir: PathManager.getPath('diagnostics'),
  fatalPolicy,
  getState,
});

export const recorder = diagnostics.recorder;
export default diagnostics;
