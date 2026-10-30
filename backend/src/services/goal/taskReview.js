/**
 * The review prompt for ONE task of a goal.
 *
 * A goal is split into tasks; each task owns one share of the work, and its
 * description says what output proves that share is done (the planner is told
 * to write it that way). A task is therefore graded against its own
 * description. The goal's deliverables are shown to the grader only as
 * context: they are owned by the goal as a whole and are enforced once, by
 * the goal-level acceptance checklist, against the work of every task
 * together. Grading a task against the whole goal's deliverables rejects
 * every task that is not the last, so no multi-task goal could ever finish.
 *
 * Pure: the per-task checkpoint gate and the final goal evaluation both build
 * their prompt here, so they grade a task by the same bar.
 */

const list = (values) => (Array.isArray(values) ? values : [])
  .map((value) => String(typeof value === 'object' && value ? value.text ?? '' : value ?? '').trim())
  .filter(Boolean);

const bullets = (values) => (values.length ? values.map((value) => `- ${value}`).join('\n') : '- (none listed)');

export function taskReviewPrompt(task, taskOutput, goalCriteria) {
  const criteria = goalCriteria && typeof goalCriteria === 'object' ? goalCriteria : {};
  const description = String(task?.description ?? '').trim() || String(task?.title ?? '').trim();
  return `You are an expert evaluator deciding whether ONE task of a larger goal did its own job.

THE TASK (the only requirements this task is graded on):
Title: ${task?.title ?? ''}
Description: ${description}

TASK OUTPUT:
${JSON.stringify(taskOutput, null, 2)}

GOAL CONTEXT (background only, NOT requirements for this task):
This task is one step of a larger goal. Other tasks own the rest of the work, and the goal's deliverables are checked separately once every task has finished.
Goal deliverables:
${bullets(list(criteria.deliverables))}
Goal quality standards:
${bullets(list(criteria.qualityChecks))}

EVALUATION INSTRUCTIONS:
1. Derive the requirements from THE TASK's description only, including any statement of what output proves it is done (for example a "Done when" clause). Each requirement becomes one criterion.
2. Never fail this task for a goal deliverable its description does not assign to it. A deliverable that belongs to another step is not a defect of this one.
3. Apply a goal quality standard only where it bears on what this task produced (for example "every claim cites a source" applies to a research note this task wrote).
4. Provide a score from 0-100 for how well THIS task's requirements are met.
5. List each requirement as a Boolean in criteriaMet (true/false). Do not invent requirements. Explain optional suggestions in feedback, not as failed criteria. Mixed tool failures/successes require explaining whether the failed operation was actually recovered; an unrelated successful call is not recovery.
6. Review adversarially within the task's scope: look for every defect, gap or unsupported claim in what this task was asked to do. Any avoidable defect makes the criterion it affects false. Give no credit for intent, effort or plans, only for what the output shows.
7. needsInput: set it ONLY when a requirement is unmet because of a prerequisite that only the user can supply (a credential or sign-in, access rights, an account or plan, a tool or connection that is not installed, or a decision) AND the output shows concrete evidence of it (an authentication or permission error, a missing tool, an explicit refusal). "what" names exactly what the user must provide; "why" cites the evidence. Retrying or re-planning cannot supply such a prerequisite, so it is not a defect in the work. Otherwise needsInput is null, including for anything the task could have done itself.

Respond with ONLY a valid JSON object (no markdown, no extra text):
{
  "score": 85,
  "criteriaMet": {
    "requirement1": true,
    "requirement2": false
  },
  "feedback": "Detailed feedback explaining the evaluation",
  "strengths": ["What was done well"],
  "improvements": ["What could be improved"],
  "needsInput": null
}`;
}

const NEEDS_INPUT_MAX = 500;
const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, NEEDS_INPUT_MAX) : '');

/**
 * The grader's needs-input verdict, normalised: { what, why } or null.
 * Untrusted model output, so it is shape-checked and bounded; a verdict that
 * does not say WHAT the user must provide is no verdict.
 */
export function parseNeedsInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const what = oneLine(value.what);
  if (!what) return null;
  return { what, why: oneLine(value.why) };
}
