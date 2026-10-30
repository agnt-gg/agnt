/**
 * A goal's acceptance checklist: the concrete, yes/no-checkable things the
 * finished work must satisfy. The planner writes it into
 * success_criteria.checklist; the evaluator checks every item against the
 * work; the reviewer signs off against the checked list.
 *
 * Pure functions only, so the planner, the evaluator and their tests share one
 * definition of what a checklist is.
 */

const MAX_ITEMS = 10;
const MAX_TEXT = 240;
const MAX_EVIDENCE = 400;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/**
 * The checklist for a goal's success criteria: the planner's explicit list
 * when present, otherwise derived from deliverables and quality checks so
 * goals planned before checklists existed still get one. Reviewer feedback
 * ("request changes") is appended as items of its own, so the work cannot
 * pass again until a grader shows the feedback was addressed.
 * @returns {{ id: string, text: string }[]}
 */
export function checklistOf(successCriteria, reviewerFeedback = [], maxItems = MAX_ITEMS) {
  const criteria = successCriteria && typeof successCriteria === 'object' ? successCriteria : {};
  const explicit = Array.isArray(criteria.checklist) ? criteria.checklist : null;
  const source = explicit?.length
    ? explicit
    : [...(Array.isArray(criteria.deliverables) ? criteria.deliverables : []), ...(Array.isArray(criteria.qualityChecks) ? criteria.qualityChecks : [])];
  const seen = new Set();
  const items = [];
  for (const entry of source) {
    const text = clean(typeof entry === 'object' && entry ? entry.text : entry);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push({ id: `c${items.length + 1}`, text });
    if (items.length === maxItems) break;
  }
  for (const entry of Array.isArray(reviewerFeedback) ? reviewerFeedback : []) {
    const text = clean(typeof entry === 'object' && entry ? entry.text : entry);
    if (text) items.push({ id: `c${items.length + 1}`, text: `Reviewer feedback addressed: ${text}` });
  }
  return items;
}

/**
 * What the finished goal is checked against: the planner's checklist plus every
 * goal deliverable it does not already name. Tasks are graded only on their own
 * share of the work, so this is the one place the goal's deliverables are
 * enforced. A planner checklist that omits a deliverable must not let it go
 * unchecked. Reviewer feedback stays last, as in checklistOf.
 * @returns {{ id: string, text: string }[]}
 */
export function acceptanceChecklistOf(successCriteria, reviewerFeedback = []) {
  const planned = checklistOf(successCriteria);
  const criteria = successCriteria && typeof successCriteria === 'object' ? successCriteria : {};
  const seen = new Set(planned.map((item) => item.text.toLowerCase()));
  const texts = planned.map((item) => item.text);
  let added = 0;
  for (const entry of Array.isArray(criteria.deliverables) ? criteria.deliverables : []) {
    const text = clean(typeof entry === 'object' && entry ? entry.text : entry);
    if (!text || seen.has(text.toLowerCase())) continue;
    if (added === MAX_ITEMS) break;
    seen.add(text.toLowerCase());
    texts.push(`Deliverable produced: ${text}`);
    added++;
  }
  return checklistOf({ checklist: texts }, reviewerFeedback, MAX_ITEMS * 2);
}

/** Keep the most recent reviewer requests; older ones are already in the work or superseded. */
export const MAX_REVIEWER_FEEDBACK = 5;
export function withReviewerFeedback(worldState, feedback, at = new Date().toISOString()) {
  const text = clean(feedback);
  const previous = Array.isArray(worldState?.reviewerFeedback) ? worldState.reviewerFeedback : [];
  return text ? [...previous, { text, at }].slice(-MAX_REVIEWER_FEEDBACK) : previous;
}

const EVIDENCE_PER_TASK = 6000;
const SUMMARY_CHARS = 1500;
const oneLine = (value, max) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const textOf = (content) => (Array.isArray(content)
  ? content.map((part) => (typeof part === 'string' ? part : part?.text || '')).filter(Boolean).join('\n')
  : String(content ?? ''));

