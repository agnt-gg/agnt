import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  subscribe as subscribeSessionToken,
  getSessionToken,
  getSessionUserId,
} from '../services/auth/sessionTokenCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * The workflow process could not be reached, so nothing is known about the
 * workflow itself.
 *
 * This is deliberately distinct from an error the child process *answered*
 * with. `sendMessage` can fail two ways, and conflating them is what made a
 * workflow failure undiagnosable:
 *
 *   - TRANSPORT: the child was never spawned, is not ready, failed to
 *     initialise, or did not answer in time. We learned nothing. → this class.
 *   - REPLY: the child answered `{ success: false, error }`. That message is a
 *     real diagnosis of a real problem — e.g. "Workflow wf-1 cannot be
 *     executed: node "n1" is missing "text"". → a plain Error carrying it.
 *
 * Callers that need to tell these apart should check `error.code`, not the
 * message text.
 */
export class WorkflowProcessUnavailableError extends Error {
  /**
   * @param {string} message
   * @param {'not-spawned'|'not-ready'|'init-failed'|'timeout'} reason
   * @param {{ cause?: unknown }} [options] underlying error, where one exists
   */
  constructor(message, reason, options = {}) {
    // Keep the original failure attached. Three of the four reasons are
    // synthesised from a state check and have no cause, but 'init-failed'
    // wraps a real error — and dropping it would repeat the mistake this
    // whole change exists to fix.
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'WorkflowProcessUnavailableError';
    this.code = 'WORKFLOW_PROCESS_UNAVAILABLE';
    this.reason = reason;
  }
}

