/**
 * One line for a group of tool steps — Simple's "Done · 12 steps".
 *
 * Studio shows every tool call as its own row. Simple shows this line and
 * opens the same rows on click, so nothing is hidden, only folded. The line
 * must never claim more than the rows say: a group with a failure is not
 * "Done", and a group still running is not finished.
 *
 * Input: [{ status, name }] where status is MessageItem.toolCallStatus().
 */

/** 'web_search' / 'webSearch' / 'agnt.web-search' → 'Web search'. */
export function humanizeToolName(name) {
  const base = String(name || '')
    .split(/[.:/]/)
    .pop()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Step';
}

const plural = (n) => `${n} step${n === 1 ? '' : 's'}`;

export function summarizeSteps(steps) {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const n = list.length;
  if (!n) return { state: 'done', text: 'No steps' };

  const live = list.find((s) => s.status === 'running') || list.find((s) => s.status === 'pending');
  if (live) return { state: 'running', text: `Working · ${humanizeToolName(live.name)}` };

  const failed = list.filter((s) => s.status === 'error').length;
  if (failed) return { state: 'error', text: `${plural(n)} · ${failed} failed` };

  if (list.some((s) => s.status === 'interrupted')) return { state: 'stopped', text: `Stopped · ${plural(n)}` };

  return { state: 'done', text: `Done · ${plural(n)}` };
}
