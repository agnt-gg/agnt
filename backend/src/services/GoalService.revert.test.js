// Revert-to-iteration restores BOTH world state and tasks from the DB record.
// The old implementation restored world state only, then ran `git checkout`
// against a goal/<id> branch in process.cwd() — the product repo on a source
// install. The git path is gone; everything comes from goal_iterations.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/GoalModel.js', () => ({
  default: {
    findOne: vi.fn(),
    updateWorldState: vi.fn(async () => 1),
    updateIteration: vi.fn(async () => 1),
    updateLoopStatus: vi.fn(async () => 1),
    updateStatus: vi.fn(async () => 1),
    getWorldState: vi.fn(async () => ({})),
  },
}));
vi.mock('../models/TaskModel.js', () => ({ default: { restoreSnapshot: vi.fn(async () => 2), findByGoalId: vi.fn(async () => []) } }));
vi.mock('../models/GoalIterationModel.js', () => ({ default: { findOne: vi.fn(), findByGoalId: vi.fn(async () => []) } }));
vi.mock('../models/GoldenStandardModel.js', () => ({ default: {} }));
vi.mock('../models/LlmCallModel.js', () => ({ default: {} }));
vi.mock('./goal/GoalProcessor.js', () => ({ default: {} }));
vi.mock('./goal/TaskOrchestrator.js', () => ({ default: {} }));
vi.mock('./goal/GoalEvaluator.js', () => ({ default: {} }));

const { default: GoalService } = await import('./GoalService.js');
const { default: GoalModel } = await import('../models/GoalModel.js');
const { default: TaskModel } = await import('../models/TaskModel.js');
const { default: GoalIterationModel } = await import('../models/GoalIterationModel.js');

const makeRes = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('revertToIteration', () => {
  it('404s when the iteration record does not exist', async () => {
    GoalIterationModel.findOne.mockResolvedValue(null);
    const res = makeRes();

    await GoalService.revertToIteration({ params: { goalId: 'g1', iteration: '9' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(GoalModel.updateWorldState).not.toHaveBeenCalled();
  });

  it('restores world state AND tasks from the DB snapshot', async () => {
    GoalIterationModel.findOne.mockResolvedValue({
      iteration_number: 5,
      world_state_snapshot: { lastIteration: 5 },
      task_snapshot: [{ id: 't1' }, { id: 't2' }],
    });
    TaskModel.restoreSnapshot.mockResolvedValue(2);
    const res = makeRes();

    await GoalService.revertToIteration({ params: { goalId: 'g1', iteration: '5' } }, res);

    expect(GoalIterationModel.findOne).toHaveBeenCalledWith('g1', 5);
    expect(GoalModel.updateWorldState).toHaveBeenCalledWith('g1', { lastIteration: 5 });
    expect(GoalModel.updateIteration).toHaveBeenCalledWith('g1', 5);
    expect(TaskModel.restoreSnapshot).toHaveBeenCalledWith('g1', [{ id: 't1' }, { id: 't2' }]);
    expect(GoalModel.updateLoopStatus).toHaveBeenCalledWith('g1', 'reverted');
    expect(GoalModel.updateStatus).toHaveBeenCalledWith('g1', 'paused');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ iteration: 5, restoredTasks: 2 }));
  });

  it('reverts world state only for legacy records without a task snapshot', async () => {
    GoalIterationModel.findOne.mockResolvedValue({
      iteration_number: 2,
      world_state_snapshot: { lastIteration: 2 },
      task_snapshot: null,
    });
    const res = makeRes();

    await GoalService.revertToIteration({ params: { goalId: 'g1', iteration: '2' } }, res);

    expect(TaskModel.restoreSnapshot).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ restoredTasks: 0 }));
  });
});
