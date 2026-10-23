/**
 * Routines are scheduled goals, and every run must do the whole job again
 * (reported 2026-10-21). On a real machine: "Search agnt.gg" ran daily for
 * months with 0 of 129 runs doing any task; a daily email digest did its work
 * once and then re-graded day one; two weekly goals had been DELETED but their
 * schedules kept firing and failing as STALE_GOAL_EVALUATION.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const goals = new Map();
let tasks = [];
const calls = [];
vi.mock('../../models/GoalModel.js', () => ({
  default: {
    findOne: vi.fn(async (id) => goals.get(id) || null),
    getWorldState: vi.fn(async () => ({ best: { score: 90, iteration: 4 }, other: 1 })),
    updateWorldState: vi.fn(async (id, state) => calls.push(['worldState', state])),
  },
}));
vi.mock('../../models/TaskModel.js', () => ({
  default: {
    resetForNewRun: vi.fn(async (goalId) => { calls.push(['reset', goalId]); tasks = tasks.map((t) => ({ ...t, status: 'pending', started_at: null })); return tasks.length; }),
    findByGoalId: vi.fn(async () => tasks),
  },
}));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: new Proxy({}, { get: (_, k) => String(k) }) }));
// vi.mock is hoisted: one call per module, no loop.
vi.mock('./GoalEvaluator.js', () => ({ default: {} }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: {} }));

const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');

beforeEach(() => {
  goals.clear();
  calls.length = 0;
  tasks = [{ id: 't1', status: 'completed', started_at: '2026-01-01T00:00:00.000Z' }];
  goals.set('g', { id: 'g', user_id: 'u', deleted_at: null });
  TaskOrchestrator.runningGoals.clear();
});

describe('a scheduled run of a goal', () => {
  it('resets the tasks first and starts the loop fresh, never resuming the last run', async () => {
    const loop = vi.spyOn(TaskOrchestrator, 'executeGoalAutonomous').mockImplementation(async () => {
      calls.push(['loop']);
      tasks = tasks.map((t) => ({ ...t, status: 'completed', started_at: new Date().toISOString() }));
      return { goalId: 'g', status: 'completed' };
    });
    const result = await TaskOrchestrator.runScheduledGoal('g', 'u');
    expect(calls.map((c) => c[0])).toEqual(['reset', 'loop']);
    expect(loop).toHaveBeenCalledWith('g', 'u', { freshRun: true });
    expect(result).toEqual({ goalId: 'g', status: 'completed' });
    loop.mockRestore();
  });

  it('a run in which no task ran is an error, never completed', async () => {
    const loop = vi.spyOn(TaskOrchestrator, 'executeGoalAutonomous').mockResolvedValue({ goalId: 'g', status: 'completed' });
    const result = await TaskOrchestrator.runScheduledGoal('g', 'u');
    expect(result).toMatchObject({ status: 'error', reason: 'no_tasks_ran' });
    loop.mockRestore();
  });

  it('a deleted goal does not run, and asks for its schedule to be switched off', async () => {
    goals.set('g', { id: 'g', user_id: 'u', deleted_at: '2026-10-05T05:20:59.283Z' });
    const loop = vi.spyOn(TaskOrchestrator, 'executeGoalAutonomous');
    expect(await TaskOrchestrator.runScheduledGoal('g', 'u')).toMatchObject({ status: 'error', reason: 'goal_missing', disableSchedule: true });
    expect(await TaskOrchestrator.runScheduledGoal('nope', 'u')).toMatchObject({ reason: 'goal_missing' });
    expect(loop).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    loop.mockRestore();
  });

  it('a goal still running from before is skipped, not reset under itself', async () => {
    TaskOrchestrator.runningGoals.set('g', {});
    expect(await TaskOrchestrator.runScheduledGoal('g', 'u')).toMatchObject({ status: 'error', reason: 'already_running' });
    expect(calls).toEqual([]);
  });

  it('a fresh run starts at iteration 1 and drops the earlier best', async () => {
    expect(await TaskOrchestrator._freshRunState('g')).toEqual({ startIteration: 1, bestScore: 0, bestIteration: 0, bestTaskSnapshot: null });
    expect(calls).toEqual([['worldState', { other: 1 }]]);
  });
});
