// A round of the autonomous loop is recorded as it was graded, before the
// re-plan rewrites tasks in place, and the re-plan says what it changed.
// Regressions: the snapshot was taken after the re-plan (old task text and
// review errors were gone), a pause during the re-plan lost the round
// entirely, and a failed grade flagged a still-running goal for review.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { run: vi.fn((sql, params, done) => done?.(null)), get: vi.fn(), all: vi.fn() } }));
vi.mock('../../models/GoalModel.js', () => ({
  default: {
    findOne: vi.fn(),
    getWorldState: vi.fn(async () => ({})),
    updateWorldState: vi.fn(async () => 1),
    updateMaxIterations: vi.fn(),
    updateLoopStatus: vi.fn(async () => 1),
    updateStatus: vi.fn(async () => 1),
    updateIteration: vi.fn(),
  },
}));
vi.mock('../../models/TaskModel.js', () => ({ default: { findByGoalId: vi.fn(), updateStatus: vi.fn(async () => 1) } }));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(async () => null), create: vi.fn(async () => 7), prune: vi.fn(), setReplannedTasks: vi.fn(async () => 1) } }));
vi.mock('../ai/ModelRouter.js', () => ({ complete: vi.fn() }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: { evaluateGoal: vi.fn() } }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: { onGoalCompleted: vi.fn() } }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: {} }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: new Proxy({}, { get: (_t, p) => `evt:${String(p)}` }) }));

const { default: Evaluator } = await import('./GoalEvaluator.js');
const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');
const { default: GoalModel } = await import('../../models/GoalModel.js');
const { default: TaskModel } = await import('../../models/TaskModel.js');
const { default: GoalIterationModel } = await import('../../models/GoalIterationModel.js');
const { complete } = await import('../ai/ModelRouter.js');

const graded = () => [
  { id: 't1', goal_id: 'g', title: 'Research', description: 'Done when: notes saved', status: 'failed', error: 'Did not pass review (CRITERIA_UNMET): off-scope rubric', output: null },
  { id: 't2', goal_id: 'g', title: 'Audit', description: 'Done when: inventory saved', status: 'failed', error: 'Did not pass review', output: null },
];
const failing = { passed: false, scores: { overall: 3.3 }, feedback: 'Not yet', taskEvaluations: [{ taskId: 't1', score: 0, criteriaMet: { a: false }, feedback: 'Missing goal deliverables' }, { taskId: 't2', score: 0, criteriaMet: { a: false }, feedback: 'Off rubric' }] };
let store;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  TaskOrchestrator.runningGoals.clear();
  store = graded();
  TaskModel.findByGoalId.mockImplementation(async () => structuredClone(store));
  GoalModel.findOne.mockResolvedValue({ id: 'g', title: 'G', description: 'D', success_criteria: {}, loop_status: null, current_iteration: 0 });
  GoalIterationModel.create.mockResolvedValue(7);
  Evaluator.evaluateGoal.mockResolvedValue(structuredClone(failing));
  vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockResolvedValue();
});

describe('a failed round is recorded as graded', () => {
  it('Given a re-plan that rewrites the tasks, Then the round keeps the graded task text and review errors, plus what changed', async () => {
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockImplementation(async () => {
      store = store.map((t) => ({ ...t, title: `${t.title} v2`, status: 'pending', error: null }));
      return [{ id: 't1', title: 'Research v2', previous: { title: 'Research' } }];
    });
    await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });

    expect(GoalIterationModel.create).toHaveBeenCalledTimes(1);
    expect(GoalIterationModel.create.mock.invocationCallOrder[0]).toBeLessThan(replan.mock.invocationCallOrder[0]);
    const snapshot = GoalIterationModel.create.mock.calls[0][7];
    expect(snapshot.map((t) => [t.title, t.status, t.error])).toEqual([
      ['Research', 'failed', 'Did not pass review (CRITERIA_UNMET): off-scope rubric'],
      ['Audit', 'failed', 'Did not pass review'],
    ]);
    expect(GoalIterationModel.setReplannedTasks).toHaveBeenCalledWith(7, [{ id: 't1', title: 'Research v2', previous: { title: 'Research' } }]);
  });

  it('Given a pause during the re-plan, Then the round is still recorded and the loop stops', async () => {
    vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockImplementation(async () => {
      TaskOrchestrator.runningGoals.get('g').abortController.abort();
      throw Object.assign(new Error('paused'), { name: 'AbortError' });
    });
    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 3 });
    expect(result.status).toBe('stopped');
    expect(GoalIterationModel.create).toHaveBeenCalledTimes(1);
    expect(GoalIterationModel.create.mock.calls[0][7][0].error).toMatch(/Did not pass review/);
    expect(GoalIterationModel.setReplannedTasks).not.toHaveBeenCalled();
  });

  it('Given the round cannot be recorded, Then the loop still re-plans and continues', async () => {
    GoalIterationModel.create.mockRejectedValue(new Error('disk full'));
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });
    expect(replan).toHaveBeenCalledTimes(1);
    expect(GoalIterationModel.setReplannedTasks).not.toHaveBeenCalled();
    expect(result.status).toBe('max_iterations');
  });
});