/**
 * True when the workflow process itself could not be reached.
 *
 * Kept as a predicate so callers never have to sniff message text — the route
 * handler used to test `error.message.includes('not ready')`, which matched
 * exactly one of the four transport failures and would silently stop matching
 * if the wording changed.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isWorkflowProcessUnavailable(error) {
  return Boolean(error) && error.code === 'WORKFLOW_PROCESS_UNAVAILABLE';
}

class WorkflowProcessBridge {
  constructor() {
    this.workflowProcess = null;
    this.messageHandlers = new Map();
    this.messageId = 0;
    this.isReady = false;
    this.statusUpdateListeners = [];
    this.readyPromise = null;
    // Single-flight guard: the 'exit' auto-restart and a manual restart can
    // both be in flight at once. Without this they each spawn a workflow
    // process and BOTH arm every trigger, double-firing every workflow.
    this.restartPromise = null;

    // ---------------------------------------------------------------------
    // CARRY THE SESSION TOKEN ACROSS THE FORK.
    //
    // The pollers (WebhookReceiver, EmailReceiver), workflow nodes and plugins
    // all run in the CHILD, and all call authHeader(). The token cache that
    // feeds authHeader() is in-memory and per-process, and it is written only
    // by the Express middleware in THIS process. So the child's copy was empty
    // forever, every background call to api.agnt.gg went out anonymous, and
    // webhook-auth adoption sat at exactly 0% of 205 observations — not slow
    // uptake, a number that could never move.
    //
    // Subscribing here rather than calling the bridge from Middleware keeps the
    // dependency pointing one way: the cache knows nothing about IPC, and the
    // request path cannot be broken by a transport failure.
    // ---------------------------------------------------------------------
    subscribeSessionToken(({ token, userId }) => {
      this.pushSessionToken(this.workflowProcess, token, userId);
    });
  }

  /**
   * Fire-and-forget the current session token to one child.
   *
   * Deliberately NOT routed through sendMessage(): that awaits readiness and
   * rejects when the child is down, and this is called from inside the request
   * path. A missing token degrades a background poll to anonymous — exactly
   * today's behaviour — whereas a throw here would fail a user's login.
   *
   * @param {import('child_process').ChildProcess|null} child
   */
  pushSessionToken(child, token = getSessionToken(), userId = getSessionUserId()) {
    if (!child || !token || !userId) return false;
    // `connected` is the only reliable guard; a child mid-exit still exists.
    if (!child.connected) return false;

    try {
      child.send({ type: 'SESSION_TOKEN', data: { token, userId } });
      return true;
    } catch (error) {
      console.warn('[WorkflowProcessBridge] could not forward session token:', error?.message);
      return false;
    }
  }

  spawn() {
    // Create a promise that resolves when the process is ready
    this.readyPromise = new Promise((resolve, reject) => {
      const workflowProcessPath = path.join(__dirname, './', 'WorkflowProcess.js');

      console.log('Spawning workflow process at:', workflowProcessPath);

      // Bind every handler below to THIS child, never to `this.workflowProcess`.
      // That field is reassigned by restart(); a handler that re-reads it later
      // acts on whatever process happens to be current at fire time, which is
      // how the force-kill timer used to SIGKILL its own replacement.
      const child = fork(workflowProcessPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          IS_WORKFLOW_PROCESS: 'true',
          // PRD-084-R2 §0.2: schema is fully initialized by the parent
          // before spawn() is called (server.js awaits dbReady), so the
          // child skips createTables/migrations/FTS setup entirely.
          AGNT_SKIP_DB_INIT: '1',
        },
      });
      this.workflowProcess = child;

      // Handle messages from workflow process
      child.on('message', (message) => {
        this.handleMessage(message);
      });

      // Handle process errors
      child.on('error', (error) => {
        console.error('Workflow process error:', error);
        if (this.workflowProcess === child) {
          this.isReady = false;
        }
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        console.log(`Workflow process exited with code ${code} and signal ${signal}`);

        // A superseded process dying must never clobber the state of the
        // healthy replacement that took its place.
        if (this.workflowProcess !== child) {
          console.log('Ignoring exit from superseded workflow process.');
          return;
        }
        this.isReady = false;

        // shutdown() tags the process it is deliberately tearing down, so a
        // planned teardown is never mistaken for a crash.
        if (child.__agntExpectedExit) {
          console.log('Workflow process exit was expected - not auto-restarting.');
          return;
        }

        // Signal deaths (SIGKILL/SIGTERM, OOM-killer, force-kill) report
        // code === null. The old guard `code !== 0 && code !== null` skipped
        // every one of them, so a killed workflow process never came back.
        const crashed = code !== 0 || signal !== null;
        if (!crashed) {
          return;
        }

        console.log(
          `Workflow process crashed (code=${code}, signal=${signal}). Restarting in 5 seconds...`
        );
        setTimeout(() => {
          this.restart().catch((err) => {
            console.error('Failed to restart workflow process:', err);
          });
        }, 5000);
      });

      // Handle stdout/stderr
      child.stdout.on('data', (data) => {
        console.log(`[Workflow Process]: ${data.toString().trim()}`);
      });

      child.stderr.on('data', (data) => {
        console.error(`[Workflow Process Error]: ${data.toString().trim()}`);
      });

      // Wait for ready message
      const readyTimeout = setTimeout(() => {
        reject(new Error('Workflow process failed to start within 30 seconds'));
      }, 30000);

      const readyHandler = (message) => {
        if (message.type === 'READY') {
          clearTimeout(readyTimeout);
          this.isReady = true;
          console.log('Workflow process is ready');

          // A respawned child starts with an empty cache. Without this, a crash
          // at 3am would silently drop every background call back to anonymous
          // until the user next touched the UI — and the token is 30-day, so
          // "next touched the UI" can be a very long time.
          if (this.pushSessionToken(child)) {
            console.log('[WorkflowProcessBridge] session token forwarded to workflow process');
          }

          resolve();
        }
      };

      child.once('message', readyHandler);
    });

    return this.readyPromise;
  }

  handleMessage(message) {
    // Handle status updates (broadcast to all listeners)
    if (message.type === 'STATUS_UPDATE') {
      const statusData = message.data.status || {};
      // Ensure userId is included in the status data
      if (message.data.userId && !statusData.userId) {
        statusData.userId = message.data.userId;
      }
      this.statusUpdateListeners.forEach((listener) => {
        listener(message.data.workflowId, statusData);
      });
      return;
    }

    // Handle response messages
    if (message.id !== undefined) {
      const handler = this.messageHandlers.get(message.id);
      if (handler) {
        this.messageHandlers.delete(message.id);

        if (message.success) {
          handler.resolve(message.data);
        } else {
          handler.reject(new Error(message.error || 'Unknown error'));
        }
      }
    }
  }

  async sendMessage(type, data, timeout = 30000) {
    // Wait for process to be ready before sending any messages
    if (!this.isReady && this.readyPromise) {
      try {
        await this.readyPromise;
      } catch (error) {
        return Promise.reject(
          new WorkflowProcessUnavailableError('Workflow process failed to initialize', 'init-failed', {
            cause: error,
          })
        );
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.workflowProcess) {
        return reject(
          new WorkflowProcessUnavailableError('Workflow process is not available', 'not-spawned')
        );
      }

      if (!this.isReady) {
        return reject(new WorkflowProcessUnavailableError('Workflow process is not ready', 'not-ready'));
      }

      const id = ++this.messageId;
      const message = {
        id,
        type,
        data,
        timestamp: Date.now(),
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(id);
        reject(
          new WorkflowProcessUnavailableError(`Message ${type} timed out after ${timeout}ms`, 'timeout')
        );
      }, timeout);

      // Store handler
      this.messageHandlers.set(id, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      // Send message
      this.workflowProcess.send(message);
    });
  }

  /**
   * Arm a workflow's triggers in the workflow process.
   *
   * Throws rather than reporting a start that did not happen.
   *
   * This used to `return { error: error.message }`. The route handler passes
   * whatever comes back straight to `res.json(result)`, and res.json with no
   * status is 200 — so a start that never happened answered SUCCESS with an
   * error-shaped body. All three callers gate on `response.ok`, which was true,
   * so the failure branch never ran and the UI reported the workflow started.
   * Nothing was armed, no trigger was listening, and the only trace was a
   * console.error in the backend log.
   *
   * @throws {WorkflowProcessUnavailableError} the process could not be reached
   * @throws {Error} the process answered, reporting this failure
   */
  async activateWorkflow(workflow, userId, triggerData = null) {
    try {
      const result = await this.sendMessage('ACTIVATE_WORKFLOW', {
        workflow,
        userId,
        triggerData,
      });
      return result;
    } catch (error) {
      console.error('Error activating workflow via IPC:', error);
      throw error;
    }
  }

  /**
   * Disarm a workflow's triggers in the workflow process.
   *
   * Throws for the same reason activateWorkflow does — a stop that did not
   * happen must not be reported as one. See deleteWorkflow in WorkflowService
   * for the one caller that deliberately continues past a failure here.
   *
   * @throws {WorkflowProcessUnavailableError} the process could not be reached
   * @throws {Error} the process answered, reporting this failure
   */
  async deactivateWorkflow(workflowId, userId) {
    try {
      const result = await this.sendMessage('DEACTIVATE_WORKFLOW', {
        workflowId,
        userId,
      });
      return result;
    } catch (error) {
      console.error('Error deactivating workflow via IPC:', error);
      throw error;
    }
  }

  /**
   * Ask the workflow process for a workflow's live state.
   *
   * Throws rather than reporting a state it does not know.
   *
   * This used to `return { status: 'error', error: error.message }`, which was
   * wrong twice over. `'error'` is a REAL workflow status — ProcessWorker sets
   * it on a workflow whose engine failed, and ProcessManager reads it back out
   * of the database — so "I could not reach the workflow process" and "this
   * workflow failed" were reported with the identical value, and no caller
   * could tell them apart. Callers testing
   * `['running','listening','queued'].includes(status)` then quietly took the
   * not-active branch on what was really an infrastructure failure.
   *
   * It also discarded the child's own diagnosis. When the child answers
   * `{ success: false, error }` that message names the actual fault — e.g.
   * `Workflow wf-1 cannot be executed: node "n1" is missing "text"` — and it
   * was replaced by the single word `error` before any caller saw it.
   *
   * Log-and-rethrow matches restartActiveWorkflows below. All three callers
   * already sit inside a try/catch.
   *
   * @throws {WorkflowProcessUnavailableError} the process could not be reached
   * @throws {Error} the process answered, reporting this failure
   */
  async fetchWorkflowState(workflowId, userId) {
    try {
      const result = await this.sendMessage('FETCH_WORKFLOW_STATE', {
        workflowId,
        userId,
      });
      return result;
    } catch (error) {
      console.error('Error fetching workflow state via IPC:', error);
      throw error;
    }
  }

  async restartActiveWorkflows() {
    try {
      const result = await this.sendMessage('RESTART_ACTIVE_WORKFLOWS', {}, 60000);
      return result;
    } catch (error) {
      console.error('Error restarting active workflows via IPC:', error);
      throw error;
    }
  }

  /**
   * Reload plugins in the workflow process
   * Called after plugin install/uninstall to update the running process
   */
  async reloadPlugins() {
    try {
      console.log('[WorkflowProcessBridge] Requesting plugin reload...');
      const result = await this.sendMessage('RELOAD_PLUGINS', {}, 30000);
      console.log('[WorkflowProcessBridge] Plugin reload result:', result);
      return result;
    } catch (error) {
      console.error('Error reloading plugins via IPC:', error);
      return { success: false, error: error.message };
    }
  }

  onStatusUpdate(listener) {
    this.statusUpdateListeners.push(listener);
  }

  async shutdown() {
    // Pin the process we are tearing down. Re-reading this.workflowProcess
    // inside the timer let the force-kill land on a replacement spawned by
    // restart() ~1.6s later, SIGKILLing a healthy process.
    const proc = this.workflowProcess;
    if (!proc) {
      return;
    }

    console.log('Shutting down workflow process...');

    // Tag BEFORE any await so an immediate exit is still classified as planned.
    proc.__agntExpectedExit = true;

    // Force kill if still running after 5 seconds. Closes over `proc`, so it
    // can only ever target the process this call was asked to shut down.
    const forceKill = setTimeout(() => {
      if (!proc.killed) {
        console.log('Force killing workflow process...');
        proc.kill('SIGKILL');
      }
    }, 5000);

    // Register the cancel BEFORE awaiting: if the child exits while the
    // SHUTDOWN round-trip is in flight, a listener attached afterwards would
    // miss the already-emitted event and leave the timer armed.
    proc.once('exit', () => clearTimeout(forceKill));
    if (proc.exitCode !== null || proc.signalCode !== null) {
      clearTimeout(forceKill);
    }

    try {
      await this.sendMessage('SHUTDOWN', {}, 10000);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
    }
  }

  /**
   * Single-flight restart. Concurrent callers join the in-flight attempt
   * instead of spawning a second workflow process that would re-arm every
   * trigger a second time.
   */
  async restart() {
    if (this.restartPromise) {
      console.log('Workflow process restart already in progress - joining it.');
      return this.restartPromise;
    }

    this.restartPromise = this._performRestart().finally(() => {
      this.restartPromise = null;
    });

    return this.restartPromise;
  }

  async _performRestart() {
    console.log('Restarting workflow process...');

    if (this.workflowProcess) {
      await this.shutdown();
    }

    // Clear state
    this.messageHandlers.clear();
    this.isReady = false;
    this.workflowProcess = null;
    this.readyPromise = null;

    // Spawn new process
    await this.spawn();

    // Restart active workflows
    await this.restartActiveWorkflows();

    console.log('Workflow process restarted successfully');
  }
}

// Export singleton instance
export default new WorkflowProcessBridge();
