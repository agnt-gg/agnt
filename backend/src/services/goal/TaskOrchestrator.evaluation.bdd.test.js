// Resume semantics for the autonomous goal loop.
//
// An interrupted run (backend restart, pause/stop) resumes from the iteration
// after the last recorded one, seeded with persisted best-tracking. A run
// whose previous loop reached a terminal state starts fresh — including
// clearing best-tracking, because monotone improvement is per-run: a daily
// scheduled goal must not judge today's iterations against yesterday's best.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { run: vi.fn(), get: vi.fn(), all: vi.fn() } }));
vi.mock('../../models/GoalModel.js', () => ({
  default: {
    findOne: vi.fn(),
    getWorldState: vi.fn(async () => ({})),
    updateWorldState: vi.fn(async () => 1),
    updateMaxIterations: vi.fn(),
    updateLoopStatus: vi.fn(),
    updateStatus: vi.fn(),
    updateIteration: vi.fn(),
  },
}));
vi.mock('../../models/TaskModel.js', () => ({ default: { findByGoalId: vi.fn(async () => []), updateStatus: vi.fn() } }));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(async () => null), create: vi.fn(), prune: vi.fn() } }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: {evaluateGoal:vi.fn()} }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: {onGoalCompleted:vi.fn()} }));
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

const { default: Evaluator } = await import('./GoalEvaluator.js');
const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');
const { default: GoalModel } = await import('../../models/GoalModel.js');
const { default: TaskModel } = await import('../../models/TaskModel.js');
const { default: GoalIterationModel } = await import('../../models/GoalIterationModel.js');

beforeEach(() => {
  vi.clearAllMocks();
  GoalModel.getWorldState.mockResolvedValue({});
  GoalModel.updateWorldState.mockResolvedValue(1);
  GoalIterationModel.findOne.mockResolvedValue(null);
});

describe('_resolveResumeState', () => {
  it('starts fresh after a terminal run and clears stale best-tracking', async () => {
    GoalModel.findOne.mockResolvedValue({ loop_status: 'completed', current_iteration: 7 });
    GoalModel.getWorldState.mockResolvedValue({ best: { score: 90, iteration: 5 }, other: 'kept' });

    const r = await TaskOrchestrator._resolveResumeState('g1', 50);

    expect(r).toEqual({ startIteration: 1, bestScore: 0, bestIteration: 0, bestTaskSnapshot: null });
    expect(GoalModel.updateWorldState).toHaveBeenCalledWith('g1', { other: 'kept' });
  });

  it('resumes an interrupted run from the next iteration with seeded best', async () => {
    GoalModel.findOne.mockResolvedValue({ loop_status: 'stopped', current_iteration: 3 });
    GoalModel.getWorldState.mockResolvedValue({ best: { score: 72, iteration: 2 } });
    GoalIterationModel.findOne.mockResolvedValue({ task_snapshot: [{ id: 't1' }] });

    const r = await TaskOrchestrator._resolveResumeState('g1', 50);

    expect(r).toEqual({ startIteration: 4, bestScore: 72, bestIteration: 2, bestTaskSnapshot: [{ id: 't1' }] });
    // The best snapshot is recovered from the DB record of the best iteration
    expect(GoalIterationModel.findOne).toHaveBeenCalledWith('g1', 2);
    // Resuming must not clear persisted best-tracking
    expect(GoalModel.updateWorldState).not.toHaveBeenCalled();
  });

  it('resumes without a snapshot when the best iteration record predates task snapshots', async () => {
    GoalModel.findOne.mockResolvedValue({ loop_status: 'executing', current_iteration: 2 });
    GoalModel.getWorldState.mockResolvedValue({ best: { score: 40, iteration: 1 } });
    GoalIterationModel.findOne.mockResolvedValue({ task_snapshot: null });

    const r = await TaskOrchestrator._resolveResumeState('g1', 50);
    expect(r.startIteration).toBe(3);
    expect(r.bestTaskSnapshot).toBeNull();
  });

  it('starts fresh when the interrupted run had already exhausted its iterations', async () => {
    GoalModel.findOne.mockResolvedValue({ loop_status: 'executing', current_iteration: 50 });
    const r = await TaskOrchestrator._resolveResumeState('g1', 50);
    expect(r.startIteration).toBe(1);
  });

  it('starts fresh for a goal that has never run', async () => {
    GoalModel.findOne.mockResolvedValue({ loop_status: null, current_iteration: 0 });
    const r = await TaskOrchestrator._resolveResumeState('g1', 50);
    expect(r.startIteration).toBe(1);
  });

  it('degrades to a fresh start if state resolution itself fails', async () => {
    GoalModel.findOne.mockRejectedValue(new Error('db unavailable'));
    const r = await TaskOrchestrator._resolveResumeState('g1', 50);
    expect(r).toEqual({ startIteration: 1, bestScore: 0, bestIteration: 0, bestTaskSnapshot: null });
  });
});

describe('_captureTaskSnapshot', () => {
  it('captures exactly the restorable task fields', async () => {
    TaskModel.findByGoalId.mockResolvedValue([
      { id: 't1', title: 'T', description: 'D', status: 'completed', progress: 100, output: '{"x":1}', error: null, agent_id: 'IGNORED', order_index: 9 },
      { id: 't2', title: 'U', description: 'E', status: 'failed', progress: undefined, output: undefined, error: 'boom' },
    ]);

    const snap = await TaskOrchestrator._captureTaskSnapshot('g1');

    expect(snap).toEqual([
      { id: 't1', title: 'T', description: 'D', status: 'completed', progress: 100, output: '{"x":1}', error: null },
      { id: 't2', title: 'U', description: 'E', status: 'failed', progress: 0, output: null, error: 'boom' },
    ]);
  });
});

describe('autonomous validation cannot be inferred from task counts',()=>{
 it.each(['negative','error','positive'])('Given all rows completed and %s evaluation, Then honor actual outcome',async kind=>{
  GoalModel.findOne.mockResolvedValue({loop_status:null,current_iteration:0});
  TaskModel.findByGoalId.mockResolvedValue([{id:'t',title:'Task',status:'completed',output:JSON.stringify({content:'Verified fixture'})}]);
  const execute=vi.spyOn(TaskOrchestrator,'executeGoalTasks').mockResolvedValue();
  const replan=vi.spyOn(TaskOrchestrator,'_replanFailedTasks').mockResolvedValue([]);
  const state=vi.spyOn(TaskOrchestrator,'_updateWorldState').mockResolvedValue({});
  if(kind==='error')Evaluator.evaluateGoal.mockRejectedValue(Error('evaluator unavailable'));
  else Evaluator.evaluateGoal.mockResolvedValue({passed:kind==='positive',scores:{overall:kind==='positive'?80:44.9},taskEvaluations:[{taskId:'t',score:kind==='positive'?80:44.9,criteriaMet:{deliverable:true}}]});
  try {
   await TaskOrchestrator.executeGoalAutonomous('g','u',{maxIterations:1,provider:'openai',model:'test'});
   const validated=GoalModel.updateStatus.mock.calls.some(c=>c[1]==='validated');
   expect(validated).toBe(kind==='positive');
   if(kind==='error')expect(replan).not.toHaveBeenCalled();
  } finally {execute.mockRestore();replan.mockRestore();state.mockRestore();TaskOrchestrator.runningGoals.clear();}
 });
});