describe('a running goal is not flagged for review mid-loop', () => {
  it('Given a failed grade with rounds left, Then the evaluation keeps the status and needs_review comes only when the loop stops', async () => {
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);
    await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });
    expect(Evaluator.evaluateGoal.mock.calls[0][5]).toMatchObject({ keepStatusOnFail: true });
    const reviewCall = GoalModel.updateStatus.mock.calls.findIndex((call) => call[1] === 'needs_review');
    expect(GoalModel.updateStatus.mock.invocationCallOrder[reviewCall]).toBeGreaterThan(replan.mock.invocationCallOrder[0]);
    expect(GoalModel.updateLoopStatus).toHaveBeenLastCalledWith('g', 'max_iterations');
  });

  it('Given the evaluation commit outcome is unknown, Then the stopped loop flags the goal for review', async () => {
    Evaluator.evaluateGoal.mockRejectedValue(Object.assign(new Error('unknown'), { code: 'EVALUATION_COMMIT_UNKNOWN' }));
    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 3 });
    expect(result).toMatchObject({ status: 'needs_review', reason: 'EVALUATION_COMMIT_UNKNOWN' });
    expect(GoalModel.updateStatus).toHaveBeenLastCalledWith('g', 'needs_review');
    expect(GoalModel.updateLoopStatus).toHaveBeenLastCalledWith('g', 'stopped');
  });
});

describe('the re-plan reports what it changed', () => {
  const evaluation = structuredClone(failing);

  it('Given a re-plan naming one task and an unknown id, Then it rewrites that task, retries the unnamed one, and ignores the unknown id', async () => {
    complete.mockResolvedValue({ text: JSON.stringify([{ taskId: 't1', title: 'Research v2', description: 'Sharper' }, { taskId: 'ghost', title: 'X', description: 'Y' }]) });
    const result = await TaskOrchestrator._replanFailedTasks('g', evaluation, 'u');
    expect(result).toEqual([
      { id: 't1', title: 'Research v2', description: 'Sharper', previous: { title: 'Research', description: 'Done when: notes saved', status: 'failed', error: 'Did not pass review (CRITERIA_UNMET): off-scope rubric', score: 0, feedback: 'Missing goal deliverables' } },
      { id: 't2', title: 'Audit', description: 'Done when: inventory saved', previous: { title: 'Audit', description: 'Done when: inventory saved', status: 'failed', error: 'Did not pass review', score: 0, feedback: 'Off rubric' } },
    ]);
    expect(TaskModel.updateStatus.mock.calls.map((call) => [call[0], call[1]])).toEqual([['t1', 'pending'], ['t2', 'pending']]);
  });

  it('Given an unusable re-plan, Then every task under re-plan is retried with its history', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    complete.mockResolvedValue({ text: '{"not":"an array"}' });
    const result = await TaskOrchestrator._replanFailedTasks('g', evaluation, 'u');
    expect(result.map((entry) => [entry.id, entry.previous.error])).toEqual([
      ['t1', 'Did not pass review (CRITERIA_UNMET): off-scope rubric'],
      ['t2', 'Did not pass review'],
    ]);
  });
});
