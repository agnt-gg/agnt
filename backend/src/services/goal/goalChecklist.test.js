import { describe, it, expect, vi } from 'vitest';
import { checklistOf, checklistPrompt, parseChecklistVerdict } from './goalChecklist.js';

describe('checklistOf', () => {
  it('uses the explicit checklist, trimmed, deduped and numbered', () => {
    expect(checklistOf({ checklist: ['  A PDF is saved ', 'a pdf is saved', '', { text: 'Every claim cites a URL' }] })).toEqual([
      { id: 'c1', text: 'A PDF is saved' },
      { id: 'c2', text: 'Every claim cites a URL' },
    ]);
  });

  it('derives one for goals planned before checklists existed', () => {
    expect(checklistOf({ deliverables: ['Report'], qualityChecks: ['Sourced'] }).map((i) => i.text)).toEqual(['Report', 'Sourced']);
    expect(checklistOf(null)).toEqual([]);
  });

  it('caps the list so a runaway plan cannot flood review', () => {
    expect(checklistOf({ checklist: Array.from({ length: 30 }, (_, i) => `item ${i}`) })).toHaveLength(10);
  });
});

describe('parseChecklistVerdict', () => {
  const checklist = checklistOf({ checklist: ['Saved', 'Cited', 'Short'] });

  it('maps verdicts by id and reports skipped items as unassessed, never as passed', () => {
    const raw = '```json\n{"items":[{"id":"c1","met":true,"evidence":"report.pdf written"},{"id":"c9","met":true},{"id":"c2","met":"yes"}]}\n```';
    expect(parseChecklistVerdict(raw, checklist)).toEqual([
      { id: 'c1', text: 'Saved', met: true, evidence: 'report.pdf written' },
      { id: 'c2', text: 'Cited', met: null, evidence: 'Not assessed' },
      { id: 'c3', text: 'Short', met: null, evidence: 'Not assessed' },
    ]);
  });

  it('survives garbage and thinking tags', () => {
    expect(parseChecklistVerdict('<think>{"items":[{"id":"c1","met":true}]}</think> nope', checklist).every((i) => i.met === null)).toBe(true);
    expect(parseChecklistVerdict(undefined, checklist)).toHaveLength(3);
  });

  it('prompts with every item and bounded task output', () => {
    const prompt = checklistPrompt({ title: 'G' }, checklist, [{ title: 'T', status: 'completed', output: 'x'.repeat(10000) }]);
    for (const item of checklist) expect(prompt).toContain(`${item.id}. ${item.text}`);
    expect(prompt.length).toBeLessThan(4000);
  });
});

describe('GoalEvaluator.evaluateChecklist', () => {
  it('degrades to unassessed items when the model call fails', async () => {
    const { default: GoalEvaluator } = await import('./GoalEvaluator.js');
    const spy = vi.spyOn(GoalEvaluator, '_complete').mockRejectedValue(new Error('provider down'));
    const items = await GoalEvaluator.evaluateChecklist({ title: 'G', success_criteria: { checklist: ['A', 'B'] } }, [], 'u1');
    expect(items.map((i) => i.met)).toEqual([null, null]);
    spy.mockRestore();
  });

  it('can read an evaluation report (the models it needs are imported)', async () => {
    const { default: GoalEvaluator } = await import('./GoalEvaluator.js');
    const { default: GoalEvaluationModel } = await import('../../models/GoalEvaluationModel.js');
    const { default: TaskEvaluationModel } = await import('../../models/TaskEvaluationModel.js');
    const a = vi.spyOn(GoalEvaluationModel, 'findLatestByGoalId').mockResolvedValue({ id: 'e1', evaluation_data: { checklist: [] } });
    const b = vi.spyOn(TaskEvaluationModel, 'findByGoalEvaluationId').mockResolvedValue([]);
    await expect(GoalEvaluator.getEvaluationReport('g1')).resolves.toMatchObject({ id: 'e1', taskEvaluations: [] });
    a.mockRestore();
    b.mockRestore();
  });
});
