// Activity (2026-10-23): every run in one list. Shapes are executionHistory's.
import { describe, it, expect } from 'vitest';
import { activityGroups, activityRows, statusOf, activityDetail, kindFromId, durationLabel } from './focusedActivity.js';

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
      ['workflow', 'Daily digest', '4 steps', 'In progress', { type: 'library', tab: 'workflows', id: 'wf1' }],
      ['agent', 'Inbox Helper', '', 'Failed', { type: 'library', tab: 'agents', id: 'a9' }],
      ['chat', 'Chat with Annie', '', 'Done', { type: 'conversation', id: 'c1' }],
      ['chat', 'Building an automation', '', 'Done', { type: 'conversation', id: 'c2' }],
      ['routine', 'Search agnt.gg', '1 task', 'Needs a look', { type: 'routines' }],
    ]);
  });
  it('filters by kind and by words', () => {
    expect(activityRows(runs, { kind: 'routine' }).map((r) => r.id)).toEqual(['goal-g1']);
    expect(activityRows(runs, { query: 'inbox' }).map((r) => r.id)).toEqual(['agent-3']);
    expect(activityRows(null)).toEqual([]);
  });
  // Reported: Activity listed "failed chats" that were one empty reply from the AI
  // provider in a chat that carried on. A chat is judged by its latest reply.
  it('a chat is one row, judged by its latest reply, under its own title', () => {
    const chat = (id, status, at, conv = 'c9') => ({ id, isAgentExecution: true, agentId: 'orchestrator', status, startTime: at, conversationId: conv, outputTokens: status === 'failed' ? 0 : 120 });
    const titles = new Map([['c9', 'Plan the Q3 launch']]);
    const recovered = activityRows([chat('a1', 'failed', '2026-11-21T10:00:00Z'), chat('a2', 'completed', '2026-11-21T10:05:00Z')], { titles });
    expect(recovered.map((r) => [r.id, r.title, r.status.label])).toEqual([['a2', 'Plan the Q3 launch', 'Done']]);
    const noReply = activityRows([chat('b1', 'completed', '2026-11-21T09:00:00Z', 'c8'), chat('b2', 'failed', '2026-11-21T09:10:00Z', 'c8')]);
    expect(noReply.map((r) => [r.id, r.title, r.status.label, r.status.tone])).toEqual([['b2', 'Chat with Annie', 'No reply from the AI', 'warn']]);
    // Never pinned as something that needs a look.
    expect(activityGroups(noReply, new Date('2026-11-21T15:00:00Z').getTime()).needs).toEqual([]);
  });
  it('says statuses in plain words', () => {
    expect(['executing', 'error', 'cancelled', 'completed'].map((s) => statusOf(s).label)).toEqual(['In progress', 'Failed', 'Stopped', 'Done']);
  });
});

// 2026-10-23: a run opens in full. Shapes are fetchExecutionDetails'.
describe('activityDetail', () => {
  it('a chat or assistant run: what was asked, the answer, each action call with its input and output, and usage', () => {
    const v = activityDetail({
      initialPrompt: 'Find AI news', finalResponse: 'Here are 3 stories', startTime: '2026-10-23T10:00:00Z', endTime: '2026-10-23T10:00:42Z',
      provider: 'openai-codex', model: 'gpt-6.1', inputTokens: 1000, outputTokens: 234, estimatedCost: 0.0123,
      nodeExecutions: [{ id: 't1', name: 'web_search', status: 'completed', start_time: '2026-10-23T10:00:01Z', end_time: '2026-10-23T10:00:04.5Z', input: { query: 'AI news' }, output: { content: '10 results' } }],
    });
    expect([v.asked, v.result, v.duration]).toEqual(['Find AI news', 'Here are 3 stories', '42 s']);
    expect(v.steps).toEqual([{ id: 't1', name: 'Web search', status: { label: 'Done', tone: 'good' }, duration: '3.5 s', input: '{\n  "query": "AI news"\n}', output: '10 results', error: '' }]);
    expect(v.usage).toEqual([{ label: 'Model', value: 'openai-codex · gpt-6.1' }, { label: 'Tokens', value: '1,234' }, { label: 'Cost', value: '$0.01' }]);
  });
  it('a workflow run names each step from the workflow; a routine lists its tasks', () => {
    const wf = activityDetail({ nodeExecutions: [{ node_id: 'n1', status: 'error', error: 'smtp down' }] }, { workflowNodes: [{ id: 'n1', text: 'Email me' }] });
    expect(wf.steps[0]).toMatchObject({ name: 'Email me', status: { label: 'Failed' }, error: 'smtp down' });
    const goal = activityDetail({ goalDetails: { description: 'Daily digest', tasks: [{ id: 'k', title: 'Research', status: 'completed', output: 'done' }] } });
    expect([goal.asked, goal.steps[0].name, goal.steps[0].output]).toEqual(['Daily digest', 'Research', 'done']);
    expect(activityDetail(null).steps).toEqual([]);
  });
  it('kind from a run id, and durations in words', () => {
    expect(['goal-1', 'agent-1', 'abc'].map(kindFromId)).toEqual(['routine', 'agent', 'workflow']);
    expect([null, 2400, 65000, 3720000].map(durationLabel)).toEqual(['', '2.4 s', '1 min 5 s', '1 h 2 min']);
  });
});

describe('Activity groups', () => {
  const now = new Date('2026-11-21T15:00:00').getTime();
  const row = (id, at, tone = 'good') => ({ id, at, status: { tone } });
  it('pins what needs a look, then groups the rest by day, newest first', () => {
    const groups = activityGroups([
      row('old', '2026-11-10T09:00:00'),
      row('y', '2026-11-20T18:00:00'),
      row('t1', '2026-11-21T09:00:00'),
      row('t2', '2026-11-21T14:00:00'),
      row('bad-old', '2026-11-19T09:00:00', 'bad'),
      { id: 'team', at: '2026-11-21T10:00:00' },
    ], now);
    expect(groups.needs.map((r) => r.id)).toEqual(['bad-old']);
    expect(groups.days.map((d) => [d.label, d.rows.map((r) => r.id)])).toEqual([
      ['Today', ['t2', 'team', 't1']],
      ['Yesterday', ['y']],
      ['Earlier', ['old']],
    ]);
  });
  it('is empty for nothing', () => {
    expect(activityGroups([], now)).toEqual({ needs: [], days: [] });
    expect(activityGroups(undefined, now)).toEqual({ needs: [], days: [] });
  });
});
