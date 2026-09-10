/** Negative evidence only: never treat this classifier as proof of task success. */
export function taskFailureReason(response) {
  if (!response || typeof response !== 'object') return 'Missing task response';
  if (['blocked','failed','incomplete'].includes(response.outcome)) return 'Stored task outcome is incomplete';
  if (response.success === false || response.error || ['blocked','failed','error','incomplete'].includes(response.status)) return 'Task reported failure or blocked execution';
  const content = typeof response.content === 'string' ? response.content : '';
  // Legacy workers predate structured outcomes. Only inspect their opening status,
  // not arbitrary quoted examples or a historical failure elsewhere in a report.
  const opening = content.trim().split('\n').find(line => line.trim()) || '';
  if (/^(?:#{1,6}\s*)?(?:\*\*)?(?:status\s*:\s*)?(?:blocked|failed|incomplete)\b/i.test(opening)) return 'Task reported blocked or incomplete execution';
  if (/^(?:#{1,6}\s*)?Hard-blocker handoff\b/i.test(opening)) return 'Task reported a hard blocker';
  if (!content.trim() && !(response.tool_executions?.length)) return 'Task returned no output';
  return null;
}
export function goalEvaluationPasses(evaluation, tasks, evaluationFailed = false) {
  const entries = evaluation?.taskEvaluations;
  if (!Array.isArray(entries) || entries.length !== tasks.length || new Set(entries.map(e=>e.taskId)).size !== tasks.length) return false;
  if (!tasks.every(t => entries.some(e => e.taskId === t.id && Number.isFinite(e.score) && e.criteriaMet && typeof e.criteriaMet === 'object' && !Array.isArray(e.criteriaMet) && Object.keys(e.criteriaMet).length))) return false;
  return !evaluationFailed && !(evaluation?.taskEvaluations || []).some(t => t.criteriaMet?.error === true || t.criteriaMet?.evaluated === false) && evaluation?.passed === true && Number.isFinite(evaluation.scores?.overall)
    && evaluation.scores.overall >= 70 && tasks.length > 0
    && tasks.every(task => task.status === 'completed' && !task.error && (() => {
      try { const output = typeof task.output === 'string' ? JSON.parse(task.output) : task.output;
        return output && !taskFailureReason({...output,tool_executions:output.toolExecutions || output.tool_executions});
      } catch { return false; }
    })());
}
