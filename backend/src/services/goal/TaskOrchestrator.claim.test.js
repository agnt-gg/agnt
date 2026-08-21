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
  delete process.env.AGNT_LOCAL_TASK_CONCURRENCY;
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

describe('dispatch is bounded, and bounded dispatch strands nothing', () => {
  /**
   * Replaces the default executeTask stub with one that MEASURES how many
   * tasks are genuinely in flight at once. Asserting on the ceiling any other
   * way (counting calls, inspecting batches) would pass just as happily
   * against an unbounded Promise.allSettled.
   */
  const measureConcurrency = () => {
    const seen = { inFlight: 0, max: 0 };
    TaskOrchestrator.executeTask.mockImplementation(async () => {
      seen.inFlight += 1;
      seen.max = Math.max(seen.max, seen.inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      seen.inFlight -= 1;
      return { content: 'ok' };
    });
    return seen;
  };

  const sixSiblings = () => [0, 1, 2, 3, 4, 5].map((n) => task(`t${n}`, 0));

  it('never runs more than the ceiling at once', async () => {
    process.env.AGNT_LOCAL_TASK_CONCURRENCY = '2';
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    const seen = measureConcurrency();

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(seen.max).toBeLessThanOrEqual(2);
  });

  it('still finishes every task in the group — a ceiling must not strand work', async () => {
    // THE regression guard for this change. executeGoalTasks visits each
    // order_index group exactly once, so a ceiling without the drain loop
    // would silently abandon four of these six on a single-node install.
    process.env.AGNT_LOCAL_TASK_CONCURRENCY = '2';
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    measureConcurrency();

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(executedIds().sort()).toEqual(['t0', 't1', 't2', 't3', 't4', 't5']);
  });

  it('applies a sane default when nothing is configured', async () => {
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    const seen = measureConcurrency();

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(seen.max).toBeLessThanOrEqual(4);
    expect(executedIds()).toHaveLength(6);
  });

  it('leaves the tasks it did not take PENDING for the fleet', async () => {
    // The point of the ceiling: unclaimed is the only state another node can
    // take work from. Anything past the ceiling must not be claimed, and must
    // not be marked failed either.
    process.env.AGNT_LOCAL_TASK_CONCURRENCY = '2';
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    // Simulate a fleet that takes everything this node leaves behind.
    const takenByFleet = new Set();
    TaskModel.claim.mockImplementation(async (id) => {
      if (takenByFleet.size >= 2) return false;
      takenByFleet.add(id);
      return true;
    });
    measureConcurrency();

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(executedIds()).toHaveLength(2);
    // A task another node is running is not this node's to fail.
    expect(TaskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('terminates when the whole group belongs to other nodes', async () => {
    // A drain loop that retried lost claims would spin here forever.
    process.env.AGNT_LOCAL_TASK_CONCURRENCY = '2';
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    TaskModel.claim.mockResolvedValue(false);

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(TaskOrchestrator.executeTask).not.toHaveBeenCalled();
  });

  it('comes back for a task whose dependency an earlier wave satisfied', async () => {
    // Previously a sibling blocked at the moment the group was visited was
    // skipped for good. Draining in waves means the wave that unblocks it is
    // followed by one that can run it.
    TaskModel.findByGoalId.mockResolvedValue([task('t1', 0), task('t2', 0)]);
    TaskModel.canExecuteTask.mockImplementation(async (id) => id === 't1' || executedIds().includes('t1'));

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    expect(executedIds()).toEqual(['t1', 't2']);
  });

  it('stops the goal when an entire wave fails', async () => {
    process.env.AGNT_LOCAL_TASK_CONCURRENCY = '2';
    TaskModel.findByGoalId.mockResolvedValue(sixSiblings());
    TaskOrchestrator.executeTask.mockRejectedValue(new Error('provider exploded'));

    await TaskOrchestrator.executeGoalTasks(GOAL, USER);

    // Two attempted, both failed, and the drain does NOT go on to burn the
    // remaining four against a provider that is evidently down.
    expect(TaskOrchestrator.executeTask).toHaveBeenCalledTimes(2);
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
