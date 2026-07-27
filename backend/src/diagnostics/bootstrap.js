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
 * FATAL POLICY
 *   - workflow workers default to **exit** after a real fatal (parent bridge
 *     restarts them). 'stay' after EPIPE previously caused crash-file storms.
 *   - backend still defaults to **stay** for compatibility with existing
 *     deployments; set AGNT_FATAL_POLICY=exit to opt the backend into exit+respawn.
 *   - AGNT_FATAL_POLICY=exit|stay always wins when set.
 */
import PathManager from '../utils/PathManager.js';
import { installDiagnostics } from './install.js';

const isWorkflow = process.env.IS_WORKFLOW_PROCESS === 'true';
const proc = isWorkflow ? 'workflow' : 'backend';

const envPolicy = process.env.AGNT_FATAL_POLICY;
const fatalPolicy =
  envPolicy === 'exit' || envPolicy === 'stay'
    ? envPolicy
    : isWorkflow
      ? 'exit'
      : 'stay';

/** Cheap, high-signal state for crash records. Must never throw. */
function getState() {
  const state = {
    proc,
    argv1: process.argv[1],
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
