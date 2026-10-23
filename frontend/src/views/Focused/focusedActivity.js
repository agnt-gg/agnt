/**
 * Activity: every run in one list, newest first (2026-10-23): chats with
 * Annie, agent runs, workflow runs and routines. The rows come from the
 * execution history the app already keeps (store executionHistory).
 */

export const ACTIVITY_KINDS = Object.freeze([
  { id: 'all', label: 'All' },
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
