/**
 * What one routine run produced, kept with its schedule_runs row. A goal's
 * tasks are reset at the start of every run, so without this record only the
 * newest run's results exist anywhere.
 *
 * Bounded on purpose: each task's readable result (output.content), capped,
 * plus the names of files it wrote. Tool transcripts are left out; they are
 * most of a task's output and are not what a person reads back.
 */
export const RUN_OUTPUT_CONTENT_LIMIT = 12_000;
const FILE_LIMIT = 20;

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

function fileName(file) {
  if (typeof file === 'string') return file;
  return file?.name || file?.filename || file?.path || null;
}

/** One task's part of the record. */
function taskRecord(task) {
  const output = parseOutput(task.output);
  const content = typeof output?.content === 'string' ? output.content : '';
  const files = (Array.isArray(output?.files) ? output.files : []).map(fileName).filter(Boolean).slice(0, FILE_LIMIT);
  return {
    title: task.title || 'Untitled step',
    status: task.status || 'pending',
    error: task.error || null,
    content: content.slice(0, RUN_OUTPUT_CONTENT_LIMIT),
    truncated: content.length > RUN_OUTPUT_CONTENT_LIMIT,
    files,
  };
}

/** The record for a run, from the goal's tasks as the run left them, in plan order. */
export function summarizeRunOutput(tasks = []) {
  const ordered = [...(Array.isArray(tasks) ? tasks : [])]
    .filter((task) => !task.parent_task_id)
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return { tasks: ordered.map(taskRecord) };
}
