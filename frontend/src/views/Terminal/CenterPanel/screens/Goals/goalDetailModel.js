// The overview is an excerpt of recorded work, never a generated success claim.
// Full task text and files remain available on demand.
export function briefText(value, limit = 280) {
  const text = String(value || '').slice(0, OUTPUT_LIMIT)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const boundary = clipped.lastIndexOf(' ');
  return (boundary > limit * .6 ? clipped.slice(0, boundary) : clipped) + '…';
}

// Statuses where the goal is waiting on the person reviewing it.
const AWAITING_REVIEW = ['needs_review', 'failed', 'error', 'stopped'];

/** True when a task failed or carries an error the reviewer should read. */
export function taskNeedsAttention(task = {}) {
  return task?.status === 'failed' || Boolean(task?.error);
}

/**
 * Why the goal is waiting on the reviewer, in one sentence, from the run's
 * own record. Empty when it is not waiting.
 */
export function goalStopReason(goal = {}) {
  if (!AWAITING_REVIEW.includes(goal?.status)) return '';
  if (goal.status === 'needs_review') {
    if (goal.loop_status === 'needs_input') return 'This goal is waiting for something only you can provide.';
    if (goal.loop_status === 'max_iterations') {
      const attempts = Number(goal.max_iterations) > 0 ? `all ${goal.max_iterations}` : 'all its';
      return `This goal used ${attempts} attempts without passing its automatic review.`;
    }
    if (goal.loop_status === 'stuck') return 'This goal stopped because each new plan repeated the last one.';
    return 'This goal finished without passing its automatic review. Check the result, then approve it or request changes.';
  }
  if (goal.status === 'stopped') return 'This goal was stopped before it finished.';
  return 'This goal stopped on an error.';
}

/**
 * What the reviewer has to act on: each thing the run asked for, then each
 * failed task it did not ask about, with the recorded reason. Only while the
 * goal is waiting on review.
 * @returns {Array<{key:string, kind:'ask'|'failed', title:string, text:string}>}
 */
export function goalReviewItems(goal = {}, tasks = []) {
  if (!AWAITING_REVIEW.includes(goal?.status)) return [];
  const asks = Array.isArray(goal.world_state?.needsInput) ? goal.world_state.needsInput : [];
  const items = asks.map((ask, index) => ({
    key: 'ask:' + (ask.taskId || index),
    kind: 'ask',
    title: ask.title || 'A task',
    text: briefText([ask.what, ask.why].filter(Boolean).join(' Why: '), 600),
  }));
  const asked = new Set(asks.map((ask) => ask.taskId).filter(Boolean));
  for (const [index, task] of tasks.entries()) {
    if (task?.status !== 'failed' || asked.has(task.id)) continue;
    const reason = String(task.error || 'It failed without a recorded reason.').replace(/^Did not pass review \([A-Z_]+\):\s*/, 'Did not pass review: ');
    items.push({ key: 'failed:' + (task.id || index), kind: 'failed', title: task.title || 'Untitled task', text: briefText(reason, 600) });
  }
  return items;
}

/** One line under a task's title: its output, else its error, else what it will do. */
export function taskPreview(task = {}, limit = 180) {
  return briefText(taskOutputText(task?.output) || task?.error || task?.description || '', limit);
}

export function goalResultText(tasks = []) {
  for (let index = tasks.length - 1; index >= 0; index--) {
    if (tasks[index]?.status !== 'completed') continue;
    const text = taskOutputText(tasks[index].output);
    if (text.trim()) return text;
  }
  return '';
}

export const OUTPUT_LIMIT = 50_000;

/**
 * The answer in a huge stored output, read without parsing the whole tree.
 * Task outputs are stored as {"content": "...", "toolExecutions": [...], ...}
 * with content first, so only that one JSON string literal is scanned.
 * Null when the text does not start that way.
 */
function leadingContent(text) {
  const opening = /^\s*\{\s*"content"\s*:\s*"/.exec(text);
  if (!opening) return null;
  const start = opening[0].length - 1;
  let escaped = false;
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '"') {
      try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

export function taskOutputText(output) {
  let parsed = output;
  if (typeof output === 'string') {
    // Huge payloads remain available through BoundedJson without parsing a
    // multi-megabyte tree just to show a small preview.
    if (output.length > 200_000) return (leadingContent(output) ?? output).slice(0, OUTPUT_LIMIT);
    try { parsed = JSON.parse(output); } catch { return output.slice(0, OUTPUT_LIMIT); }
  }
  let remaining = OUTPUT_LIMIT;
  const parts = [];
  function visit(value, depth = 0) {
    if (depth > 12 || remaining <= 0) return;
    if (typeof value === 'string') {
      const text = value.slice(0, remaining); parts.push(text); remaining -= text.length;
    } else if (Array.isArray(value)) {
      for (const child of value) { visit(child, depth + 1); if (!remaining) break; }
    } else if (value && typeof value === 'object') {
      if (['thinking', 'redacted_thinking', 'tool_use', 'tool_result'].includes(value.type)) return;
      const text = value.content ?? value.text ?? value.response ?? value.result;
      if (text !== value) visit(text, depth + 1);
    }
  }
  visit(parsed);
  return parts.join('\n\n').slice(0, OUTPUT_LIMIT);
}
