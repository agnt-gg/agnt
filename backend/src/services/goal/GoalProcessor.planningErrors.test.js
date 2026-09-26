import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../models/GoalModel.js', () => ({ default: { create: vi.fn(async () => 'goal-1'), findOne: vi.fn() } }));
vi.mock('../../models/TaskModel.js', () => ({ default: { create: vi.fn(async () => 'task-1'), findByGoalId: vi.fn(async () => []) } }));
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn(async () => ({})) }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../ai/CustomOpenAIProviderService.js', () => ({ default: { getProviderById: vi.fn(async (id) => (id === 'custom-uuid' ? { id, provider_name: 'Local vLLM' } : null)) } }));
import Processor from './GoalProcessor.js';
import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { createLlmClient } from '../ai/LlmService.js';

// Planning failures must be typed and actionable, and must never create a goal
// or a fabricated placeholder task.
const notice = '⚠️ **API Error:** Connection error.\n\nPlease check your API configuration or try a different provider.';
const unreachable = { responseMessage: { role: 'assistant', content: notice }, toolCalls: [], recoveredFromError: true, recoveredError: 'Connection error.' };
let call;
beforeEach(() => { vi.clearAllMocks(); call = vi.fn(); createLlmAdapter.mockResolvedValue({ call }); });
const failure = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };

it('Given the model provider is unreachable Then planning fails as retryable PLANNER_UNAVAILABLE and creates no goal', async () => {
  call.mockResolvedValue(unreachable);
  const e = await failure(Processor.processGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e.name).toBe('GoalPlanningError');
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE', status: 502, retryable: true, provider: 'openai', model: 'gpt-fixture', reason: 'Connection error.' });
  expect(e.message).toMatch(/could not be reached/i);
  expect(GoalModel.create).not.toHaveBeenCalled();
  expect(TaskModel.create).not.toHaveBeenCalled();
});
it('Given the client cannot be created Then it is PLANNER_UNAVAILABLE with the client reason', async () => {
  createLlmClient.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE', retryable: true, reason: 'connect ECONNREFUSED 127.0.0.1:11434' });
});
it('Given the provider has no credentials Then PLANNER_NOT_CONNECTED tells the user to connect it, not to retry', async () => {
  createLlmClient.mockRejectedValueOnce(new Error('Missing access token for provider: anthropic'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'anthropic', 'claude-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_NOT_CONNECTED', status: 400, retryable: false });
  expect(e.message).toMatch(/not connected/i);
  expect(e.message).toMatch(/Settings/);
});
it('Given a reply that is not JSON Then PLANNER_INVALID_RESPONSE, retryable', async () => {
  call.mockResolvedValue({ responseMessage: { content: 'Sure! Here is a plan: first...' } });
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_RESPONSE', status: 502, retryable: true });
});
it('Given a plan without a title Then PLANNER_INVALID_PLAN with the validation reason', async () => {
  call.mockResolvedValue({ responseMessage: { content: JSON.stringify({ taskBreakdown: [{ title: 't', requiredTools: [] }] }) } });
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_PLAN', status: 502, retryable: true });
  expect(e.reason).toMatch(/Invalid analysis structure/);
});
it('Given a plan with no tasks Then PLANNER_INVALID_PLAN and no goal record is written', async () => {
  call.mockResolvedValue({ responseMessage: { content: JSON.stringify({ title: 'Empty', taskBreakdown: [] }) } });
  const e = await failure(Processor.processGoal('Do nothing', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_PLAN' });
  expect(GoalModel.create).not.toHaveBeenCalled();
});
it('Given no provider or model anywhere Then PLANNER_NOT_CONFIGURED is a 400 and not retryable', async () => {
  vi.doMock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({})) } }));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', null, null));
  expect(e).toMatchObject({ code: 'PLANNER_NOT_CONFIGURED', status: 400, retryable: false });
  expect(call).not.toHaveBeenCalled();
  vi.doUnmock('../../models/UserModel.js');
});
it('Given a custom provider Then messages name it instead of showing its id', async () => {
  call.mockResolvedValue(unreachable);
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'custom-uuid', 'fixture-model'));
  expect(e.message).toContain('Local vLLM (fixture-model)');
  expect(e.message).not.toContain('custom-uuid');
});
it('Given an existing task-less goal and an unreachable planner Then no placeholder task is fabricated', async () => {
  GoalModel.findOne.mockResolvedValue({ id: 'goal-9', title: 'Proposal', description: 'Write the report' });
  call.mockResolvedValue(unreachable);
  const e = await failure(Processor.planTasksForExistingGoal('goal-9', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE' });
  expect(TaskModel.create).not.toHaveBeenCalled();
});
it('Given a valid plan naming an unknown tool Then the tool is still filtered out and the goal is created', async () => {
  call.mockResolvedValue({ responseMessage: { content: JSON.stringify({ title: 'Mail', taskBreakdown: [{ title: 'Send', description: 'd', requiredTools: ['send_email', 'no-such-tool'] }] }) } });
  const plan = await Processor.processGoal('Send the mail', 'user-a', 'openai', 'gpt-fixture');
  expect(GoalModel.create).toHaveBeenCalledOnce();
  expect(plan.tasks[0].required_tools).toEqual(['send_email']);
});
