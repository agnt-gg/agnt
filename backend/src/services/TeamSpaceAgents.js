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

/**
 * How an agent finishes a card, given to it with every card (TeamSpaceRoutes.agentInput): the
 * checks it ran, and how to stop and ask when it cannot finish without a person's decision.
 */
export const FINISH_INSTRUCTIONS = [
  'When you finish:',
  '- List the checks you ran, one per line: "CHECK: <what you checked> — passed" or "CHECK: <what you checked> — failed: <why>".',
  '- If you cannot finish without a person\'s decision, stop and end with "DECISION NEEDED: <one line saying why>" and up to three lines "OPTION: <a choice they can pick>".',
].join('\n');

const MAX_CHECKS = 10;
const MAX_OPTIONS = 3;

function parseCheck(body) {
  // "<what> — passed" or "<what> — failed: <why>": a dash (any width) or a colon before the verdict.
  const match = body.match(/^(.*?)\s*[—–:-]\s*(passed|failed)\b[\s:—–-]*(.*)$/i);
  if (!match) return { label: body.trim().slice(0, 160), ok: null, detail: '' };
  return { label: match[1].trim().slice(0, 160), ok: match[2].toLowerCase() === 'passed', detail: match[3].trim().replace(/^\((.*)\)$/, '$1').slice(0, 200) };
}

/**
 * Split a reply into what a person reads and what the board acts on: CHECK lines become the card's
 * checks; a DECISION NEEDED line (with its OPTION lines) stops the card for a decision.
 */
export function readFinishLines(reply) {
  const checks = [];
  const options = [];
  const kept = [];
  let reason = null;
  for (const line of String(reply ?? '').split(/\r?\n/)) {
    const check = line.match(/^\s*(?:[-*]\s*)?CHECK:\s*(.+)$/i);
    const stop = line.match(/^\s*(?:[-*]\s*)?DECISION NEEDED:\s*(.+)$/i);
    const option = line.match(/^\s*(?:[-*]\s*)?OPTION:\s*(.+)$/i);
    if (check) { if (checks.length < MAX_CHECKS) checks.push(parseCheck(check[1])); }
    else if (stop) reason = stop[1].trim().slice(0, 300);
    else if (option) { if (options.length < MAX_OPTIONS) options.push(option[1].trim().slice(0, 200)); }
    else kept.push(line);
  }
  return { text: kept.join('\n').trim(), checks, decision: reason ? { reason, options } : null };
}

// The short form the board shows on the card as "Stopped: <reason>"; the thread keeps the full text.
const STOP_REASONS = Object.freeze({
  publish_required: 'not published here yet',
  connection_required: 'no model connection',
});

export function stopReason(error) {
  if (error?.code && STOP_REASONS[error.code]) return STOP_REASONS[error.code];
  if (error?.status && error.status < 500 && error.message) return error.message.slice(0, 120);
  return 'the run failed';
}

function failureText(error) {
  if (error?.code && FRIENDLY_FAILURES[error.code]) return FRIENDLY_FAILURES[error.code];
  if (error?.status && error.status < 500 && error.message) return `I could not run: ${error.message}`;
  return 'Something went wrong while I was working on this. The run was recorded; try assigning me again.';
}

/**
 * Run one agent on one card. Never throws: every outcome is written to the
 * card, so the board is the record of what happened. `started` means the card
 * was already moved to In progress (TeamSpaceRepository.startAgentRun).
 *
 * An agent that asks for a decision stops the card (`stopped`). A team lead deciding for another
 * agent (`decides`) hands its answer back (`decided`) instead of asking for approval: the agent it
 * decided for carries on, and that agent's result is what a person approves.
 */
export async function runAgentOnTask({ spaces, teamId, workspaceId, taskId, agentId, input, execute, changed = () => {}, started = false, decides = false }) {
  try {
    if (!started) await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'running', status: 'doing', agentId, comment: 'On it.' });
    changed();
    const run = await execute(input);
    if (run?.status === 'failed') throw Object.assign(new Error(typeof run?.result?.error === 'string' ? run.result.error : 'The run failed'), { status: 422 });
    const finish = readFinishLines(resultText(run));
    if (finish.decision) {
      await spaces.setAgentState(teamId, workspaceId, taskId, {
        state: 'blocked', status: 'todo', agentId, comment: finish.text || finish.decision.reason,
        reason: finish.decision.reason, decision: finish.decision, checks: finish.checks,
      });
      changed();
      return { ok: false, stopped: true, decision: finish.decision, text: finish.text };
    }
    const text = finish.text || 'The run finished without text output.';
    if (decides) return { ok: true, decided: true, text };
    await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'waiting', status: 'review', result: text, agentId, comment: text, checks: finish.checks });
    await spaces.requestApproval(teamId, workspaceId, taskId, agentId);
    changed();
    return { ok: true, text };
  } catch (error) {
    if (!error?.status) console.error('[Teamspaces] agent run failed:', error?.message || error);
    try {
      await spaces.setAgentState(teamId, workspaceId, taskId, { state: 'blocked', status: 'todo', agentId, comment: failureText(error), reason: stopReason(error) });
      changed();
    } catch (recordError) {
      // The card itself is gone (deleted mid-run). Nothing left to annotate.
      console.warn('[Teamspaces] could not record agent failure:', recordError.message);
    }
    return { ok: false, error: failureText(error) };
  }
}
