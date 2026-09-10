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
   expect(validated).toBe(false); // evaluator owns the atomic validation write
   if(kind==='error')expect(replan).not.toHaveBeenCalled();
  } finally {execute.mockRestore();replan.mockRestore();state.mockRestore();TaskOrchestrator.runningGoals.clear();}
 });
});

describe('non-autonomous completion never announces success before evaluation',()=>{
 it('Given evaluator unavailable, Then needs_review and never completed/validated',async()=>{
  TaskOrchestrator.runningGoals.set('g',{userId:'u',provider:'openai',model:'test'});
  GoalModel.findOne.mockResolvedValue({id:'g',user_id:'u',status:'executing',lifecycle_revision:1});
  GoalModel.updateStatus.mockResolvedValue(1);
  Evaluator.evaluateGoal.mockRejectedValue(Error('evaluator unavailable'));
  await TaskOrchestrator.completeGoal('g');
  expect(GoalModel.updateStatus.mock.calls.some(c=>['completed','validated'].includes(c[1]))).toBe(false);
  expect(GoalModel.updateStatus).toHaveBeenCalledWith('g','needs_review',null,{userId:'u',revision:1});
  expect(TaskOrchestrator.runningGoals.has('g')).toBe(false);
 });
});
