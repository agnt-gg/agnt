// #94: saving a passed goal as a golden standard 500'd because the handler
// read `evaluation.scores.overall`, but the report is a goal_evaluations row
// (overall_score column + evaluation_data JSON) with no top-level `scores`.
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/GoalModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../models/TaskModel.js', () => ({ default: { findByGoalId: vi.fn(async () => [{ title: 'Draft', description: 'd', required_tools: ['web_search'], order_index: 0 }]) } }));
vi.mock('../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('../models/GoldenStandardModel.js', () => ({ default: { create: vi.fn(async () => 'gs-1') } }));
vi.mock('../models/LlmCallModel.js', () => ({ default: {} }));
vi.mock('./goal/GoalProcessor.js', () => ({ default: {} }));
vi.mock('./goal/TaskOrchestrator.js', () => ({ default: {} }));
vi.mock('./goal/GoalEvaluator.js', () => ({ default: { getEvaluationReport: vi.fn() } }));

const { default: GoalService } = await import('./GoalService.js');
const { default: GoalModel } = await import('../models/GoalModel.js');
const { default: GoldenStandardModel } = await import('../models/GoldenStandardModel.js');
const { default: GoalEvaluator } = await import('./goal/GoalEvaluator.js');

const res = () => { const r = {}; r.status = vi.fn(() => r); r.json = vi.fn(() => r); return r; };
const req = (userId = 'owner') => ({ params: { id: 'goal-1' }, body: { category: 'research' }, user: { userId } });
// Exactly what GoalEvaluationModel.findLatestByGoalId returns, plus taskEvaluations.
const reportRow = (over = {}) => ({
  id: 'eval-1', goal_id: 'goal-1', evaluation_type: 'automatic', overall_score: 92.5, passed: true,
  evaluation_data: { scores: { overall: 92.5, completeness: 95, quality: 90 }, taskEvaluations: [] },
  feedback: 'Solid.', taskEvaluations: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  GoalModel.findOne.mockResolvedValue({ id: 'goal-1', user_id: 'owner', title: 'Report', description: 'Write it', success_criteria: {} });
});

it('Given a passed evaluation row Then it saves with overall_score and the stored per-dimension scores', async () => {
  GoalEvaluator.getEvaluationReport.mockResolvedValue(reportRow());
  const r = res();
  await GoalService.saveAsGoldenStandard(req(), r);
  expect(r.status).toHaveBeenCalledWith(201);
  const [goalId, category, , , successScore, templateData, createdBy] = GoldenStandardModel.create.mock.calls[0];
  expect({ goalId, category, successScore, createdBy }).toEqual({ goalId: 'goal-1', category: 'research', successScore: 92.5, createdBy: 'owner' });
  expect(templateData.evaluation).toEqual({ scores: { overall: 92.5, completeness: 95, quality: 90 }, feedback: 'Solid.' });
});
it('Given an older row without evaluation_data scores Then it still saves from overall_score', async () => {
  GoalEvaluator.getEvaluationReport.mockResolvedValue(reportRow({ evaluation_data: {} }));
  const r = res();
  await GoalService.saveAsGoldenStandard(req(), r);
  expect(r.status).toHaveBeenCalledWith(201);
  expect(GoldenStandardModel.create.mock.calls[0][4]).toBe(92.5);
  expect(GoldenStandardModel.create.mock.calls[0][5].evaluation.scores).toEqual({ overall: 92.5 });
});
it('Given a failed evaluation Then 400 and nothing is saved', async () => {
  GoalEvaluator.getEvaluationReport.mockResolvedValue(reportRow({ passed: false }));
  const r = res();
  await GoalService.saveAsGoldenStandard(req(), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(GoldenStandardModel.create).not.toHaveBeenCalled();
});
