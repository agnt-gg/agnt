// "Request changes" must cause rework: feedback is kept for the next run and
// every task goes back to pending, so the completed work is not just re-graded.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/GoalModel.js', () => ({
  default: { findOne: vi.fn(), updateStatus: vi.fn(async () => 1), getWorldState: vi.fn(), updateWorldState: vi.fn(async () => 1) },
}));
vi.mock('../models/TaskModel.js', () => ({ default: { findByGoalId: vi.fn(), updateStatus: vi.fn(async () => 1) } }));
vi.mock('../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('../models/GoldenStandardModel.js', () => ({ default: {} }));
vi.mock('../models/LlmCallModel.js', () => ({ default: {} }));
vi.mock('./goal/GoalProcessor.js', () => ({ default: {} }));
vi.mock('./goal/TaskOrchestrator.js', () => ({ default: {} }));
vi.mock('./goal/GoalEvaluator.js', () => ({ default: {} }));

const { default: GoalService } = await import('./GoalService.js');
const { default: GoalModel } = await import('../models/GoalModel.js');
const { default: TaskModel } = await import('../models/TaskModel.js');

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  GoalModel.findOne.mockResolvedValue({ id: 'g1', user_id: 'u' });
  GoalModel.getWorldState.mockResolvedValue({ reviewerFeedback: [{ text: 'Shorter', at: 'earlier' }], lastScore: 88 });
  TaskModel.findByGoalId.mockResolvedValue([{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'pending' }]);
});

describe('request changes', () => {
  it('Given feedback, Then it is kept with earlier feedback and every finished task is redone', async () => {
    await GoalService.reviewGoal({ params: { id: 'g1' }, body: { action: 'reject', feedback: 'Add pricing' } }, makeRes());
    const saved = GoalModel.updateWorldState.mock.calls[0][1];
    expect(saved.reviewerFeedback.map((f) => f.text)).toEqual(['Shorter', 'Add pricing']);
    expect(saved.lastScore).toBe(88);
    expect(TaskModel.updateStatus.mock.calls.map((c) => [c[0], c[1]])).toEqual([['a', 'pending'], ['b', 'pending']]);
  });
  it('Given no feedback text, Then nothing is reset', async () => {
    await GoalService.reviewGoal({ params: { id: 'g1' }, body: { action: 'reject' } }, makeRes());
    expect(GoalModel.updateWorldState).not.toHaveBeenCalled();
    expect(TaskModel.updateStatus).not.toHaveBeenCalled();
  });
});
