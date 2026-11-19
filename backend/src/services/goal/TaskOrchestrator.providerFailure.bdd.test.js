// A goal task whose model the account cannot run must not take the routine
// down with it. Regression: a daily digest's search task was matched to an
// agent pinned to a model a ChatGPT-account Codex login refuses. Every run
// failed at dispatch, the account's working default was never tried, and the
// loop graded the error notice and re-planned the tasks 50 times a day until
// they read "OPERATOR ACTION REQUIRED" and "SKIP (no-op)".
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
vi.mock('../../models/TaskModel.js', () => ({
  default: {
    findByGoalId: vi.fn(),
    updateStatus: vi.fn(async () => 1),
    assignAgent: vi.fn(async () => 1),
    releaseClaim: vi.fn(async () => 1),
    renewClaim: vi.fn(async () => 1),
    recordPlan: vi.fn(async () => 0),
  },
}));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(async () => null), create: vi.fn(async () => 7), prune: vi.fn(), setReplannedTasks: vi.fn(), earliestTaskSnapshot: vi.fn(async () => null) } }));
vi.mock('../ai/ModelRouter.js', () => ({ complete: vi.fn(), resolveChain: vi.fn(), canonicalProvider: (provider) => String(provider || '').toLowerCase() }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: { selectAgentForTask: vi.fn() } }));
vi.mock('./GoalEvaluator.js', () => ({ default: { evaluateGoal: vi.fn(), evaluateTask: vi.fn(), aiEvaluateTaskOutput: vi.fn() } }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: { onGoalCompleted: vi.fn() } }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: { executeWithTools: vi.fn() } }));
vi.mock('../orchestrator/agentRuntime.js', () => ({ buildAgentRuntime: vi.fn(async () => ({ systemPrompt: 'Prompt', toolSchemas: [], context: {} })) }));
vi.mock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({ selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5-5', maxToolRounds: 50 })) } }));
vi.mock('../AutonomousMessageService.js', () => ({ default: { triggerAutonomousMessage: vi.fn(async () => {}) } }));
vi.mock('../cluster/nodeIdentity.js', () => ({ getNodeId: () => 'node-1' }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: new Proxy({}, { get: (_t, p) => `evt:${String(p)}` }) }));

const { default: TaskOrchestrator } = await import('./TaskOrchestrator.js');
const { default: GoalModel } = await import('../../models/GoalModel.js');
const { default: TaskModel } = await import('../../models/TaskModel.js');
const { default: Evaluator } = await import('./GoalEvaluator.js');
const { default: AgentTaskMatcher } = await import('./AgentTaskMatcher.js');
const { default: LlmExecutionService } = await import('../ai/LlmExecutionService.js');
const { resolveChain } = await import('../ai/ModelRouter.js');

const UNSUPPORTED = "Codex Responses API Error: 400 The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.";
const pinnedAgent = { id: 'agent-motion', name: 'Motion Lab', provider: 'OpenAI-Codex', model: 'gpt-6-astra' };
const task = { id: 't1', goal_id: 'g', title: 'Search for recent AI news', description: 'Find 15 stories from the last 7 days' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  TaskOrchestrator.runningGoals.clear();
  GoalModel.findOne.mockResolvedValue({ id: 'g', success_criteria: {}, loop_status: null, current_iteration: 0 });
  GoalModel.getWorldState.mockResolvedValue({});
  resolveChain.mockResolvedValue({
    chain: [
      { provider: 'openai-codex', model: 'gpt-6-astra', tier: 0 },
      { provider: 'claude-code', model: 'claude-opus-5-5', tier: 1 },
      { provider: 'gemini', model: 'gemini-2.5-pro', tier: 2 },
    ],
  });
});

describe('the chain a goal task runs on', () => {
  it('Given an agent pinned to a model, Then the pin leads exactly as given and the account chain follows', async () => {
    const chain = await TaskOrchestrator._providerChainFor('u', 'OpenAI-Codex', 'gpt-6-astra', 'goal_task');
    expect(resolveChain).toHaveBeenCalledWith({ userId: 'u', origin: 'goal_task', requested: { provider: 'OpenAI-Codex', model: 'gpt-6-astra' } });
    expect(chain).toEqual([
      { provider: 'OpenAI-Codex', model: 'gpt-6-astra' },
      { provider: 'claude-code', model: 'claude-opus-5-5' },
      { provider: 'gemini', model: 'gemini-2.5-pro' },
    ]);
  });

  it('Given the chain cannot be resolved, Then the task runs on its pair alone', async () => {
    resolveChain.mockRejectedValueOnce(new Error('settings unavailable'));
    expect(await TaskOrchestrator._providerChainFor('u', 'OpenAI-Codex', 'gpt-6-astra')).toBeNull();
  });

  it('Given a task, Then its execution carries the chain, and a final error notice marks it provider-failed', async () => {
    LlmExecutionService.executeWithTools.mockResolvedValue({ content: `⚠️ ${UNSUPPORTED}`, toolExecutions: [], recoveredFromError: true, recoveredError: UNSUPPORTED });
    const result = await TaskOrchestrator.executeTaskViaAgentChat(pinnedAgent, 'Do it', 'u', null, null, null, { origin: 'goal_task', originId: 'g' });
    expect(LlmExecutionService.executeWithTools.mock.calls[0][0]).toMatchObject({
      provider: 'OpenAI-Codex',
      model: 'gpt-6-astra',
      providerChain: [{ provider: 'OpenAI-Codex', model: 'gpt-6-astra' }, { provider: 'claude-code', model: 'claude-opus-5-5' }, { provider: 'gemini', model: 'gemini-2.5-pro' }],
    });
    expect(result).toMatchObject({ success: false, error: UNSUPPORTED, providerFailed: true });
  });

  it('Given the chain answered, Then the result is not provider-failed', async () => {
    LlmExecutionService.executeWithTools.mockResolvedValue({ content: 'Fifteen stories.', toolExecutions: [] });
    const result = await TaskOrchestrator.executeTaskViaAgentChat(pinnedAgent, 'Do it', 'u', null, null, null, { origin: 'goal_task', originId: 'g' });
    expect(result.providerFailed).toBeUndefined();
    expect(result.success).toBeUndefined();
  });
});

