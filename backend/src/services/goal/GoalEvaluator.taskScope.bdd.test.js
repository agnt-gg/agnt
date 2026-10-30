// A goal is split into tasks that each own one share of the work. Each task is
// graded on its own description; the goal's deliverables are enforced once, on
// the work of every task together. Regression: tasks were graded against the
// whole goal's deliverables, so every task but the last was rejected and a
// multi-task goal could never pass.
vi.mock('../../models/GoalEvaluationCommit.js', () => ({
  staleEvaluation: () => new Error('stale'),
  commitGoalEvaluation: vi.fn(async (input) => ({ evaluationId: 'ev', status: input.passed ? 'validated' : 'needs_review' })),
}));
vi.mock('../../models/GoalModel.js', () => ({ default: { findOne: vi.fn(), updateStatus: vi.fn() } }));
vi.mock('../../models/TaskModel.js', () => ({ default: { findByGoalId: vi.fn() } }));
vi.mock('../../models/GoalEvaluationModel.js', () => ({ default: { create: vi.fn(async () => 'ev') } }));
vi.mock('../../models/TaskEvaluationModel.js', () => ({ default: { create: vi.fn() } }));
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Evaluator from './GoalEvaluator.js';
import Goal from '../../models/GoalModel.js';
import Task from '../../models/TaskModel.js';

const markers = (text) => [...new Set(String(text).match(/\[[a-z-]+\]/g) || [])];
const between = (text, start, end) => {
  const from = text.indexOf(start);
  if (from < 0) return text;
  const to = text.indexOf(end, from + start.length);
  return text.slice(0, from) + (to < 0 ? '' : text.slice(to));
};

/**
 * A grader that follows its prompt. Every [marker] the prompt states as a
 * requirement must appear in the work; markers in a section the prompt marks
 * as background are not requirements. The old prompt listed goal deliverables
 * as SUCCESS CRITERIA, so this grader fails a first task on it exactly as the
 * real one did.
 */
function instructionFollowingGrader(prompt) {
  if (prompt.includes('acceptance checklist')) {
    const work = prompt.slice(prompt.indexOf('WORK PRODUCED:'));
    const items = [...prompt.matchAll(/^(c\d+)\. (.*)$/gm)].map(([, id, text]) => ({
      id,
      met: markers(text).every((marker) => work.includes(marker)),
      evidence: 'fixture',
    }));
    return JSON.stringify({ items });
  }
  const outputStart = prompt.indexOf('TASK OUTPUT:');
  const outputEnd = prompt.search(/\n\n(GOAL CONTEXT|SUCCESS CRITERIA)/);
  const output = prompt.slice(outputStart, outputEnd);
  const stated = between(prompt.slice(0, outputStart) + prompt.slice(outputEnd), 'GOAL CONTEXT (background only', 'EVALUATION INSTRUCTIONS:');
  const required = markers(stated);
  const criteriaMet = Object.fromEntries(required.map((marker) => [marker, output.includes(marker)]));
  const met = Object.values(criteriaMet).every(Boolean);
  return JSON.stringify({ score: met ? 92 : 40, criteriaMet: required.length ? criteriaMet : { output: true }, feedback: met ? 'Meets its requirements.' : `Missing ${required.filter((m) => !output.includes(m)).join(', ')}` });
}

const goal = (criteria) => ({ id: 'g', user_id: 'u', status: 'active', lifecycle_revision: 1, title: 'Weekly SEO scoring', description: 'Score the site weekly', success_criteria: criteria });
const task = (id, done, output) => ({ id, goal_id: 'g', title: `Task ${id}`, status: 'completed', description: `Do step ${id}. Done when: ${done} is saved.`, output: JSON.stringify({ content: output, toolExecutions: [] }) });
const plannedCriteria = {
  deliverables: ['Research notes [research]', 'Site inventory [inventory]', 'Weekly report [report]'],
  qualityChecks: ['Every claim cites a source'],
  checklist: ['Research notes [research] cite sources', 'A weekly report [report] is saved'],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(Evaluator, '_complete').mockImplementation(async (prompt) => instructionFollowingGrader(prompt));
  vi.spyOn(Evaluator, 'generateEvaluationFeedback').mockResolvedValue('Review');
});

describe('each task is graded on its own job', () => {
  it('Given the first task of a multi-task goal did only its own share, Then it passes review', async () => {
    const graded = await Evaluator.evaluateTask(task('t1', '[research]', 'Saved notes [research] with 21 sources.'), plannedCriteria, 'u');
    expect(graded.score).toBeGreaterThanOrEqual(70);
    expect(graded.criteriaMet).toEqual({ '[research]': true });
  });

  it('Given every task did its own share and together they cover the goal, Then the goal passes', async () => {
    Goal.findOne.mockResolvedValue(goal(plannedCriteria));
    Task.findByGoalId.mockResolvedValue([
      task('t1', '[research]', 'Saved notes [research].'),
      task('t2', '[inventory]', 'Saved inventory [inventory].'),
      task('t3', '[report]', 'Saved report [report].'),
    ]);
    const result = await Evaluator.evaluateGoal('g', 'u');
    expect(result.completionDecision).toEqual({ passed: true, code: 'ACCEPTED', taskId: null });
    expect(result.taskEvaluations.map((t) => t.score)).toEqual([92, 92, 92]);
  });

  it('Given a task that misses its own "Done when", Then that task is still rejected', async () => {
    Goal.findOne.mockResolvedValue(goal(plannedCriteria));
    Task.findByGoalId.mockResolvedValue([
      task('t1', '[research]', 'Saved notes [research].'),
      task('t2', '[inventory]', 'Looked at the sitemap but saved nothing.'),
      task('t3', '[report]', 'Saved report [report].'),
    ]);
    const result = await Evaluator.evaluateGoal('g', 'u');
    expect(result.passed).toBe(false);
    expect(result.completionDecision).toMatchObject({ code: 'TASK_SCORE_REJECTED', taskId: 't2' });
  });
});

describe("the goal's deliverables are enforced once, on all the work", () => {
  it('Given a deliverable the planner checklist never names and no task produced, Then the goal fails on the checklist', async () => {
    const criteria = { ...plannedCriteria, deliverables: [...plannedCriteria.deliverables, 'Weekly schedule [schedule]'] };
    Goal.findOne.mockResolvedValue(goal(criteria));
    Task.findByGoalId.mockResolvedValue([
      task('t1', '[research]', 'Saved notes [research].'),
      task('t2', '[inventory]', 'Saved inventory [inventory].'),
      task('t3', '[report]', 'Saved report [report].'),
    ]);
    const result = await Evaluator.evaluateGoal('g', 'u');
    expect(result.completionDecision).toMatchObject({ passed: false, code: 'CHECKLIST_UNMET' });
    expect(result.checklist.find((item) => item.text === 'Deliverable produced: Weekly schedule [schedule]')).toMatchObject({ met: false });
  });
});
