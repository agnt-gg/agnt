// "This conversation → Working now" listed three uuids from other threads,
// all of which had finished the day before. Three defects, each pinned here:
//
//   1. the label fell through to the id because the panel read snake_case
//      fields the store never writes;
//   2. nothing scoped the list to the conversation on screen;
//   3. the stream had already reported the run finished, but the history
//      snapshot still said "running" and the snapshot won.
import { describe, it, expect } from 'vitest';
import {
  isRunning,
  runDisplayName,
  runStartedAt,
  runEndedAt,
  bareExecutionId,
  runningRunsForConversation,
  shortAge,
} from './runDisplay.js';

const CONV = 'conv-here';
const OTHER = 'conv-elsewhere';

/** A row exactly as executionHistory.js builds it from /executions/agents/list. */
const historyRow = (over = {}) => ({
  id: 'agent-11111111-aaaa-bbbb-cccc-000000000001',
  agentExecutionId: '11111111-aaaa-bbbb-cccc-000000000001',
  type: 'agent',
  workflowName: 'Orchestrator',
  agentName: 'Orchestrator',
  status: 'running',
  startTime: '2026-09-08T20:10:24.228Z',
  endTime: null,
  conversationId: CONV,
  parentExecutionId: null,
  isAgentExecution: true,
  ...over,
});

describe('runDisplayName never shows an id', () => {
  it('reads the camelCase fields the store actually writes', () => {
    expect(runDisplayName({ workflowName: 'Nightly digest' })).toBe('Nightly digest');
    expect(runDisplayName({ agentName: 'Scout' })).toBe('Scout');
  });
  it('still accepts the snake_case spelling', () => {
    expect(runDisplayName({ workflow_name: 'Legacy' })).toBe('Legacy');
    expect(runDisplayName({ agent_name: 'Old' })).toBe('Old');
  });
  it('renders the orchestrator as Annie, matching every other surface', () => {
    expect(runDisplayName(historyRow())).toBe('Annie');
  });
  it('falls back to a phrase, not the uuid', () => {
    expect(runDisplayName({ id: 'agent-9956fbdf-27b4-465d-a5b1-7ee7f9e62a04' })).toBe('Untitled run');
    expect(runDisplayName(null)).toBe('Untitled run');
    expect(runDisplayName({ agentName: '   ' })).toBe('Untitled run');
  });
});

describe('timestamps accept both spellings', () => {
  it('startTime / endTime (store) and started_at / completed_at (legacy)', () => {
    expect(runStartedAt({ startTime: 'a' })).toBe('a');
    expect(runStartedAt({ started_at: 'b' })).toBe('b');
    expect(runStartedAt({ created_at: 'c' })).toBe('c');
    expect(runEndedAt({ endTime: 'd' })).toBe('d');
    expect(runEndedAt({ completed_at: 'e' })).toBe('e');
    expect(runStartedAt({})).toBeNull();
    expect(runEndedAt(null)).toBeNull();
  });
});

describe('isRunning / bareExecutionId', () => {
  it('treats the four in-flight statuses as running, case-insensitively', () => {
    for (const s of ['running', 'Executing', 'IN_PROGRESS', 'active']) expect(isRunning(s)).toBe(true);
    for (const s of ['completed', 'failed', 'interrupted', '', null, undefined]) expect(isRunning(s)).toBe(false);
  });
  it('strips the list prefix and leaves bare ids alone', () => {
    expect(bareExecutionId('agent-abc')).toBe('abc');
    expect(bareExecutionId('abc')).toBe('abc');
    expect(bareExecutionId(null)).toBe('');
  });
});

