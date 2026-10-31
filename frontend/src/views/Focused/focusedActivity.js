/**
 * Activity: every run in one list, newest first (2026-10-23): chats with
 * Annie, agent runs, workflow runs and routines. The rows come from the
 * execution history the app already keeps (store executionHistory).
 */
import { humanizeToolName } from '@/services/stepsSummary.js';

export const ACTIVITY_KINDS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'team', label: 'Teamspaces' },
  { id: 'chat', label: 'Chats' },
  { id: 'agent', label: 'Agents' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'routine', label: 'Routines' },
]);

const FORGE_TITLE = { workflow: 'Building a workflow', tool: 'Building a tool', agent: 'Building an agent', widget: 'Building a widget', plugin: 'Building a plugin' };
const ICON = { chat: 'fas fa-comment', agent: 'fas fa-robot', workflow: 'fas fa-project-diagram', routine: 'fas fa-redo' };
// Annie's own runs: the orchestrator, or a run with no agent behind it.
const isAnnie = (run) => !run.agentId || run.agentId === 'orchestrator' || run.agentId === 'agent-chat';

function kindOf(run) {
  if (run.isGoalExecution) return 'routine';
  if (run.isAgentExecution) return isAnnie(run) ? 'chat' : 'agent';
  return 'workflow';
}

/** A status in plain words, and how it reads (good, bad, live). */
export function statusOf(status) {
  const s = String(status || '').toLowerCase();
  if (/^(running|executing|in_progress|started|pending)$/.test(s)) return { label: 'Running', tone: 'live' };
  if (/^(failed|error|stuck)$/.test(s)) return { label: 'Failed', tone: 'bad' };
  if (/^(stopped|cancelled|canceled|paused)$/.test(s)) return { label: 'Stopped', tone: '' };
  if (s === 'needs_review') return { label: 'Needs a look', tone: 'bad' };
  return { label: 'Done', tone: 'good' };
}

/** The kind of a run from its id alone (executionHistory's id scheme), for a deep link. */
export function kindFromId(id) {
  const s = String(id || '');
  if (s.startsWith('goal-')) return 'routine';
  if (s.startsWith('agent-')) return 'agent';
  return 'workflow';
}

const text = (value) => {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.content === 'string') return value.content;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const ms = (a, b) => (a && b ? Math.max(0, new Date(b) - new Date(a)) : null);

