/**
 * How a run (agent turn, workflow execution, goal) is NAMED, DATED and
 * SCOPED for display — one place, because there were two.
 *
 * WHY THIS FILE EXISTS. The execution-history store writes camelCase
 * (`workflowName`, `startTime`, `endTime`); the inspector panels were reading
 * snake_case (`workflow_name`, `started_at`, `completed_at`). Every lookup
 * missed, so the label fell through to `r.id` and the sidebar rendered
 * "agent-9956fbdf-27b4-465d-a5b1-7ee7f9e62a04" with a blank timestamp. An
 * id is never a name. Both spellings are accepted here so a row from either
 * source reads the same, and no caller needs to know which one it holds.
 *
 * SCOPING. A run belongs to the conversation that started it. The panel that
 * says "This conversation" must show only those, and say where the rest
 * are — a list that quietly mixes every thread under that heading is the
 * confusion this module removes.
 */

/** Statuses that mean "still going", across agent, workflow and goal rows. */
export const RUNNING_STATUSES = new Set(['running', 'executing', 'in_progress', 'active']);

export function isRunning(status) {
  return RUNNING_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * The backend names every top-level chat turn "Orchestrator". To the user
 * that participant is Annie — the name the live card, the avatars and the
 * sidebar already use. One mapping, here, so nothing else has to know.
 */
const ORCHESTRATOR_DISPLAY = 'Annie';

export function runDisplayName(run) {
  if (!run) return 'Untitled run';
  const raw =
    run.agentName || run.agent_name ||
    run.workflowName || run.workflow_name ||
    run.title || run.name || '';
  const name = String(raw).trim();
  if (!name) return 'Untitled run';
  if (name === 'Orchestrator') return ORCHESTRATOR_DISPLAY;
  return name;
}

export function runStartedAt(run) {
  return run?.startTime ?? run?.start_time ?? run?.started_at ?? run?.startedAt ?? run?.created_at ?? null;
}

export function runEndedAt(run) {
  return run?.endTime ?? run?.end_time ?? run?.completed_at ?? run?.ended_at ?? run?.endedAt ?? run?.finished_at ?? null;
}

/** The execution id without the store's `agent-` list prefix. */
export function bareExecutionId(id) {
  const s = String(id || '');
  return s.startsWith('agent-') ? s.slice(6) : s;
}

/**
 * The runs that belong to ONE conversation and are still going, merged from
 * the two places the client knows about them:
 *
 *  - `liveRuns`: what this tab heard over the stream (`agent_execution_started`
 *    / `_completed`). Authoritative for status — it is real-time.
 *  - `history`: the execution-history snapshot. Knows about runs this tab did
 *    not start (another device, a sub-agent spawned server-side) but is only
 *    as fresh as its last fetch.
 *
 * Merged by execution id, live status winning, so a run the snapshot still
 * calls "running" but the stream already saw finish is not shown as running.
 *
 * `hideExecutionIds` removes runs another element already represents — the
 * "Annie is working…" card IS the live root turn, so listing it again
 * underneath would show one piece of work twice.
 */
export function runningRunsForConversation({ liveRuns = [], history = [], conversationId, hideExecutionIds } = {}) {
  if (!conversationId) return [];
  const hide = hideExecutionIds instanceof Set ? hideExecutionIds : new Set(hideExecutionIds || []);
  const byId = new Map();

  for (const h of history) {
    if (!h || h.conversationId !== conversationId) continue;
    const executionId = bareExecutionId(h.agentExecutionId || h.id);
    byId.set(executionId, {
      id: `agent-${executionId}`,
      executionId,
      name: runDisplayName(h),
      status: h.status,
      startTime: runStartedAt(h),
      parentExecutionId: h.parentExecutionId ?? null,
      isLive: false,
    });
  }

  for (const l of liveRuns) {
    if (!l?.executionId) continue;
    const executionId = bareExecutionId(l.executionId);
    const prev = byId.get(executionId);
    byId.set(executionId, {
      id: `agent-${executionId}`,
      executionId,
      name: runDisplayName(l) === 'Untitled run' && prev ? prev.name : runDisplayName(l),
      status: l.status,
      startTime: prev?.startTime ?? l.startedAt ?? null,
      parentExecutionId: prev?.parentExecutionId ?? null,
      isLive: true,
    });
  }

  return [...byId.values()]
    .filter((r) => isRunning(r.status) && !hide.has(r.executionId))
    .sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));
}

/** Short relative age for a compact row: "now", "4m", "2h", "3d". */
export function shortAge(d, now = Date.now()) {
  if (!d) return '';
  const diff = (now - new Date(d).getTime()) / 1000;
  if (!Number.isFinite(diff)) return '';
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
