import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../models/GoalModel.js', () => ({ default: { create: vi.fn(async () => 'goal-1'), findOne: vi.fn() } }));
vi.mock('../../models/TaskModel.js', () => ({ default: { create: vi.fn(async () => 'task-1'), findByGoalId: vi.fn(async () => []) } }));
vi.mock('../ai/ModelRouter.js', () => ({ complete: vi.fn() }));
vi.mock('../ai/CustomOpenAIProviderService.js', () => ({ default: { getProviderById: vi.fn(async (id) => (id === 'custom-uuid' ? { id, provider_name: 'Local vLLM' } : null)) } }));
import Processor from './GoalProcessor.js';
import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import { complete } from '../ai/ModelRouter.js';
import { NoAiConfiguredError } from '../ai/accountAi.js';

// Planning failures must be typed and actionable, and must never create a goal
// or a fabricated placeholder task. Planning goes through ModelRouter.complete,
// so these drive the router's real failure shapes.
const failure = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected a rejection'); };
const allTiersFailed = (attempts, cause) => Object.assign(new Error('No model produced a usable answer'), { code: 'ALL_TIERS_FAILED', attempts, cause });
const served = (text, provider = 'openai', model = 'gpt-fixture') => ({ text, provider, model, attempts: [] });
beforeEach(() => vi.clearAllMocks());

it('Given every model is unreachable Then planning fails as retryable PLANNER_UNAVAILABLE and creates no goal', async () => {
  complete.mockRejectedValue(allTiersFailed([{ provider: 'openai', model: 'gpt-fixture', failed: true, reason: 'connection' }], 'Connection error.'));
  const e = await failure(Processor.processGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e.name).toBe('GoalPlanningError');
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE', status: 502, retryable: true, provider: 'openai', model: 'gpt-fixture', reason: 'Connection error.' });
  expect(e.message).toMatch(/could not be reached/i);
  expect(GoalModel.create).not.toHaveBeenCalled();
  expect(TaskModel.create).not.toHaveBeenCalled();
});
it('Given several fallbacks failed Then the message says how many were tried and names the last', async () => {
  complete.mockRejectedValue(allTiersFailed([
    { provider: 'openai', model: 'gpt-fixture', failed: true, reason: 'overloaded' },
    { provider: 'anthropic', model: 'claude-fixture', failed: true, reason: 'connection' },
  ], 'fetch failed'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE', provider: 'anthropic', model: 'claude-fixture' });
  expect(e.message).toMatch(/tried 2 models/);
});
it('Given every model lacks credentials Then PLANNER_NOT_CONNECTED tells the user to connect it, not to retry', async () => {
  complete.mockRejectedValue(allTiersFailed([{ provider: 'anthropic', model: 'claude-fixture', failed: true, reason: 'auth' }], 'Missing access token for provider: anthropic'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'anthropic', 'claude-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_NOT_CONNECTED', status: 400, retryable: false });
  expect(e.message).toMatch(/not connected/i);
  expect(e.message).toMatch(/Settings/);
});
it('Given no model is configured anywhere Then PLANNER_NOT_CONFIGURED is a 400 and not retryable', async () => {
  complete.mockRejectedValue(new NoAiConfiguredError());
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', null, null));
  expect(e).toMatchObject({ code: 'PLANNER_NOT_CONFIGURED', status: 400, retryable: false });
  expect(e.message).toMatch(/Settings/);
});
it('Given the request is cancelled Then the cancellation propagates untouched', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  complete.mockRejectedValue(abort);
  expect(await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'))).toBe(abort);
});
it('Given a reply that is not JSON Then PLANNER_INVALID_RESPONSE, retryable', async () => {
  complete.mockResolvedValue(served('Sure! Here is a plan: first...'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_RESPONSE', status: 502, retryable: true });
});
it('Given a plan without a title Then PLANNER_INVALID_PLAN with the validation reason', async () => {
  complete.mockResolvedValue(served(JSON.stringify({ taskBreakdown: [{ title: 't', requiredTools: [] }] })));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_PLAN', status: 502, retryable: true });
  expect(e.reason).toMatch(/Invalid analysis structure/);
});
it('Given a plan with no tasks Then PLANNER_INVALID_PLAN and no goal record is written', async () => {
  complete.mockResolvedValue(served(JSON.stringify({ title: 'Empty', taskBreakdown: [] })));
  const e = await failure(Processor.processGoal('Do nothing', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_INVALID_PLAN' });
  expect(GoalModel.create).not.toHaveBeenCalled();
});
it('Given a custom provider Then messages name it instead of showing its id', async () => {
  complete.mockRejectedValue(allTiersFailed([{ provider: 'custom-uuid', model: 'fixture-model', failed: true, reason: 'connection' }], 'Connection error.'));
  const e = await failure(Processor._analyzeGoal('Summarize', 'user-a', 'custom-uuid', 'fixture-model'));
  expect(e.message).toContain('Local vLLM (fixture-model)');
  expect(e.message).not.toContain('custom-uuid');
});
it('Given an existing task-less goal and an unreachable planner Then no placeholder task is fabricated', async () => {
  GoalModel.findOne.mockResolvedValue({ id: 'goal-9', title: 'Proposal', description: 'Write the report' });
  complete.mockRejectedValue(allTiersFailed([{ provider: 'openai', model: 'gpt-fixture', failed: true, reason: 'connection' }], 'Connection error.'));
  const e = await failure(Processor.planTasksForExistingGoal('goal-9', 'user-a', 'openai', 'gpt-fixture'));
  expect(e).toMatchObject({ code: 'PLANNER_UNAVAILABLE' });
  expect(TaskModel.create).not.toHaveBeenCalled();
});
it('Given a valid plan naming an unknown tool Then the tool is still filtered out and the goal is created', async () => {
  complete.mockResolvedValue(served(JSON.stringify({ title: 'Mail', taskBreakdown: [{ title: 'Send', description: 'd', requiredTools: ['send_email', 'no-such-tool'] }] })));
  const plan = await Processor.processGoal('Send the mail', 'user-a', 'openai', 'gpt-fixture');
  expect(GoalModel.create).toHaveBeenCalledOnce();
  expect(plan.tasks[0].required_tools).toEqual(['send_email']);
});