describe('runningRunsForConversation', () => {
  it('shows only runs whose conversationId is the one on screen', () => {
    const rows = [
      historyRow(),
      historyRow({ id: 'agent-2', agentExecutionId: '2', conversationId: OTHER }),
      historyRow({ id: 'agent-3', agentExecutionId: '3', conversationId: null }),
    ];
    const out = runningRunsForConversation({ history: rows, conversationId: CONV });
    expect(out.map((r) => r.executionId)).toEqual(['11111111-aaaa-bbbb-cccc-000000000001']);
    expect(out[0].name).toBe('Annie');
    expect(out[0].id).toBe('agent-11111111-aaaa-bbbb-cccc-000000000001');
  });

  it('returns nothing without a conversation to scope to', () => {
    expect(runningRunsForConversation({ history: [historyRow()], conversationId: null })).toEqual([]);
  });

  it('drops finished runs', () => {
    const rows = [historyRow({ status: 'completed', endTime: '2026-09-08T20:12:00Z' })];
    expect(runningRunsForConversation({ history: rows, conversationId: CONV })).toEqual([]);
  });

  it('REGRESSION: the stream saw the run finish, so a stale snapshot cannot resurrect it', () => {
    const history = [historyRow()]; // snapshot from before the turn ended: still "running"
    const liveRuns = [{ executionId: '11111111-aaaa-bbbb-cccc-000000000001', status: 'completed', agentName: 'Orchestrator' }];
    expect(runningRunsForConversation({ liveRuns, history, conversationId: CONV })).toEqual([]);
  });

  it('a run the stream started shows before the snapshot has caught up', () => {
    const liveRuns = [{ executionId: 'fresh', status: 'running', agentName: 'Orchestrator', startedAt: 1000 }];
    const out = runningRunsForConversation({ liveRuns, history: [], conversationId: CONV });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ executionId: 'fresh', name: 'Annie', isLive: true, startTime: 1000 });
  });

  it('merges by id so a run known to both sources is listed once, with the snapshot’s start time', () => {
    const history = [historyRow()];
    const liveRuns = [{ executionId: '11111111-aaaa-bbbb-cccc-000000000001', status: 'running', agentName: 'Orchestrator', startedAt: 5 }];
    const out = runningRunsForConversation({ liveRuns, history, conversationId: CONV });
    expect(out).toHaveLength(1);
    expect(out[0].startTime).toBe('2026-09-08T20:10:24.228Z');
    expect(out[0].isLive).toBe(true);
  });

  it('hides runs another element already represents (the live card)', () => {
    const history = [
      historyRow(),
      historyRow({ id: 'agent-child', agentExecutionId: 'child', agentName: 'Scout', parentExecutionId: '11111111-aaaa-bbbb-cccc-000000000001', startTime: '2026-09-08T20:11:00Z' }),
    ];
    const out = runningRunsForConversation({
      history,
      conversationId: CONV,
      hideExecutionIds: ['11111111-aaaa-bbbb-cccc-000000000001'],
    });
    expect(out.map((r) => r.name)).toEqual(['Scout']);
    expect(out[0].parentExecutionId).toBe('11111111-aaaa-bbbb-cccc-000000000001');
  });

  it('orders oldest first so parents precede the children they spawned', () => {
    const history = [
      historyRow({ id: 'agent-b', agentExecutionId: 'b', agentName: 'B', startTime: '2026-09-08T20:12:00Z' }),
      historyRow({ id: 'agent-a', agentExecutionId: 'a', agentName: 'A', startTime: '2026-09-08T20:10:00Z' }),
    ];
    const out = runningRunsForConversation({ history, conversationId: CONV });
    expect(out.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('keeps the snapshot’s name when the live event carried none', () => {
    const history = [historyRow({ agentName: 'Scout', workflowName: 'Scout' })];
    const liveRuns = [{ executionId: '11111111-aaaa-bbbb-cccc-000000000001', status: 'running' }];
    const out = runningRunsForConversation({ liveRuns, history, conversationId: CONV });
    expect(out[0].name).toBe('Scout');
  });
});

describe('shortAge', () => {
  it('is compact and never negative-looking', () => {
    const now = Date.parse('2026-09-09T00:30:00Z');
    expect(shortAge('2026-09-09T00:29:40Z', now)).toBe('now');
    expect(shortAge('2026-09-09T00:20:00Z', now)).toBe('10m');
    expect(shortAge('2026-09-08T22:00:00Z', now)).toBe('2h');
    expect(shortAge('2026-09-06T00:00:00Z', now)).toBe('3d');
    expect(shortAge(null, now)).toBe('');
    expect(shortAge('not a date', now)).toBe('');
  });
});
