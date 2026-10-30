// A task blocked on something only the user can supply (a credential, access,
// an uninstalled tool) is not a defect in the work, and no retry or re-plan can
// fix it. Regression: the SEO goal's analytics task was rejected, retried with
// the same 401, failed, re-planned and run again, round after round, without
// ever saying "this needs an analytics-admin sign-in from you".
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
vi.mock('../../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(async () => null), create: vi.fn(async () => 7), prune: vi.fn(), setReplannedTasks: vi.fn() } }));
vi.mock('../ai/ModelRouter.js', () => ({ complete: vi.fn() }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: { evaluateGoal: vi.fn(), evaluateTask: vi.fn(), aiEvaluateTaskOutput: vi.fn() } }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: { onGoalCompleted: vi.fn() } }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: {} }));
vi.mock('../AutonomousMessageService.js', () => ({ default: { triggerAutonomousMessage: vi.fn(async () => {}) } }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: new Proxy({}, { get: (_t, p) => `evt:${String(p)}` }) }));

const { default: Evaluator } = await import('./GoalEvaluator.js');
const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');
const { default: GoalModel } = await import('../../models/GoalModel.js');
const { default: TaskModel } = await import('../../models/TaskModel.js');
const { broadcastToUser } = await import('../../utils/realtimeSync.js');

const ask = { what: 'Sign in with an agnt.gg analytics-admin account', why: 'agnt.gg answered 401' };
const task = { id: 't1', goal_id: 'g', title: 'Pull analytics', description: 'Done when: real numbers saved' };
const gradedNeedingInput = { taskId: 't1', score: 30, criteriaMet: { realNumbers: false }, feedback: 'All metrics null', needsInput: ask };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  TaskOrchestrator.runningGoals.clear();
  GoalModel.findOne.mockResolvedValue({ id: 'g', success_criteria: {}, loop_status: null, current_iteration: 0 });
  GoalModel.getWorldState.mockResolvedValue({});
});

describe('the review gate', () => {
  it('Given the grader finds a prerequisite only the user can supply, Then the review says so', async () => {
    Evaluator.evaluateTask.mockResolvedValue(gradedNeedingInput);
    const review = await TaskOrchestrator._reviewTaskResult(task, { content: 'All six metrics null: 401 Sign in again' }, 'u');
    expect(review).toEqual({ rejected: true, code: 'NEEDS_INPUT', needsInput: ask, feedback: 'Needs from you: Sign in with an agnt.gg analytics-admin account (agnt.gg answered 401)' });
  });

  it('Given an ordinary defect, Then it is the usual rejection', async () => {
    Evaluator.evaluateTask.mockResolvedValue({ taskId: 't1', score: 40, criteriaMet: { table: false }, feedback: 'Table missing' });
    expect(await TaskOrchestrator._reviewTaskResult(task, { content: 'Saved numbers' }, 'u')).toEqual({ rejected: true, code: 'TASK_SCORE_REJECTED', feedback: 'Table missing' });
  });

  it('Given work that passes, Then a stray needsInput does not reject it', async () => {
    Evaluator.evaluateTask.mockResolvedValue({ ...gradedNeedingInput, score: 95, criteriaMet: { realNumbers: true } });
    expect(await TaskOrchestrator._reviewTaskResult(task, { content: 'Saved numbers' }, 'u')).toEqual({ rejected: false });
  });

  it('Given a task that reports itself blocked, Then only a needs-input finding changes its handling', async () => {
    Evaluator.aiEvaluateTaskOutput.mockResolvedValueOnce({ score: 0, criteriaMet: { a: false }, feedback: 'x', needsInput: ask });
    expect((await TaskOrchestrator._reviewTaskResult(task, { content: 'Status: blocked\nNo admin token' }, 'u')).code).toBe('NEEDS_INPUT');
    Evaluator.aiEvaluateTaskOutput.mockResolvedValueOnce({ score: 0, criteriaMet: { a: false }, feedback: 'x', needsInput: null });
    expect(await TaskOrchestrator._reviewTaskResult(task, { content: 'Status: blocked\nI ran out of ideas' }, 'u')).toEqual({ rejected: false });
    expect(Evaluator.evaluateTask).not.toHaveBeenCalled();
  });
});

