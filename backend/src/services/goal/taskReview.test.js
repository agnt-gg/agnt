import { describe, it, expect } from 'vitest';
import { taskReviewPrompt } from './taskReview.js';
import { acceptanceChecklistOf } from './goalChecklist.js';

const section = (prompt, start, end) => prompt.slice(prompt.indexOf(start), prompt.indexOf(end));

describe('taskReviewPrompt', () => {
  const criteria = { deliverables: ['Weekly report'], qualityChecks: ['Every claim cites a source'] };
  const prompt = taskReviewPrompt({ title: 'Research', description: 'Done when: notes are saved.' }, { content: 'ok' }, criteria);

  it('states the task description as the requirements', () => {
    expect(section(prompt, 'THE TASK', 'TASK OUTPUT:')).toContain('Done when: notes are saved.');
  });
  it('shows goal deliverables only as background, never as this task\'s requirements', () => {
    expect(section(prompt, 'THE TASK', 'TASK OUTPUT:')).not.toContain('Weekly report');
    expect(section(prompt, 'GOAL CONTEXT (background only', 'EVALUATION INSTRUCTIONS:')).toContain('- Weekly report');
    expect(prompt).toMatch(/Never fail this task for a goal deliverable its description does not assign to it/);
    expect(prompt).not.toMatch(/SUCCESS CRITERIA/);
  });
  it('falls back to the title when a task has no description, and tolerates missing criteria', () => {
    const bare = taskReviewPrompt({ title: 'Only a title' }, null, null);
    expect(section(bare, 'THE TASK', 'TASK OUTPUT:')).toContain('Description: Only a title');
    expect(bare).toContain('- (none listed)');
  });
});

describe('acceptanceChecklistOf', () => {
  it('adds every deliverable the planner checklist does not already name, before reviewer feedback', () => {
    const items = acceptanceChecklistOf({ checklist: ['A PDF is saved', 'Report'], deliverables: ['report', 'Schedule', ' '] }, [{ text: 'Shorter' }]);
    expect(items).toEqual([
      { id: 'c1', text: 'A PDF is saved' },
      { id: 'c2', text: 'Report' },
      { id: 'c3', text: 'Deliverable produced: Schedule' },
      { id: 'c4', text: 'Reviewer feedback addressed: Shorter' },
    ]);
  });
  it('matches checklistOf for goals with no explicit checklist (deliverables are already in it)', () => {
    expect(acceptanceChecklistOf({ deliverables: ['Report'], qualityChecks: ['Sourced'] }).map((i) => i.text)).toEqual(['Report', 'Sourced']);
    expect(acceptanceChecklistOf(null)).toEqual([]);
  });
  it('never drops a deliverable because the planner checklist is full', () => {
    const items = acceptanceChecklistOf({ checklist: Array.from({ length: 10 }, (_, i) => `item ${i}`), deliverables: ['Protocol', 'Scorecard'] });
    expect(items.map((i) => i.text).slice(-2)).toEqual(['Deliverable produced: Protocol', 'Deliverable produced: Scorecard']);
  });
});
