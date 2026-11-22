/**
 * Routine run history, the pure half. A run's output arrives from the server
 * as { tasks: [{ title, status, error, content, truncated, files }] }
 * (backend services/goal/runOutput.js). Runs from before that was kept have
 * none; for the newest run, the goal's tasks still hold its results, read
 * into the same shape here.
 */
import { parseServerTime } from '@/utils/serverTime.js';

function parseOutput(output) {
  if (output && typeof output === 'object') return output;
  if (typeof output !== 'string' || !output.trim()) return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' ? parsed : { content: output };
  } catch {
    return { content: output };
  }
}

/** The goal's top-level tasks, in plan order, as a run output. */
export function runOutputFromGoalTasks(tasks = []) {
  const ordered = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task && !task.parent_task_id)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return {
    tasks: ordered.map((task) => {
      const output = parseOutput(task.output);
      const files = Array.isArray(output?.files) ? output.files.map((f) => (typeof f === 'string' ? f : f?.name || f?.filename || f?.path)).filter(Boolean) : [];
      return { title: task.title || 'Untitled step', status: task.status || 'pending', error: task.error || null, content: typeof output?.content === 'string' ? output.content : '', truncated: false, files };
    }),
  };
}

/**
 * Whether the goal's tasks still hold this run's results: it is the newest run,
 * and no task has started since it fired (a later run would have reset them).
 */
export function goalTasksAreFromRun(run, newestRun, tasks = []) {
  if (!run || !newestRun || run.id !== newestRun.id) return false;
  const firedAt = parseServerTime(run.fired_at);
  return (Array.isArray(tasks) ? tasks : []).some((task) => parseServerTime(task.started_at) >= firedAt);
}

/** What a run waiting on you asks, in its own words; null for any other run. */
export function waitingQuestion(run) {
  if (run?.status !== 'needs_input') return null;
  return String(run.error || '').replace(/^Needs from you:\s*/i, '').trim() || 'It has a question for you.';
}

/** A run's result: its last step with something to read, preferring finished ones. Null when there is none. */
export function resultOf(output) {
  const tasks = (output?.tasks || []).filter((task) => task.content);
  return [...tasks].reverse().find((task) => task.status === 'completed') || tasks[tasks.length - 1] || null;
}

/** How a task in a run reads. */
export function taskTone(status) {
  if (status === 'completed') return { label: 'Done', tag: 'green' };
  if (status === 'failed' || status === 'error') return { label: 'Failed', tag: 'amber' };
  if (status === 'running' || status === 'in_progress') return { label: 'In progress', tag: 'blue' };
  return { label: 'Not run', tag: '' };
}