describe('the autonomous loop', () => {
  const blocked = () => ({ ...task, status: 'failed', error: 'Needs from you: ...', output: JSON.stringify({ outcome: 'needs_input', needsInput: ask }) });

  it('Given a task stopped on needs input, Then the loop stops with the ask instead of grading and re-planning', async () => {
    let tasks = [{ ...task, status: 'pending' }];
    TaskModel.findByGoalId.mockImplementation(async () => structuredClone(tasks));
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockImplementation(async () => { tasks = [blocked()]; });
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks');
    const sendToChat = vi.spyOn(TaskOrchestrator, '_sendGoalFailureToChat').mockResolvedValue();

    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 5, conversationId: 'c1' });

    expect(result).toMatchObject({ status: 'needs_input', iteration: 1, needsInput: [{ taskId: 't1', title: 'Pull analytics', ...ask }], reason: expect.stringContaining(ask.what) });
    expect(Evaluator.evaluateGoal).not.toHaveBeenCalled();
    expect(replan).not.toHaveBeenCalled();
    expect(GoalModel.updateLoopStatus).toHaveBeenLastCalledWith('g', 'needs_input');
    expect(GoalModel.updateStatus).toHaveBeenLastCalledWith('g', 'needs_review');
    expect(GoalModel.updateWorldState).toHaveBeenLastCalledWith('g', { needsInput: [expect.objectContaining({ taskId: 't1', what: ask.what, iteration: 1 })] });
    expect(broadcastToUser).toHaveBeenCalledWith('u', 'evt:GOAL_LOOP_ERROR', expect.objectContaining({ error: expect.stringContaining(ask.what) }));
    expect(sendToChat).toHaveBeenCalledWith('g', 'c1', 'needs_input', expect.stringContaining(ask.what));
    expect(TaskOrchestrator.runningGoals.has('g')).toBe(false);
  });

  it('Given the user starts the goal again, Then the blocked task is released to run again and the old ask is cleared', async () => {
    GoalModel.getWorldState.mockImplementation(async () => ({ needsInput: [{ taskId: 't1' }], best: { score: 3 } }));
    const written = [];
    GoalModel.updateWorldState.mockImplementation(async (id, state) => { written.push(structuredClone(state)); return 1; });
    let tasks = [blocked()];
    TaskModel.findByGoalId.mockImplementation(async () => structuredClone(tasks));
    TaskModel.updateStatus.mockImplementation(async (id, status) => { tasks = tasks.map((t) => (t.id === id ? { ...t, status } : t)); return 1; });
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockImplementation(async () => { tasks = [{ ...task, status: 'completed', output: '{}' }]; });
    Evaluator.evaluateGoal.mockResolvedValue({ passed: false, scores: { overall: 50 }, taskEvaluations: [] });
    vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);

    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });

    expect(TaskModel.updateStatus).toHaveBeenCalledWith('t1', 'pending', 0);
    // The world state is re-read each time, so the clear is one write that
    // drops the ask; other writes (resume bookkeeping) may precede it.
    expect(written.some((state) => !('needsInput' in state))).toBe(true);
    expect(result.status).toBe('max_iterations');
  });

  it('Given an ordinary failed task, Then the loop grades and re-plans as before', async () => {
    let tasks = [{ ...task, status: 'pending' }];
    TaskModel.findByGoalId.mockImplementation(async () => structuredClone(tasks));
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockImplementation(async () => { tasks = [{ ...task, status: 'failed', error: 'Did not pass review', output: JSON.stringify({ outcome: 'incomplete' }) }]; });
    Evaluator.evaluateGoal.mockResolvedValue({ passed: false, scores: { overall: 10 }, taskEvaluations: [] });
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);

    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });
    expect(Evaluator.evaluateGoal).toHaveBeenCalledTimes(1);
    expect(replan).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('max_iterations');
  });
});
