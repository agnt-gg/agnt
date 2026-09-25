import { describe, it, expect } from 'vitest';
import { reviewChecklist } from './goalChecklist.js';

describe('reviewChecklist', () => {
  it('shows the evaluator verdicts once the goal is evaluated', () => {
    const goal = {
      success_criteria: { checklist: ['ignored once evaluated'] },
      evaluation: { evaluation_data: { checklist: [{ id: 'c1', text: 'Saved', met: true, evidence: 'a.pdf' }, { id: 'c2', text: 'Cited', met: false }] } },
    };
    expect(reviewChecklist(goal)).toEqual({
      evaluated: true,
      met: 1,
      items: [
        { id: 'c1', text: 'Saved', met: true, evidence: 'a.pdf' },
        { id: 'c2', text: 'Cited', met: false, evidence: '' },
      ],
    });
  });

  it('shows the planned items unchecked before evaluation, deriving them for older goals', () => {
    expect(reviewChecklist({ success_criteria: { checklist: ['A', 'a', ' B '] } }).items.map((i) => [i.text, i.met])).toEqual([
      ['A', null],
      ['B', null],
    ]);
    expect(reviewChecklist({ success_criteria: { deliverables: ['Report'], qualityChecks: ['Sourced'] } }).items.map((i) => i.text)).toEqual(['Report', 'Sourced']);
    expect(reviewChecklist(null)).toEqual({ evaluated: false, met: 0, items: [] });
  });
});
