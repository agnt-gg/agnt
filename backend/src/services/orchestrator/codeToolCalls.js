import db from '../../models/database/index.js';
import AgentExecutionModel from '../../models/AgentExecutionModel.js';

/** Header carried by agnt.tool() calls: the run whose script made the call. */
export const PARENT_RUN_HEADER = 'x-agnt-parent-execution';

/** The id of this user's run with that id, or null. */
function findRun(executionId, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM agent_executions WHERE id = ? AND user_id = ?', [executionId, userId], (err, row) =>
      err ? reject(err) : resolve(row?.id || null)
    );
  });
}

function parseResult(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Runs one tool call for the tools route. When the call names one of the
 * user's runs, it is recorded under that run like any other tool call of the
 * run, and `run` receives the run id so the tool sees it too. Recording is
 * best-effort: a failed write is logged and never fails the call.
 *
 * @param {object} call
 * @param {string} call.toolName
 * @param {object} call.args
 * @param {string} call.userId
 * @param {string|null} call.parentExecutionId
 * @param {(runId: string|null) => Promise<any>} call.run  executes the tool
 * @returns {Promise<any>} the tool's result, parsed when it is JSON
 */
export async function runToolCall({ toolName, args, userId, parentExecutionId, run }) {
  let runId = null;
  if (parentExecutionId && userId) {
    try {
      runId = await findRun(String(parentExecutionId), userId);
    } catch (error) {
      console.warn('[ToolsRoutes] Could not look up the parent run:', error.message);
    }
  }

  let recordId = null;
  if (runId) {
    try {
      recordId = await AgentExecutionModel.createToolExecution(runId, toolName, null, args);
    } catch (error) {
      console.warn('[ToolsRoutes] Could not record the tool call:', error.message);
    }
  }

  const finish = async (status, output, error) => {
    if (!recordId) return;
    try {
      await AgentExecutionModel.updateToolExecution(recordId, status, output, error);
    } catch (writeError) {
      console.warn('[ToolsRoutes] Could not record the tool result:', writeError.message);
    }
  };

  let result;
  try {
    result = parseResult(await run(runId));
  } catch (error) {
    await finish('failed', null, error.message);
    throw error;
  }

  const failed = Boolean(result) && typeof result === 'object' && result.success === false;
  await finish(failed ? 'failed' : 'completed', result, failed ? String(result.error || 'Tool execution failed') : null);
  return result;
}
