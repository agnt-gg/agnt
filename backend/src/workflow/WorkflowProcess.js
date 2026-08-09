import 'dotenv/config';
// Self-configures as proc:'workflow' via IS_WORKFLOW_PROCESS.
import '../diagnostics/bootstrap.js';
import { dbReady } from '../models/database/index.js';

// PRD-122: this process prices workflow-node LLM calls at record time, but it
// never serves a model picker, so its in-memory pricing cache would otherwise
// stay empty forever and every openrouter/custom-provider call would be
// recorded with an unknown cost. Hydrate what other processes have learned;
// the write-through hook keeps anything learned here shared back.
dbReady.then(async () => {
  try {
    const { initModelMetadataPersistence } = await import('../services/ai/modelMetadataPersistence.js');
    await initModelMetadataPersistence();
  } catch (err) {
    console.error('[WorkflowProcess] model metadata hydration failed (pricing degrades to unknown):', err?.message);
  }
});
import ProcessManager from './ProcessManager.js';
import PluginInstaller from '../plugins/PluginInstaller.js';
import PluginManager from '../plugins/PluginManager.js';
import { rememberSessionToken } from '../services/auth/sessionTokenCache.js';

console.log('Workflow process starting...');
console.log(`Workflow process ID: ${process.pid}`);

// Track if we're shutting down
let isShuttingDown = false;

// Resolves when the plugin system has finished initializing. Any IPC handler
// that arms triggers (ACTIVATE_WORKFLOW, RESTART_ACTIVE_WORKFLOWS) MUST await
// this first — plugin triggers (discord, slack, ...) only exist in
// ToolConfig.triggers after PluginManager.initialize() completes. Restoring
// workflows before that silently drops every plugin trigger on restart.
let pluginsReady = Promise.resolve();

/**
 * Safe IPC send function that checks connection status and handles errors
 * @param {Object} message - The message to send to the parent process
 * @returns {boolean} - True if message was sent successfully, false otherwise
 */
function safeSend(message) {
  if (!process.connected) {
    console.warn('[WorkflowProcess] IPC channel disconnected, cannot send message');
    return false;
  }
  if (!process.send) {
    console.warn('[WorkflowProcess] process.send not available (not a child process?)');
    return false;
  }
  try {
    process.send(message);
    return true;
  } catch (err) {
    console.warn('[WorkflowProcess] IPC send failed:', err.message);
    return false;
  }
}

// Initialize plugins for the workflow process
async function initializePlugins() {
  console.log('[WorkflowProcess] Initializing plugin system...');

  try {
    // Install plugin dependencies
    const installResult = await PluginInstaller.installAllPlugins();
    console.log('[WorkflowProcess] Plugin installation result:', installResult);

    // Initialize plugin manager
    await PluginManager.initialize();
    console.log('[WorkflowProcess] Plugin manager initialized');

    const stats = PluginManager.getStats();
    console.log('[WorkflowProcess] Plugin stats:', stats);
  } catch (error) {
    console.error('[WorkflowProcess] Plugin initialization error (non-fatal):', error);
    // Continue - plugins are optional
  }
}

// Initialize ProcessManager
async function initializeWorkflowProcess() {
  try {
    console.log('Initializing workflow process...');

    // Set up IPC message handlers FIRST
    setupIPCHandlers();

    // Wait for database tables and migrations to complete before accepting work.
    // This prevents SQLITE_BUSY errors when restartActiveWorkflows() fires
    // while migrations are still running.
    console.log('[WorkflowProcess] Waiting for database initialization...');
    await dbReady;
    console.log('[WorkflowProcess] Database ready');

    // Send ready message to parent AFTER database is initialized
    safeSend({ type: 'READY' });
    console.log('Workflow process ready (plugins loading in background)...');

    // Initialize plugins in background — READY is still sent immediately so
    // the parent doesn't block on npm installs, but trigger-arming handlers
    // gate on pluginsReady (see above). initializePlugins() never rejects
    // (it catches internally), so this promise always settles.
    pluginsReady = initializePlugins();

    console.log('Workflow process initialized');
  } catch (error) {
    console.error('Error initializing workflow process:', error);
    process.exit(1);
  }
}

