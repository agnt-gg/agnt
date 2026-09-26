import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../models/GoalModel.js', () => ({ default: {} }));
vi.mock('../models/TaskModel.js', () => ({ default: {} }));
vi.mock('../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('../models/GoldenStandardModel.js', () => ({ default: {} }));
vi.mock('../models/LlmCallModel.js', () => ({ default: {} }));
vi.mock('./goal/TaskOrchestrator.js', () => ({ default: {} }));
vi.mock('./goal/GoalEvaluator.js', () => ({ default: {} }));
vi.mock('./goal/GoalProcessor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { processGoal: vi.fn() } };
});
const { default: GoalService } = await import('./GoalService.js');
const { default: GoalProcessor, GoalPlanningError } = await import('./goal/GoalProcessor.js');

const res = () => { const r = {}; r.status = vi.fn(() => r); r.json = vi.fn(() => r); return r; };
const req = { body: { text: 'Summarize the notes', provider: 'openai', model: 'gpt-fixture' }, user: { userId: 'u' } };
beforeEach(() => vi.clearAllMocks());

it('Given a planning failure Then respond with its status and an actionable JSON body', async () => {
  GoalProcessor.processGoal.mockRejectedValue(new GoalPlanningError('PLANNER_UNAVAILABLE', 'OpenAI (gpt-fixture) could not be reached: Connection error.', { provider: 'openai', model: 'gpt-fixture', reason: 'Connection error.', retryable: true }));
  const r = res();
  await GoalService.createGoal(req, r);
  expect(r.status).toHaveBeenCalledWith(502);
  expect(r.json).toHaveBeenCalledWith({ error: 'OpenAI (gpt-fixture) could not be reached: Connection error.', code: 'PLANNER_UNAVAILABLE', provider: 'openai', model: 'gpt-fixture', reason: 'Connection error.', retryable: true });
});
it('Given an unexpected error Then keep the generic 500', async () => {
  GoalProcessor.processGoal.mockRejectedValue(new Error('disk full'));
  const r = res();
  await GoalService.createGoal(req, r);
  expect(r.status).toHaveBeenCalledWith(500);
  expect(r.json).toHaveBeenCalledWith({ error: 'Failed to create goal', details: 'disk full' });
});