/** "2.4s", "3 min 5 s", or '' */
export function durationLabel(milliseconds) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '';
  const s = milliseconds / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${Math.round(s % 60)} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * One run in full, as the detail page shows it (2026-10-23: "I should be able
 * to see an overview of everything"). From executionHistory/fetchExecutionDetails:
 *   agent / chat run: initialPrompt, finalResponse, nodeExecutions (tool calls)
 *   workflow run:     nodeExecutions (steps; named from the workflow's nodes)
 *   routine run:      goalDetails with its tasks
 * @returns { asked, result, steps[{ id, name, status, duration, input, output, error }], usage[{ label, value }], startedAt, endedAt, duration }
 */
export function activityDetail(detail = {}, { workflowNodes = [] } = {}) {
  const d = detail || {};
  const nodeName = new Map((Array.isArray(workflowNodes) ? workflowNodes : []).map((n) => [n.id, n.text || n.type]));
  const goal = d.goalDetails;
  const steps = goal
    ? (goal.tasks || []).map((t, i) => ({
        id: String(t.id || i),
        name: t.title || `Task ${i + 1}`,
        status: statusOf(t.status),
        duration: durationLabel(ms(t.started_at, t.completed_at)),
        input: text(t.description),
        output: text(t.output),
        error: text(t.error),
      }))
    : (d.nodeExecutions || []).map((n, i) => ({
        id: String(n.id || i),
        // A tool call reads as words ("Get node type schema"); a workflow step by its name.
        name: n.name ? humanizeToolName(n.name) : nodeName.get(n.node_id) || n.node_id || `Step ${i + 1}`,
        status: statusOf(n.status),
        duration: durationLabel(ms(n.start_time, n.end_time)),
        input: text(n.input),
        output: text(n.output),
        error: text(n.error),
      }));
  const tokens = Number(d.totalTokens) || (Number(d.inputTokens) || 0) + (Number(d.outputTokens) || 0);
  const cost = Number(d.estimatedCost ?? d.ledger?.cost ?? d.ledger?.totalCost);
  const usage = [
    d.provider || d.model ? { label: 'Model', value: [d.provider, d.model].filter(Boolean).join(' · ') } : null,
    tokens ? { label: 'Tokens', value: tokens.toLocaleString() } : null,
    Number.isFinite(cost) && cost > 0 ? { label: 'Cost', value: `$${cost.toFixed(cost < 0.01 ? 4 : 2)}` } : null,
    Number(d.creditsUsed) > 0 ? { label: 'Credits', value: String(d.creditsUsed) } : null,
  ].filter(Boolean);
  return {
    asked: text(d.initialPrompt || goal?.description || ''),
    result: text(d.finalResponse || goal?.result || ''),
    error: text(d.error || goal?.error || ''),
    steps,
    usage,
    startedAt: d.startTime || goal?.created_at || null,
    endedAt: d.endTime || null,
    duration: durationLabel(ms(d.startTime, d.endTime)),
  };
}

/**
 * Teamspace activity: what people did in the team (team_events), in words.
 * Names come only from lists the person may read (each teamspace's tasks and
 * docs, the teamspaces they belong to): an event whose target cannot be
 * resolved (someone's private card, a teamspace they cannot open, something
 * deleted) is left out rather than shown half-known.
 *
 * @param events  [{ id, actor_id, action, target_id, created_at }]
 * @param lookups { spaces: Map(id → {name}), tasks: Map(id → {title, workspaceId}), docs: Map(id → {name, workspaceId}), people: Map(id → name), me }
 * @returns rows: { id, kind:'team', actorId, actor, sentence, where, at, target }
 */
export function teamActivityRows(events = [], { spaces = new Map(), tasks = new Map(), docs = new Map(), people = new Map(), me = null } = {}) {
  const who = (id) => (id === me ? 'You' : people.get(id) || 'A teammate');
  const TASK = { 'task.created': 'created the task', 'task.moved': 'moved the task', 'task.approved': 'approved the task', 'task.sent_back': 'sent back the task' };
  const DOC = { 'doc.created': 'created the doc', 'doc.revised': 'edited the doc' };
  const MEMBER = { 'member.invited': 'invited someone to the team', 'member.joined': 'joined the team', 'member.removed': 'removed someone from the team' };
  const rows = [];
  for (const e of Array.isArray(events) ? events : []) {
    const base = { id: 'team:' + e.id, kind: 'team', actorId: e.actor_id, actor: who(e.actor_id), at: e.created_at };
    if (TASK[e.action]) {
      const t = tasks.get(e.target_id);
      if (!t) continue;
      rows.push({ ...base, sentence: `${TASK[e.action]} “${t.title}”`, where: spaces.get(t.workspaceId)?.name || '', target: { type: 'task', space: t.workspaceId, id: e.target_id } });
    } else if (DOC[e.action]) {
      const d = docs.get(e.target_id);
      if (!d) continue;
      rows.push({ ...base, sentence: `${DOC[e.action]} “${d.name}”`, where: spaces.get(d.workspaceId)?.name || '', target: { type: 'doc', space: d.workspaceId, id: e.target_id } });
    } else if (e.action === 'message.posted') {
      const s = spaces.get(e.target_id);
      if (!s) continue;
      rows.push({ ...base, sentence: 'posted in chat', where: s.name, target: { type: 'space', space: e.target_id } });
    } else if (MEMBER[e.action]) {
      rows.push({ ...base, sentence: MEMBER[e.action], where: '', target: { type: 'members' } });
    } else if (e.action === 'asset.created' || e.action === 'asset.revised') {
      rows.push({ ...base, sentence: e.action === 'asset.created' ? 'published an item to the team' : 'published a new version of a team item', where: '', target: null });
    }
  }
  return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

/** @returns rows: { id, kind, icon, title, detail, at, status, target } */
export function activityRows(runs = [], { kind = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run && !run.deleted)
    .map((run) => {
      const k = kindOf(run);
      const tools = Number(run.nodeCount) || 0;
      // A forge chat says what was being built (origin is the chat surface).
      const title = k === 'chat' ? FORGE_TITLE[run.origin] || 'Chat with Annie' : String(run.workflowName || '').trim() || (k === 'agent' ? 'Agent' : k === 'routine' ? 'Routine' : 'Workflow');
      const detail = k === 'workflow' ? `${tools} step${tools === 1 ? '' : 's'}` : k === 'routine' ? `${tools} task${tools === 1 ? '' : 's'}` : tools ? `${tools} tool${tools === 1 ? '' : 's'} used` : '';
      const target =
        k === 'chat' ? (run.conversationId ? { type: 'conversation', id: String(run.conversationId) } : null)
          : k === 'agent' ? (run.agentId ? { type: 'library', tab: 'agents', id: String(run.agentId) } : null)
            : k === 'workflow' ? (run.workflowId ? { type: 'library', tab: 'workflows', id: String(run.workflowId) } : null)
              : { type: 'routines' };
      return { id: String(run.id), kind: k, icon: ICON[k], title, detail, at: run.startTime || run.endTime || null, status: statusOf(run.status), target };
    })
    .filter((row) => kind === 'all' || row.kind === kind)
    .filter((row) => !q || `${row.title} ${row.detail}`.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}
