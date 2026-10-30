/**
 * AN AGENT TAKES A CARD.
 *
 * Assigning a board card to an agent (or @mentioning one in teamspace chat)
 * runs that agent's PUBLISHED revision through NativeTeamExecution: the team
 * connection, never anyone's personal keys, every run recorded with its actor.
 * The result goes into the card's thread, the card moves to Review, and the
 * person who made the card is asked to approve it. Nothing is "done" until a
 * person says so.
 *
 * `execute(input)` is injected: in production it is the snapshot + run pair
 * TeamRoutes already uses for /native/:kind/:id/run; in tests it is a stub.
 */

const FRIENDLY_FAILURES = Object.freeze({
  publish_required: 'I am not published for this teamspace yet. An owner or admin can publish me from the Agents tab, then assign the card again.',
  connection_required: 'The team has no model connection for me yet. An owner can add one in Team → Connections.',
});

/** The text an agent run produced, from any of the executor result shapes. */
export function resultText(run) {
  const result = run?.result ?? run;
  if (typeof result === 'string') return result;
  const candidates = [result?.content, result?.text, result?.response, result?.output, result?.message?.content, result?.finalResponse];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  if (found) return found;
  try { return JSON.stringify(result ?? {}, null, 2).slice(0, 4000); } catch { return 'The run finished without text output.'; }
}

function failureText(error) {
  if (error?.code && FRIENDLY_FAILURES[error.code]) return FRIENDLY_FAILURES[error.code];
  if (error?.status && error.status < 500 && error.message) return `I could not run: ${error.message}`;
  return 'Something went wrong while I was working on this. The run was recorded; try assigning me again.';
}

/**
 * Run one agent on one card. Never throws: every outcome is written to the
 * card, so the board is the record of what happened.
 */
export async function runAgentOnTask({ spaces, teamId, workspaceId, taskId, agentId, input, execute, changed = () => {} }) {
  try {
    await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'running', status: 'doing', agentId, comment: 'On it.' });
    changed();
    const run = await execute(input);
    if (run?.status === 'failed') throw Object.assign(new Error(typeof run?.result?.error === 'string' ? run.result.error : 'The run failed'), { status: 422 });
    const text = resultText(run);
    await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'waiting', status: 'review', result: text, agentId, comment: text });
    await spaces.requestApproval(teamId, workspaceId, taskId, agentId);
    changed();
    return { ok: true, text };
  } catch (error) {
    if (!error?.status) console.error('[Teamspaces] agent run failed:', error?.message || error);
    try {
      await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'blocked', status: 'todo', agentId, comment: failureText(error) });
      changed();
    } catch (recordError) {
      // The card itself is gone (deleted mid-run). Nothing left to annotate.
      console.warn('[Teamspaces] could not record agent failure:', recordError.message);
    }
    return { ok: false, error: failureText(error) };
  }
}
