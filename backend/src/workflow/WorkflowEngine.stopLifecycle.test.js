import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stop has to mean stopped.
 *
 * Every case here failed before the stop-lifecycle fix: a stopped engine still
 * accepted triggers on both the queue and the synchronous waitForCompletion
 * path, kept whatever was already queued, rescheduled its own drain forever on
 * a non-empty queue, and recorded `undefined` as the reason for an external
 * stop.
 *
 * The last two cases pin the boundary of the guard rather than the defect:
 * "never armed listeners" is NOT "stopped", and the finalized-execution cache
 * is a fast path, not a leak.
 */

vi.mock('../models/WorkflowModel.js', () => ({ default: { updateStatus: vi.fn() } }));
vi.mock('../models/database/index.js', () => ({
  default: { run: vi.fn() },
  dbRunWithRetry: vi.fn(async (fn) => fn()),
}));
vi.mock('../models/ExecutionModel.js', () => ({ default: { update: vi.fn(async () => 1) } }));
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {}, actions: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../tools/library/utilities/counter.js', () => ({ default: { reset: vi.fn() } }));
vi.mock('../tools/library/controls/run-workflow.js', () => ({ default: vi.fn() }));
vi.mock('./NodeExecutor.js', () => ({ default: class NodeExecutor {} }));
vi.mock('./EdgeEvaluator.js', () => ({ default: class EdgeEvaluator {} }));
vi.mock('./ParameterResolver.js', () => ({ default: class ParameterResolver {} }));

const { default: WorkflowEngine } = await import('./WorkflowEngine.js');
const { default: ExecutionModel } = await import('../models/ExecutionModel.js');

const validWorkflow = () => ({
  id: 'wf-1',
  nodes: [
    { id: 'n1', text: 'Timer Trigger', type: 'trigger-timer', category: 'trigger', parameters: {} },
    { id: 'n2', text: 'Run JS', type: 'execute-javascript', category: 'action', parameters: {} },
  ],
  edges: [{ id: 'e1', start: { id: 'n1', type: 'output' }, end: { id: 'n2', type: 'input' } }],
});

const newEngine = () => new WorkflowEngine(validWorkflow(), 'wf-1', 'user-1');

describe('WorkflowEngine — a stopped engine stays stopped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a queued trigger that arrives after stop', async () => {
    const engine = newEngine();
    engine._executeWorkflow = vi.fn();
    await engine.setupWorkflowListeners();
    await engine.stopWorkflowListeners();

    const result = await engine.processWorkflowTrigger({ late: true });

    expect(result).toMatchObject({ rejected: true, reason: 'workflow-stopped' });
    expect(engine._executeWorkflow).not.toHaveBeenCalled();
    expect(engine.triggerQueue).toEqual([]);
  });

  it('rejects a synchronous waitForCompletion trigger that arrives after stop', async () => {
    const engine = newEngine();
    engine._executeWorkflow = vi.fn();
    await engine.setupWorkflowListeners();
    await engine.stopWorkflowListeners();

    const result = await engine.processWorkflowTrigger({ late: true }, { waitForCompletion: true });

    // This is the path that used to bypass the flags entirely and execute.
    expect(result).toMatchObject({ rejected: true, reason: 'workflow-stopped' });
    expect(engine._executeWorkflow).not.toHaveBeenCalled();
  });

  it('discards work already waiting in the queue when stopped', async () => {
    const engine = newEngine();
    engine.triggerQueue = [{ pending: 1 }, { pending: 2 }];

    await engine.stopWorkflowListeners();

    expect(engine.triggerQueue).toEqual([]);
  });

  it('does not reschedule its own drain while stopped', async () => {
    const engine = newEngine();
    engine.stopRequested = true;
    engine.triggerQueue = [{ pending: 1 }];
    // Intercepted: on the unfixed engine this reschedules itself forever.
    const scheduled = vi.spyOn(globalThis, 'setImmediate').mockImplementation(() => 0);

    try {
      await engine._handleTriggerQueue();

      expect(scheduled).not.toHaveBeenCalled();
      // Returned before claiming the run slot, so the queued item is untouched.
      expect(engine.isRunning).toBeFalsy();
      expect(engine.triggerQueue).toHaveLength(1);
    } finally {
      scheduled.mockRestore();
    }
  });

  it('records a reason for an external stop instead of writing undefined', async () => {
    const engine = newEngine();

    await engine.stopWorkflowListeners();

    expect(typeof engine.stopReason).toBe('string');
    expect(engine.stopReason.length).toBeGreaterThan(0);
  });

  it('preserves an explicit stop reason set by a Stop Workflow node', async () => {
    const engine = newEngine();
    engine.stopReason = 'Stopped by the Stop Workflow node';

    await engine.stopWorkflowListeners();

    expect(engine.stopReason).toBe('Stopped by the Stop Workflow node');
  });
});

describe('WorkflowEngine — never armed is not stopped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the first trigger for an engine that never called setupWorkflowListeners', async () => {
    // Sub-workflow engines and direct programmatic callers construct an engine
    // and drive it straight through processWorkflowTrigger. Keying the guard on
    // isListening would refuse them on their very first run.
    const engine = new WorkflowEngine(validWorkflow(), 'child-wf', 'user-1', true);
    engine._executeWorkflow = vi.fn().mockResolvedValue({ success: true });

    const result = await engine.processWorkflowTrigger({ fromParent: true }, { waitForCompletion: true });

    expect(result).toEqual({ success: true });
    expect(engine._executeWorkflow).toHaveBeenCalledTimes(1);
    expect(engine.isListening).toBe(false);
  });

  it('still rejects that same engine once it has been stopped', async () => {
    const engine = new WorkflowEngine(validWorkflow(), 'child-wf', 'user-1', true);
    engine._executeWorkflow = vi.fn().mockResolvedValue({ success: true });
    await engine.processWorkflowTrigger({ first: true }, { waitForCompletion: true });

    await engine.stopWorkflowListeners();
    const result = await engine.processWorkflowTrigger({ second: true }, { waitForCompletion: true });

    expect(result).toMatchObject({ rejected: true });
    expect(engine._executeWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowEngine — finalized executions are remembered, not accumulated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a terminal status once per execution', async () => {
    const engine = newEngine();

    await engine._finalizeExecution('run-1', 'completed', 'log', 3);
    const second = await engine._finalizeExecution('run-1', 'stopped', 'later log', 0);

    expect(ExecutionModel.update).toHaveBeenCalledTimes(1);
    expect(ExecutionModel.update).toHaveBeenCalledWith('run-1', 'completed', 'log', 3);
    expect(second).toBe(0);
  });

  it('keeps the cache bounded on a long-lived listening engine', async () => {
    const engine = newEngine();

    for (let i = 0; i < 250; i += 1) {
      await engine._finalizeExecution(`run-${i}`, 'completed', 'log', 0);
    }

    expect(ExecutionModel.update).toHaveBeenCalledTimes(250);
    expect(engine.finalizedExecutions.size).toBeLessThanOrEqual(100);
    // The most recent run is what a late duplicate write would race against.
    expect(engine.finalizedExecutions.has('run-249')).toBe(true);
  });

  it('does not cache an execution the database guard refused', async () => {
    const engine = newEngine();
    ExecutionModel.update.mockResolvedValueOnce(0);

    await engine._finalizeExecution('run-refused', 'stopped', 'log', 0);

    expect(engine.finalizedExecutions.has('run-refused')).toBe(false);
  });
});
