// Resume semantics for the autonomous goal loop.
//
// An interrupted run (backend restart, pause/stop) resumes from the iteration
// after the last recorded one, seeded with persisted best-tracking. A run
// whose previous loop reached a terminal state starts fresh — including
// clearing best-tracking, because monotone improvement is per-run: a daily
// scheduled goal must not judge today's iterations against yesterday's best.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recovery = vi.hoisted(() => ({ acquire:vi.fn(), inspect:vi.fn(), watch:vi.fn(), checkpoint:vi.fn() }));
vi.mock('./GoalRunRecovery.js',()=>({default:recovery}));
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

describe('Given the actual runner after a process restart',()=>{
 it('When durable ownership rejects unknown-outcome work, Then start does not reset tasks or dispatch',async()=>{
  recovery.acquire.mockRejectedValue(Error('Interrupted outcome requires reconciliation'));
  GoalModel.findOne.mockResolvedValue({id:'g',user_id:'u',status:'needs_review'});
  TaskModel.findByGoalId.mockResolvedValue([{id:'t',status:'running'}]);
  const dispatch=vi.spyOn(TaskOrchestrator,'executeGoalTasks').mockResolvedValue();
  try{await expect(TaskOrchestrator.executeGoal('g','u')).rejects.toThrow(/outcome/);
   expect(TaskModel.updateStatus).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
  }finally{dispatch.mockRestore();TaskOrchestrator.runningGoals.clear()}
 });
 it('When autonomous acquisition is refused, Then iteration and loop state remain untouched',async()=>{
  recovery.acquire.mockRejectedValue(Error('Interrupted outcome requires reconciliation'));
  await expect(TaskOrchestrator.executeGoalAutonomous('g','u')).rejects.toThrow(/outcome/);
  expect(GoalModel.updateMaxIterations).not.toHaveBeenCalled();expect(GoalModel.updateLoopStatus).not.toHaveBeenCalled();
 });
 it('When resume acquisition is refused, Then resumable labels do not override unknown outcome',async()=>{
  recovery.acquire.mockRejectedValue(Error('Interrupted outcome requires reconciliation'));
  GoalModel.findOne.mockResolvedValue({id:'g',user_id:'u'});
  TaskModel.findByGoalId.mockResolvedValue([{id:'t',status:'running'}]);
  const dispatch=vi.spyOn(TaskOrchestrator,'executeGoalTasks').mockResolvedValue();
  try{await expect(TaskOrchestrator.resumeGoal('g')).rejects.toThrow(/outcome/);
   expect(TaskModel.updateStatus).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
  }finally{dispatch.mockRestore();TaskOrchestrator.runningGoals.clear()}
 });
});
