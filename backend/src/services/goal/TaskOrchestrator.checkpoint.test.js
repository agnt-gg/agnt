// The checkpoint gate: a task's work is graded before it is marked completed,
// gets one retry with the findings, and fails rather than letting dependents
// build on work that did not pass.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: {} }));
vi.mock('../../models/GoalModel.js', () => ({ default: { getWorldState: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../models/TaskModel.js', () => ({ default: { updateStatus: vi.fn(async () => 1), assignAgent: vi.fn(), releaseClaim: vi.fn(async () => 1) } }));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: { selectAgentForTask: vi.fn() } }));
vi.mock('./GoalEvaluator.js', () => ({ default: { evaluateTask: vi.fn() } }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: {} }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: { executeWithTools: vi.fn() } }));
vi.mock('../orchestrator/agentRuntime.js', () => ({ buildAgentRuntime: vi.fn() }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../cluster/nodeIdentity.js', () => ({ getNodeId: vi.fn(() => 'node') }));
vi.mock('../cluster/admission.js', () => ({ checkSpendAdmission: vi.fn() }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: {} }));

import TaskOrchestrator from './TaskOrchestrator.js';
import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import AgentTaskMatcher from './AgentTaskMatcher.js';
import GoalEvaluator from './GoalEvaluator.js';

const task = { id: 't1', goal_id: 'g1', title: 'Draft', description: 'Write the draft' };
const pass = { score: 92, criteriaMet: { draft: true }, feedback: 'Good.' };
// A high score with an unmet criterion: the gate goes by criteria, not by score.
const fail = { score: 85, criteriaMet: { draft: false }, feedback: 'Pricing section is missing.' };
const unavailable = { score: 50, criteriaMet: { evaluated: false, error: true }, feedback: 'Unable to evaluate' };
let agentChat;
const statuses = () => TaskModel.updateStatus.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(TaskOrchestrator, '_holdClaim').mockReturnValue(() => {});
  vi.spyOn(TaskOrchestrator, 'storeTaskResults').mockResolvedValue();
  agentChat = vi.spyOn(TaskOrchestrator, 'executeTaskViaAgentChat').mockResolvedValue({ content: 'The draft.', tool_executions: [] });
  AgentTaskMatcher.selectAgentForTask.mockResolvedValue({ id: 'exec', isBuiltIn: true, name: 'Task Executor' });
  GoalModel.getWorldState.mockResolvedValue({});
  GoalModel.findOne.mockResolvedValue({ id: 'g1', success_criteria: { deliverables: ['Draft'] } });
});

describe('checkpoint gate', () => {
  it('Given work that passes review, Then it completes after one attempt', async () => {
    GoalEvaluator.evaluateTask.mockResolvedValue(pass);
    await TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm');
    expect(agentChat).toHaveBeenCalledTimes(1);
    expect(statuses()).toContain('completed');
  });

  it('Given work that fails review once, Then it is redone with the findings and completes', async () => {
    GoalEvaluator.evaluateTask.mockResolvedValueOnce(fail).mockResolvedValueOnce(pass);
    await TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm');
    expect(agentChat).toHaveBeenCalledTimes(2);
    expect(agentChat.mock.calls[1][1]).toContain('Pricing section is missing.');
    expect(statuses()).toContain('completed');
  });

  it('Given work that fails review twice, Then the task fails with the reason and is never completed', async () => {
    GoalEvaluator.evaluateTask.mockResolvedValue(fail);
    await expect(TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm')).rejects.toMatchObject({ code: 'TASK_REVIEW_FAILED' });
    expect(agentChat).toHaveBeenCalledTimes(2);
    expect(statuses()).not.toContain('completed');
    const failedWrite = TaskModel.updateStatus.mock.calls.find((call) => call[1] === 'failed' && call[7]);
    expect(failedWrite[7]).toMatch(/CRITERIA_UNMET.*Pricing section is missing/);
    expect(failedWrite[6]).toMatchObject({ content: 'The draft.', outcome: 'incomplete' });
  });

  it('Given the grader is down, Then the work goes through and no retry is spent', async () => {
    GoalEvaluator.evaluateTask.mockResolvedValue(unavailable);
    await TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm');
    expect(agentChat).toHaveBeenCalledTimes(1);
    expect(statuses()).toContain('completed');
  });

  it('Given a self-reported blocker, Then it fails as before without a grader call', async () => {
    agentChat.mockResolvedValue({ content: '## Status: Blocked — no access', tool_executions: [] });
    await expect(TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm')).rejects.toThrow(/blocked/i);
    expect(GoalEvaluator.evaluateTask).not.toHaveBeenCalled();
    expect(statuses()).not.toContain('completed');
  });
});

describe('reviewer feedback reaches the worker', () => {
  it('Given stored reviewer feedback, Then every task message carries it', async () => {
    GoalModel.getWorldState.mockResolvedValue({ reviewerFeedback: [{ text: 'Add pricing', at: 't' }] });
    GoalEvaluator.evaluateTask.mockResolvedValue(pass);
    await TaskOrchestrator.executeTask(task, 'u', null, 'openai', 'm');
    expect(agentChat.mock.calls[0][1]).toMatch(/REVIEWER FEEDBACK[\s\S]*- Add pricing/);
  });
  it('Given no feedback, Then the message has no feedback block', () => {
    expect(TaskOrchestrator.prepareTaskMessage(task, null)).not.toContain('REVIEWER FEEDBACK');
  });
});
