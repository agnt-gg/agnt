// Activity (2026-10-23): every run in one list. Shapes are executionHistory's.
import { describe, it, expect } from 'vitest';
import { activityRows, statusOf } from './focusedActivity.js';

const runs = [
  { id: 'agent-1', isAgentExecution: true, agentId: 'orchestrator', origin: 'chat', status: 'completed', startTime: '2026-10-23T10:00:00Z', nodeCount: 3, conversationId: 'c1' },
  { id: 'agent-2', isAgentExecution: true, agentId: null, origin: 'workflow', status: 'completed', startTime: '2026-10-23T09:00:00Z', nodeCount: 5, conversationId: 'c2' },
  { id: 'agent-3', isAgentExecution: true, agentId: 'a9', workflowName: 'Inbox Helper', status: 'failed', startTime: '2026-10-23T11:00:00Z', nodeCount: 1 },
  { id: 'w1', workflowId: 'wf1', workflowName: 'Daily digest', status: 'running', startTime: '2026-10-23T12:00:00Z', nodeCount: 4 },
  { id: 'goal-g1', isGoalExecution: true, goalId: 'g1', workflowName: 'Search agnt.gg', status: 'needs_review', startTime: '2026-10-22T09:00:00Z', nodeCount: 1 },
  { id: 'goal-g2', isGoalExecution: true, workflowName: 'Gone', deleted: true, startTime: '2026-10-22T09:00:00Z' },
];

describe('activityRows', () => {
  it('lists every kind of run, newest first, named for what ran, and where each one opens', () => {
    expect(activityRows(runs).map((r) => [r.kind, r.title, r.detail, r.status.label, r.target])).toEqual([
      ['workflow', 'Daily digest', '4 steps', 'Running', { type: 'library', tab: 'workflows', id: 'wf1' }],
      ['agent', 'Inbox Helper', '1 tool used', 'Failed', { type: 'library', tab: 'agents', id: 'a9' }],
      ['chat', 'Chat with Annie', '3 tools used', 'Done', { type: 'conversation', id: 'c1' }],
      ['chat', 'Building a workflow', '5 tools used', 'Done', { type: 'conversation', id: 'c2' }],
      ['routine', 'Search agnt.gg', '1 task', 'Needs a look', { type: 'routines' }],
    ]);
  });
  it('filters by kind and by words', () => {
    expect(activityRows(runs, { kind: 'routine' }).map((r) => r.id)).toEqual(['goal-g1']);
    expect(activityRows(runs, { query: 'inbox' }).map((r) => r.id)).toEqual(['agent-3']);
    expect(activityRows(null)).toEqual([]);
  });
  it('says statuses in plain words', () => {
    expect(['executing', 'error', 'cancelled', 'completed'].map((s) => statusOf(s).label)).toEqual(['Running', 'Failed', 'Stopped', 'Done']);
  });
});
