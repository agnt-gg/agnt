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
 * goals planned before checklists existed still get one.
 * @returns {{ id: string, text: string }[]}
 */
export function checklistOf(successCriteria) {
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
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

/** Text of each task's result, bounded so one huge output cannot crowd the rest out. */
function taskEvidence(tasks, perTask = 2500) {
  return tasks
    .map((task, index) => {
      let output = task.output;
      if (typeof output !== 'string') output = JSON.stringify(output ?? null);
      return `### Task ${index + 1}: ${task.title} [${task.status}]\n${String(output).slice(0, perTask)}`;
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
