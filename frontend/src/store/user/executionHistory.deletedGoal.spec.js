// A goal deleted mid-run must not read as running.
//
// Deleting a goal only stamps deleted_at, so one deleted while executing keeps
// status 'executing' forever. The Runs history loads deleted goals
// (includeDeleted=true), and the header pill counted that row as "1 running"
// permanently while the Runs page showed nothing. The summary must carry the
// deletion so the shared running predicate can exclude it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import executionHistory from './executionHistory.js';
import { isRunningExecution } from '@/canvas/railBadges.js';

vi.mock('axios');

// Shaped like the real /goals?includeDeleted=true row that caused it.
const zombieGoal = {
  id: '244abef9-1cbb-48a9-9acb-1efcc9830474',
  title: 'Weekly Hermes Agent Competitor Analysis Report',
  status: 'executing',
  created_at: '2026-07-03T06:41:07.142Z',
  updated_at: '2026-09-28T13:00:46.021Z',
  deleted_at: '2026-07-03T06:47:36.585Z',
  completed_at: null,
  task_count: 5,
  completed_tasks: 5,
};
const liveGoal = { ...zombieGoal, id: 'live-goal', title: 'Live', deleted_at: null };

let commit;
beforeEach(() => {
  commit = vi.fn();
  vi.clearAllMocks();
  localStorage.setItem('token', 'test-token');
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/goals')) return { data: { goals: [zombieGoal, liveGoal] } };
    return { data: { executions: [] } };
  });
});

const goalSummaries = async () => {
  await executionHistory.actions.fetchExecutions({ commit, state: { lastFetchTime: null } }, { forceRefresh: true });
  const call = commit.mock.calls.find(([type]) => type === 'SET_GOAL_EXECUTION_SUMMARIES');
  expect(call, 'goal summaries committed').toBeTruthy();
  return call[1];
};

describe('goal summaries carry deletion', () => {
  it('keeps the deleted goal in history, marked deleted', async () => {
    const summaries = await goalSummaries();
    const zombie = summaries.find((s) => s.goalId === zombieGoal.id);
    expect(zombie).toBeTruthy();
    expect(zombie.deleted).toBe(true);
    expect(summaries.find((s) => s.goalId === 'live-goal').deleted).toBe(false);
  });

  it('counts the live executing goal as running and the deleted one not', async () => {
    const running = (await goalSummaries()).filter(isRunningExecution);
    expect(running.map((s) => s.goalId)).toEqual(['live-goal']);
  });
});
