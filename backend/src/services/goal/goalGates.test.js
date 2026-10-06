// The goal gates: the checklist decides, reviewer feedback becomes part of it,
// and one shared bar grades a task whether alone or as part of the whole goal.
import { describe, it, expect } from 'vitest';
import { assessGoalCompletion, taskEvaluationRejection } from './taskOutcome.js';
import { checklistOf, withReviewerFeedback, MAX_REVIEWER_FEEDBACK } from './goalChecklist.js';

const tasks = [{ id: 't', status: 'completed', output: { content: 'Fixture result' } }];
const passingEvaluation = (checklist) => ({
  passed: true,
  scores: { overall: 95 },
  taskEvaluations: [{ taskId: 't', score: 95, criteriaMet: { ok: true } }],
  checklist,
});

describe('the acceptance checklist decides completion', () => {
  it('Given every item is met, Then the goal can pass', () => {
    expect(assessGoalCompletion(passingEvaluation([{ id: 'c1', met: true }]), tasks).code).toBe('ACCEPTED');
  });
  it('Given one unmet item behind a 95% score, Then the goal does not pass', () => {
    const decision = assessGoalCompletion(passingEvaluation([{ id: 'c1', met: true }, { id: 'c2', met: false }]), tasks);
    expect(decision).toMatchObject({ passed: false, code: 'CHECKLIST_UNMET' });
  });
  it('Given an item the grader never assessed, Then it fails closed', () => {
    expect(assessGoalCompletion(passingEvaluation([{ id: 'c1', met: null }]), tasks).code).toBe('CHECKLIST_UNMET');
  });
  it('Given no checklist at all, Then behaviour is unchanged', () => {
    expect(assessGoalCompletion(passingEvaluation([]), tasks).passed).toBe(true);
    expect(assessGoalCompletion(passingEvaluation(undefined), tasks).passed).toBe(true);
  });
});

describe('one bar for a single task', () => {
  it('accepts a fully met, well-scored task', () => {
    expect(taskEvaluationRejection({ score: 90, criteriaMet: { a: true } })).toBeNull();
  });
  it.each([
    [{ score: 60, criteriaMet: { a: true } }, 'TASK_SCORE_REJECTED'],
    [{ score: 90, criteriaMet: { a: true, b: false } }, 'CRITERIA_UNMET'],
    [{ score: 90, criteriaMet: { evaluated: false, error: true } }, 'EVALUATION_UNAVAILABLE'],
    [{ score: 90, criteriaMet: {} }, 'CRITERIA_INVALID'],
  ])('rejects %j as %s', (entry, code) => expect(taskEvaluationRejection(entry)).toBe(code));
});

describe('reviewer feedback joins the checklist', () => {
  it('appends each request as its own item after the planned ones', () => {
    const items = checklistOf({ checklist: ['A PDF is saved'] }, [{ text: 'Add pricing' }, { text: '  ' }]);
    expect(items).toEqual([
      { id: 'c1', text: 'A PDF is saved' },
      { id: 'c2', text: 'Reviewer feedback addressed: Add pricing' },
    ]);
  });
  it('still applies to goals planned before checklists existed', () => {
    expect(checklistOf({ deliverables: ['Report'] }, [{ text: 'Shorter' }]).map((i) => i.text))
      .toEqual(['Report', 'Reviewer feedback addressed: Shorter']);
  });
  it('keeps only the most recent requests and ignores blank ones', () => {
    let state = {};
    for (let i = 1; i <= MAX_REVIEWER_FEEDBACK + 2; i++) state = { reviewerFeedback: withReviewerFeedback(state, `note ${i}`, 't') };
    expect(withReviewerFeedback(state, '   ')).toBe(state.reviewerFeedback);
    expect(state.reviewerFeedback.map((f) => f.text)).toEqual(['note 3', 'note 4', 'note 5', 'note 6', 'note 7']);
  });
});