describe('a task no model could run', () => {
  it('Given the chain failed, Then the work ends at once, ungraded, as a provider error', async () => {
    const execute = vi.spyOn(TaskOrchestrator, 'executeTaskViaAgentChat').mockResolvedValue({ content: `⚠️ ${UNSUPPORTED}`, success: false, error: UNSUPPORTED, providerFailed: true, tool_executions: [] });
    const review = vi.spyOn(TaskOrchestrator, '_reviewTaskResult');
    const { review: verdict } = await TaskOrchestrator._workTask(task, pinnedAgent, 'Do it', 'u', null, null, null, null);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    expect(verdict).toEqual({ rejected: true, code: 'PROVIDER_ERROR', feedback: `No model could run this task: ${UNSUPPORTED}` });
  });

  it('Given the work ended on a provider error, Then the task fails with that outcome and error', async () => {
    AgentTaskMatcher.selectAgentForTask.mockResolvedValue(pinnedAgent);
    vi.spyOn(TaskOrchestrator, '_workTask').mockResolvedValue({
      result: { content: `⚠️ ${UNSUPPORTED}`, tool_executions: [] },
      review: { rejected: true, code: 'PROVIDER_ERROR', feedback: `No model could run this task: ${UNSUPPORTED}` },
    });
    await expect(TaskOrchestrator.executeTask(task, 'u')).rejects.toMatchObject({ code: 'TASK_PROVIDER_ERROR' });
    const failedWrite = TaskModel.updateStatus.mock.calls.find((call) => call[1] === 'failed' && call[6]);
    expect(failedWrite[6]).toMatchObject({ outcome: 'provider_error' });
    expect(failedWrite[7]).toBe(`No model could run this task: ${UNSUPPORTED}`);
  });
});

describe('the autonomous loop', () => {
  const lostToProvider = () => ({ ...task, status: 'failed', error: `No model could run this task: ${UNSUPPORTED}`, output: JSON.stringify({ outcome: 'provider_error' }) });

  it('Given a task no model could run, Then the run stops with the error instead of grading and re-planning', async () => {
    let tasks = [{ ...task, status: 'pending' }];
    TaskModel.findByGoalId.mockImplementation(async () => structuredClone(tasks));
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockImplementation(async () => { tasks = [lostToProvider()]; });
    const replan = vi.spyOn(TaskOrchestrator, '_replanFailedTasks');
    const sendToChat = vi.spyOn(TaskOrchestrator, '_sendGoalFailureToChat').mockResolvedValue();

    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 50, conversationId: 'c1' });

    expect(result).toEqual({ goalId: 'g', status: 'error', reason: 'provider_error', iteration: 1, error: `Search for recent AI news: No model could run this task: ${UNSUPPORTED}` });
    expect(Evaluator.evaluateGoal).not.toHaveBeenCalled();
    expect(replan).not.toHaveBeenCalled();
    expect(TaskOrchestrator.executeGoalTasks).toHaveBeenCalledTimes(1);
    expect(GoalModel.updateLoopStatus).toHaveBeenLastCalledWith('g', 'error');
    expect(GoalModel.updateStatus).toHaveBeenLastCalledWith('g', 'failed');
    expect(sendToChat).toHaveBeenCalledWith('g', 'c1', 'provider_error', expect.stringContaining(UNSUPPORTED));
    expect(TaskOrchestrator.runningGoals.has('g')).toBe(false);
  });

  it('Given the goal runs again, Then the task a provider failure stopped is released to run', async () => {
    let tasks = [lostToProvider()];
    TaskModel.findByGoalId.mockImplementation(async () => structuredClone(tasks));
    TaskModel.updateStatus.mockImplementation(async (id, status) => { tasks = tasks.map((t) => (t.id === id ? { ...t, status, output: null } : t)); return 1; });
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockImplementation(async () => { tasks = [{ ...task, status: 'completed', output: '{}' }]; });
    Evaluator.evaluateGoal.mockResolvedValue({ passed: false, scores: { overall: 50 }, taskEvaluations: [] });
    vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);

    const result = await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });

    expect(TaskModel.updateStatus).toHaveBeenCalledWith('t1', 'pending', 0);
    expect(result.status).toBe('max_iterations');
  });

  it('Given any run, Then the task plans are recorded before the loop can re-plan or prune', async () => {
    TaskModel.findByGoalId.mockResolvedValue([{ ...task, status: 'pending' }]);
    vi.spyOn(TaskOrchestrator, 'executeGoalTasks').mockResolvedValue();
    Evaluator.evaluateGoal.mockResolvedValue({ passed: false, scores: { overall: 5 }, taskEvaluations: [] });
    vi.spyOn(TaskOrchestrator, '_replanFailedTasks').mockResolvedValue([]);

    await TaskOrchestrator.executeGoalAutonomous('g', 'u', { maxIterations: 1 });

    expect(TaskModel.recordPlan).toHaveBeenCalledWith('g', expect.any(Function));
    expect(TaskModel.recordPlan.mock.invocationCallOrder[0]).toBeLessThan(TaskOrchestrator.executeGoalTasks.mock.invocationCallOrder[0]);
  });
});
