// Dispatch must not run a task another node holds.
//
// TaskModel.claim.test.js proves the SQL decides correctly. This proves the
// orchestrator ASKS — that a lost claim removes the task from the batch before
// any work starts, and that a claim is never spent on a task whose
// dependencies are unmet.
//
// The single-node case is the one most at risk here: this file also pins that
// with no contention every claim succeeds and dispatch behaves exactly as it
// did before claiming existed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { run: vi.fn(), get: vi.fn(), all: vi.fn() } }));
vi.mock('../../models/GoalModel.js', () => ({
  default: { findOne: vi.fn(), updateStatus: vi.fn(), getWorldState: vi.fn(async () => ({})) },
}));
vi.mock('../../models/TaskModel.js', () => ({
  default: {
    DEFAULT_LEASE_MS: 120000,
    findByGoalId: vi.fn(async () => []),
    updateStatus: vi.fn(),
    canExecuteTask: vi.fn(async () => true),
    claim: vi.fn(async () => true),
    renewClaim: vi.fn(async () => true),
    releaseClaim: vi.fn(async () => true),
  },
}));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(async () => null), create: vi.fn(), prune: vi.fn() } }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: {} }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: {} }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: {} }));
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn() }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../orchestrator/tools.js', () => ({ getAvailableToolSchemas: vi.fn(() => []) }));
vi.mock('../ai/providerConfigs.js', () => ({ getProviderConfig: vi.fn() }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: vi.fn(),
  RealtimeEvents: new Proxy({}, { get: (_t, p) => `evt:${String(p)}` }),
}));
vi.mock('../cluster/nodeIdentity.js', () => ({ getNodeId: () => 'node-under-test' }));

const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');
const { default: TaskModel } = await import('../../models/TaskModel.js');

const GOAL = 'goal-1';
const USER = 'user-1';

const task = (id, orderIndex = 0) => ({
  id,
  goal_id: GOAL,
  title: `task ${id}`,
  description: '',
  status: 'pending',
  order_index: orderIndex,
  dependencies: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  TaskModel.canExecuteTask.mockResolvedValue(true);
  TaskModel.claim.mockResolvedValue(true);
  TaskModel.renewClaim.mockResolvedValue(true);
  TaskModel.releaseClaim.mockResolvedValue(true);

  TaskOrchestrator.runningGoals.set(GOAL, { userId: USER, abortController: new AbortController() });
  vi.spyOn(TaskOrchestrator, 'executeTask').mockResolvedValue({ content: 'ok' });
  vi.spyOn(TaskOrchestrator, 'checkGoalCompletion').mockResolvedValue(false);
});

afterEach(() => {
  TaskOrchestrator.runningGoals.delete(GOAL);
  vi.restoreAllMocks();
});

const executedIds = () => TaskOrchestrator.executeTask.mock.calls.map(([t]) => t.id);

describe('a claim gates dispatch', () => {
  it('runs a task it successfully claimed', async () => {
    TaskModel.findByGoalId.mockResolvedValue([task('t1')]);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(TaskModel.claim).toHaveBeenCalledWith('t1', 'node-under-test');
    expect(executedIds()).toEqual(['t1']);
  });

  it('does NOT run a task another node holds', async () => {
    TaskModel.findByGoalId.mockResolvedValue([task('t1')]);
    TaskModel.claim.mockResolvedValue(false);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    // The whole point: a lost claim must remove the task from the batch
    // BEFORE any work begins, not abandon it halfway through.
    expect(TaskOrchestrator.executeTask).not.toHaveBeenCalled();
    expect(TaskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('runs only the tasks it won, within one parallel group', async () => {
    TaskModel.findByGoalId.mockResolvedValue([task('t1', 0), task('t2', 0), task('t3', 0)]);
    TaskModel.claim.mockImplementation(async (id) => id !== 't2');

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(executedIds().sort()).toEqual(['t1', 't3']);
  });

  it('never spends a claim on a task whose dependencies are unmet', async () => {
    TaskModel.findByGoalId.mockResolvedValue([task('t1')]);
    TaskModel.canExecuteTask.mockResolvedValue(false);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    // Claiming a blocked task burns an attempt and holds it away from the node
    // that could legitimately run it once the dependency lands.
    expect(TaskModel.claim).not.toHaveBeenCalled();
    expect(TaskOrchestrator.executeTask).not.toHaveBeenCalled();
  });

  it('skips a task that is already completed without claiming it', async () => {
    TaskModel.findByGoalId.mockResolvedValue([{ ...task('t1'), status: 'completed', output: null }]);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(TaskModel.claim).not.toHaveBeenCalled();
  });
});

describe('single-node behaviour is unchanged', () => {
  it('claims and runs every eligible task, in order_index order', async () => {
    TaskModel.findByGoalId.mockResolvedValue([task('t2', 1), task('t1', 0), task('t3', 2)]);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    // With one node there is no contention, so dispatch is exactly what it was
    // before claiming existed.
    expect(executedIds()).toEqual(['t1', 't2', 't3']);
  });
});

describe('_holdClaim keeps the lease alive across a long task', () => {
  it('renews on a timer and stops when the task ends', () => {
    vi.useFakeTimers();
    try {
      const stop = TaskOrchestrator._holdClaim('t1', 3000);

      vi.advanceTimersByTime(1000);
      expect(TaskModel.renewClaim).toHaveBeenCalledWith('t1', 'node-under-test', 3000);

      vi.advanceTimersByTime(2000);
      expect(TaskModel.renewClaim).toHaveBeenCalledTimes(3);

      stop();
      vi.advanceTimersByTime(10000);
      // A renewal after the task is done would keep a claim alive on work
      // nobody is doing.
      expect(TaskModel.renewClaim).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is safe to stop more than once', () => {
    const stop = TaskOrchestrator._holdClaim('t1');
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it('swallows a failed renewal instead of taking down the process', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      TaskModel.renewClaim.mockRejectedValue(new Error('db is locked'));
      const stop = TaskOrchestrator._holdClaim('t1', 3000);

      vi.advanceTimersByTime(1000);
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      // An unhandled rejection from a timer would end the process over a
      // bookkeeping write.
      expect(warn.mock.calls[0][0]).toContain('db is locked');
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
