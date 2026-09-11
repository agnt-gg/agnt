/** Negative evidence only. Passing this gate permits evaluation; it is not an
 * artifact verifier and never grants execution authority or permission to retry.
 */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const score = value => Number.isFinite(value) && value >= 70 && value <= 100;
function toolResult(execution) {
  let value = execution?.response;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  return record(value) ? value : null;
}
export function taskFailureReason(response) {
  if (!record(response)) return 'Missing task response';
  if (['blocked','failed','incomplete'].includes(response.outcome)) return 'Stored task outcome is incomplete';
  if (response.success === false || response.error || ['blocked','failed','error','incomplete'].includes(response.status)) return 'Task reported failure or blocked execution';
  const content = typeof response.content === 'string' ? response.content : '';
  const opening = content.trim().split('\n').find(line => line.trim()) || '';
  // Explicit status syntax only: historical prose like "Failed initially, then
  // succeeded" and quoted examples are not declarations of current failure.
  if (/^(?:#{1,6}\s*)?(?:\*\*)?Status\s*:\s*(?:\*\*)?(?:blocked|failed|incomplete)\b/i.test(opening)) return 'Task reported blocked or incomplete execution';
  if (/^(?:#{1,6}\s*)?Hard-blocker handoff\b/i.test(opening)) return 'Task reported a hard blocker';
  const executions = response.tool_executions ?? response.toolExecutions ?? [];
  if (!Array.isArray(executions)) return 'Malformed task execution evidence';
  const results = executions.map(toolResult);
  // Catch the clearest counterexample without inventing causal recovery links:
  // mixed success/failure traces go to the task evaluator, not a blanket pass.
  if (results.length && results.every(result => result && (result.success === false || result.error || result.status === 'failed'))) return 'All recorded tool operations failed; completion requires review';
  if (!content.trim() && !executions.length) return 'Task returned no output';
  return null;
}

/** Closed, total decision with reason codes for UI/reporting and test receipts. */
export function assessGoalCompletion(evaluation, tasks, evaluationFailed = false) {
  const reject = (code, taskId = null) => ({passed:false,code,taskId});
  if (evaluationFailed || !record(evaluation)) return reject('EVALUATION_UNAVAILABLE');
  if (!Array.isArray(tasks) || !tasks.length || tasks.some(t => !record(t) || typeof t.id !== 'string' || !t.id)) return reject('TASK_SET_INVALID');
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) return reject('TASK_SET_INVALID');
  const entries = evaluation.taskEvaluations;
  if (!Array.isArray(entries) || entries.length !== tasks.length || entries.some(e => !record(e))) return reject('EVALUATION_COVERAGE');
  if (new Set(entries.map(e => e.taskId)).size !== tasks.length) return reject('EVALUATION_COVERAGE');
  for (const task of tasks) {
    const entry = entries.find(e => e.taskId === task.id);
    if (!entry) return reject('EVALUATION_COVERAGE',task.id);
    if (task.status !== 'completed' || task.error) return reject('TASK_NOT_COMPLETED',task.id);
    try {
      const output = typeof task.output === 'string' ? JSON.parse(task.output) : task.output;
      if (taskFailureReason(output)) return reject('TASK_OUTPUT_REJECTED',task.id);
    } catch { return reject('TASK_OUTPUT_INVALID',task.id); }
    if (!score(entry.score)) return reject('TASK_SCORE_REJECTED',task.id);
    const criteria = entry.criteriaMet;
    if (!record(criteria) || !Object.keys(criteria).length || Object.values(criteria).some(v => typeof v !== 'boolean')) return reject('CRITERIA_INVALID',task.id);
    if (criteria.error === true || criteria.evaluated === false) return reject('EVALUATION_UNAVAILABLE',task.id);
    const substantive = Object.entries(criteria).filter(([key]) => !['error','evaluated'].includes(key));
    if (!substantive.length || substantive.some(([,met]) => met !== true)) return reject('CRITERIA_UNMET',task.id);
  }
  if (evaluation.passed !== true || !score(evaluation.scores?.overall)) return reject('AGGREGATE_REJECTED');
  return {passed:true,code:'ACCEPTED',taskId:null};
}
export function goalEvaluationPasses(evaluation, tasks, evaluationFailed = false) {
  return assessGoalCompletion(evaluation,tasks,evaluationFailed).passed;
}
