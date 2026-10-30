// checkpointCards — which tool calls render as a task checkpoint card.
//
// Annie posts a checkpoint with task_checkpoint { kind, title, content } and
// waits (backend services/TaskCheckpoints.js). Its tool result carries the
// checkpoint id; the card loads the live checkpoint by that id, so a decision
// made in another window shows here too. Before the result arrives the card
// is not drawn: there is nothing to approve yet.

export const CHECKPOINT_TOOL = 'task_checkpoint';

function parse(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** `{ id, kind, title }` for a completed task_checkpoint call, else null. */
export function checkpointTarget(toolCall) {
  if (!toolCall || toolCall.name !== CHECKPOINT_TOOL) return null;
  const result = parse(toolCall.result);
  const checkpoint = result?.success ? result.checkpoint : null;
  if (!checkpoint || typeof checkpoint.id !== 'string' || !checkpoint.id) return null;
  return { id: checkpoint.id, kind: checkpoint.kind || 'plan', title: checkpoint.title || '' };
}

export const KIND_LABELS = Object.freeze({ plan: 'Plan', review: 'Review', run: 'This run', final: 'Final review', routine: 'Routine' });
export const APPROVE_LABELS = Object.freeze({ plan: 'Approve this plan', review: 'Approve', run: 'Approve this run', final: 'Approve and finish', routine: 'Turn on this routine' });
export const STATE_LABELS = Object.freeze({ pending: 'Needs your OK', approved: 'Approved', changes: 'Changes requested', skipped: 'Skipped', superseded: 'Replaced by a newer version' });

/** The reply that resumes Annie after a decision, in the person's voice. */
export function decisionReply(checkpoint, decision) {
  const title = checkpoint?.title ? `“${checkpoint.title}”` : 'that';
  if (decision === 'skipped') return `Skip this run (${title}).`;
  if (checkpoint?.kind === 'routine') return `Approved: turn on the routine ${title}.`;
  return `Approved: ${title}. Go ahead.`;
}