/** What a tool call acted on: the path/url/query/command if it names one. */
function callTarget(args) {
  let parsed = args;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return oneLine(parsed, 140); } }
  if (!parsed || typeof parsed !== 'object') return '';
  for (const key of ['path', 'file_path', 'filePath', 'url', 'query', 'command', 'code', 'operation']) {
    if (parsed[key] != null) return `${key}=${oneLine(parsed[key], 160)}`;
  }
  return oneLine(parsed, 140);
}

/**
 * One task's evidence, bounded: its final summary, then one line per tool call
 * (tool, target, outcome). When the calls do not all fit, the first few and
 * the LAST ones are kept: the end of the work is where deliverables are
 * written and verified. Regression: the raw output JSON was cut to its first
 * 2500 characters, which always dropped the final calls, so the checklist
 * grader truthfully found "no evidence" and failed goals whose work was done.
 */
export function taskEvidence(tasks, perTask = EVIDENCE_PER_TASK) {
  return tasks
    .map((task, index) => {
      let output = task.output;
      if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* plain text output */ } }
      const header = `### Task ${index + 1}: ${task.title} [${task.status}]`;
      if (!output || typeof output !== 'object') return `${header}\n${String(output ?? '').slice(0, perTask)}`;
      const summary = textOf(output.content).trim().slice(0, SUMMARY_CHARS) || '(no summary)';
      const calls = (Array.isArray(output.toolExecutions) ? output.toolExecutions : []).map((call, n) =>
        `${n + 1}. ${call?.name || 'tool'}(${callTarget(call?.arguments)}) -> ${oneLine(call?.response ?? call?.result ?? '', 220)}`);
      const budget = Math.max(0, perTask - summary.length - header.length - 40);
      let lines = calls;
      if (calls.join('\n').length > budget) {
        const head = calls.slice(0, 3);
        const tail = [];
        let used = head.join('\n').length + 60;
        for (let i = calls.length - 1; i >= head.length && used + calls[i].length + 1 <= budget; i--) {
          tail.unshift(calls[i]);
          used += calls[i].length + 1;
        }
        const omitted = calls.length - head.length - tail.length;
        lines = [...head, ...(omitted > 0 ? [`… ${omitted} earlier call(s) omitted …`] : []), ...tail];
      }
      return `${header}\nSummary: ${summary}\nTool calls (${calls.length}):\n${lines.join('\n') || '(none)'}`;
    })
    .join('\n\n');
}

export function checklistPrompt(goal, checklist, tasks) {
  return `You are checking finished work against its acceptance checklist.

GOAL: ${goal.title}
${goal.description || ''}

CHECKLIST:
${checklist.map((item) => `${item.id}. ${item.text}`).join('\n')}

WORK PRODUCED:
${taskEvidence(tasks)}

For EVERY checklist item decide whether the work above demonstrably satisfies it.
Only mark an item met when the work shows it; missing evidence means not met.
Evidence is one short sentence naming what in the work shows it (or what is missing).

Respond with ONLY a JSON object, no markdown:
{"items":[{"id":"c1","met":true,"evidence":"..."}]}`;
}

/**
 * Parse the model's verdict strictly against the checklist it was given.
 * Unknown ids are ignored; an item the model skipped is reported as
 * unassessed (met: null), never silently as passed or failed.
 * @returns {{ id: string, text: string, met: boolean|null, evidence: string }[]}
 */
export function parseChecklistVerdict(raw, checklist) {
  let parsed = null;
  try {
    const text = String(raw ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?/g, '')
      .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    parsed = null;
  }
  const byId = new Map();
  for (const entry of Array.isArray(parsed?.items) ? parsed.items : []) {
    if (entry && typeof entry.id === 'string' && typeof entry.met === 'boolean') byId.set(entry.id, entry);
  }
  return checklist.map((item) => {
    const verdict = byId.get(item.id);
    return verdict
      ? { ...item, met: verdict.met, evidence: String(verdict.evidence || '').trim().slice(0, MAX_EVIDENCE) }
      : { ...item, met: null, evidence: 'Not assessed' };
  });
}