// Set up IPC message handlers
function setupIPCHandlers() {
  process.on('message', async (message) => {
    try {
      const { id, type, data } = message;

      // Only log non-frequent IPC messages (skip FETCH_WORKFLOW_STATE spam)
      if (type !== 'FETCH_WORKFLOW_STATE') {
        console.log(`[Workflow Process]: Received IPC message: ${type} (id: ${id})`);
      }

      // ---------------------------------------------------------------------
      // THE CREDENTIAL FOR EVERYTHING THIS PROCESS DOES ON THE USER'S BEHALF.
      //
      // This process owns the pollers, the workflow nodes and the plugins, and
      // every one of them calls authHeader() from the session token cache. That
      // cache is in-memory and per-process, and only the parent's Express
      // middleware writes to it — so without this message the copy in here is
      // empty for the life of the process and every outbound call to
      // api.agnt.gg is anonymous.
      //
      // Handled before the switch and returned early: it carries no `id`, so
      // there is no reply to make, and answering would put a response with an
      // undefined id on the wire for the parent to discard.
      // ---------------------------------------------------------------------
      if (type === 'SESSION_TOKEN') {
        rememberSessionToken(data?.token, data?.userId);
        return;
      }

      let result;
      let success = true;
      let error = null;

      switch (type) {
        case 'ACTIVATE_WORKFLOW':
          result = await handleActivateWorkflow(data);
          break;

        case 'DEACTIVATE_WORKFLOW':
          result = await handleDeactivateWorkflow(data);
          break;

        case 'FETCH_WORKFLOW_STATE':
          result = await handleFetchWorkflowState(data);
          break;

        case 'RESTART_ACTIVE_WORKFLOWS':
          result = await handleRestartActiveWorkflows();
          break;

        case 'SHUTDOWN':
          result = await handleShutdown();
          break;

        case 'RELOAD_PLUGINS':
          result = await handleReloadPlugins();
          break;

        default:
          success = false;
          error = `Unknown message type: ${type}`;
      }

      // Send response back to parent
      safeSend({
        id,
        success,
        data: result,
        error,
      });
    } catch (err) {
      console.error('Error handling IPC message:', err);
      safeSend({
        id: message.id,
        success: false,
        error: err.message,
      });
    }
  });
}

// Handle workflow activation
async function handleActivateWorkflow(data) {
  const { workflow, userId, triggerData } = data;
  console.log(`Activating workflow ${workflow.id} for user ${userId}`);

  // Plugin triggers are only registered once plugin init completes.
  await pluginsReady;

  const result = await ProcessManager.activateWorkflow(workflow, userId, triggerData);
  return result;
}

// Handle workflow deactivation
async function handleDeactivateWorkflow(data) {
  const { workflowId, userId } = data;
  console.log(`Deactivating workflow ${workflowId} for user ${userId}`);

  const result = await ProcessManager.deactivateWorkflow(workflowId, userId);
  return result;
}

// Handle workflow state fetch
async function handleFetchWorkflowState(data) {
  const { workflowId, userId } = data;
  // Quiet - this is called frequently by the frontend
  const result = await ProcessManager.fetchWorkflowState(workflowId, userId);
  return result;
}

// Handle restart active workflows
async function handleRestartActiveWorkflows() {
  console.log('Restarting active workflows...');

  // CRITICAL: wait for plugin triggers to be registered in ToolConfig.triggers
  // before restoring workflows. Without this, every plugin-based trigger
  // (discord, slack, ...) fails to arm on app restart and dies silently.
  await pluginsReady;
  console.log('[WorkflowProcess] Plugins ready — restoring active workflows');

  await ProcessManager.restartActiveWorkflows();
  return { message: 'Active workflows restart initiated' };
}

// Handle plugin reload (called when plugins are installed/uninstalled)
async function handleReloadPlugins() {
  console.log('[WorkflowProcess] Reloading plugins...');

  try {
    // Re-initialize plugin manager to pick up new plugins
    await PluginManager.reload();

    const stats = PluginManager.getStats();
    console.log('[WorkflowProcess] Plugins reloaded:', stats);

    return {
      success: true,
      message: 'Plugins reloaded successfully',
      stats,
    };
  } catch (error) {
    console.error('[WorkflowProcess] Plugin reload error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Handle graceful shutdown
async function handleShutdown() {
  if (isShuttingDown) {
    return { message: 'Already shutting down' };
  }

  isShuttingDown = true;
  console.log('Workflow process shutting down gracefully...');

  try {
    // Release all resources
    ProcessManager.releaseResources();

    console.log('Workflow process shutdown complete');
    return { message: 'Shutdown complete' };
  } catch (error) {
    console.error('Error during shutdown:', error);
    throw error;
  } finally {
    // Exit after a short delay to allow response to be sent
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}

// Set up ProcessManager event listeners to forward status updates
ProcessManager.on('workflowStatusUpdate', (workflowId, statusData) => {
  // Send status update to parent process using safe send
  safeSend({
    type: 'STATUS_UPDATE',
    data: {
      workflowId,
      status: statusData,
      userId: statusData.userId,
    },
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in workflow process:', error);
  // Don't exit - let the parent process handle restart if needed
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in workflow process at:', promise, 'reason:', reason);
  // Don't exit - let the parent process handle restart if needed
});

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage().heapUsed / 1024 / 1024;
  console.log(`[Workflow Process] Memory usage: approximately ${Math.round(used * 100) / 100} MB`);
}, 60 * 1000); // Every 60 seconds

// Start the workflow process
initializeWorkflowProcess();
