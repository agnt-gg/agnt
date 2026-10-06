/**
 * One line for a group of tool steps — Focused's "Done · 12 steps".
 *
 * Studio shows every tool call as its own row. Focused shows this line and
 * opens the same rows on click, so nothing is hidden, only folded. A group
 * still running is not finished, and a stopped one is not done.
 *
 * A step that errored does not make the group a failure. Errors are routine
 * (a 404 probed, a retry, a fallback taken) and the agent usually carries on
 * and succeeds; a red failure mark on the whole group read as "this all went
 * wrong". The count stays, neutrally worded, and each row keeps its own
 * status for whoever opens the group.
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

  if (list.some((s) => s.status === 'interrupted')) return { state: 'stopped', text: `Stopped · ${plural(n)}` };

  const errors = list.filter((s) => s.status === 'error').length;
  const note = errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : '';
  return { state: 'done', text: `Done · ${plural(n)}${note}` };
}
