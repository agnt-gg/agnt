/**
 * Reload every process that holds plugin code, and wait for all of them.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * This lived inside PluginRoutes.js, which meant only an HTTP request could
 * reach it. Plugin code is loaded in three places — the main process, the
 * orchestrator's tool registry, and the forked workflow child — so a plugin
 * that changes on disk without this running leaves all three executing the
 * OLD code until the app restarts.
 *
 * That was survivable while every update came from a button click, because the
 * route called this on the way out. It stops being survivable the moment
 * updates apply themselves in the background: the update lands, the registry
 * says v2, and the running app keeps executing v1 with nobody aware of the
 * split. "Updates just happen" is only true if they happen in memory too.
 *
 * Failure of any one process is reported, never thrown: a plugin that updated
 * on disk but failed to reload in the workflow child is a degraded state worth
 * logging, not a reason to fail the operation that got here.
 */

import PluginManager from './PluginManager.js';
import WorkflowProcessBridge from '../workflow/WorkflowProcessBridge.js';
import { reloadPluginTools as reloadOrchestratorPluginTools } from '../services/orchestrator/tools.js';

/**
 * @returns {Promise<{success: boolean, mainProcess: boolean, orchestrator: boolean, workflowProcess: boolean}>}
 */
export default async function reloadAllPlugins() {
  const results = {
    success: true,
    mainProcess: false,
    orchestrator: false,
    workflowProcess: false,
  };

  // Reload main process plugin manager
  try {
    await PluginManager.reload();
    results.mainProcess = true;
    console.log('[reloadAllPlugins] Main process plugin reload: success');
  } catch (error) {
    console.error('[reloadAllPlugins] Main process plugin reload failed:', error.message);
    results.success = false;
  }

  // Reload orchestrator and workflow process in parallel, but wait for both
  const [orchestratorResult, workflowResult] = await Promise.allSettled([
    reloadOrchestratorPluginTools(),
    WorkflowProcessBridge.reloadPlugins(),
  ]);

  if (orchestratorResult.status === 'fulfilled') {
    results.orchestrator = true;
    console.log('[reloadAllPlugins] Orchestrator plugin reload: success', orchestratorResult.value);
  } else {
    console.warn('[reloadAllPlugins] Orchestrator plugin reload failed:', orchestratorResult.reason?.message);
  }

  if (workflowResult.status === 'fulfilled') {
    results.workflowProcess = true;
    console.log('[reloadAllPlugins] Workflow process plugin reload: success', workflowResult.value);
  } else {
    console.warn('[reloadAllPlugins] Workflow process plugin reload failed:', workflowResult.reason?.message);
  }

  return results;
}
