// The goal checklist grader must see the END of each task's work, where the
// deliverable is written. Regression: the raw output JSON was cut to its first
// 2500 characters, so a finished goal scored 100% per task and still failed
// CHECKLIST_UNMET ("the visible tool results show neither ... answer.md").
import { describe, it, expect } from 'vitest';
import { taskEvidence } from './goalChecklist.js';

const bigRead = (n) => ({ name: 'file_operations', arguments: JSON.stringify({ operation: 'read', path: `/hunt/clue-${n}.txt` }), response: `Next clue: clue-${n + 1}.txt ${'x'.repeat(900)}` });
const task = (extra = {}) => ({
  title: 'Follow the clue chain',
  status: 'completed',
  output: JSON.stringify({
    content: [{ type: 'text', text: 'Found the secret and saved answer.md.' }],
    toolExecutions: [
      ...Array.from({ length: 30 }, (_, n) => bigRead(n)),
      { name: 'file_operations', arguments: { operation: 'write', path: '/out/answer.md', content: 'SECRET-ABC123' }, response: { success: true, bytes: 13 } },
      { name: 'file_operations', arguments: { operation: 'read', path: '/out/answer.md' }, response: 'SECRET-ABC123' },
    ],
    ...extra,
  }),
});

describe('taskEvidence', () => {
  it('keeps the final calls (the deliverable write and readback) however long the work was', () => {
    const evidence = taskEvidence([task()]);
    expect(evidence).toContain('path=/out/answer.md');
    expect(evidence).toContain('SECRET-ABC123');
    expect(evidence).toMatch(/Tool calls \(32\)/);
    expect(evidence).toMatch(/earlier call\(s\) omitted/);
  });

  it('shows the summary as text, never "[object Object]"', () => {
    const evidence = taskEvidence([task()]);
    expect(evidence).toContain('Summary: Found the secret and saved answer.md.');
    expect(evidence).not.toContain('[object Object]');
  });

  it('stays within its budget per task, so one task cannot crowd out the rest', () => {
    const evidence = taskEvidence([task(), { title: 'Second', status: 'completed', output: JSON.stringify({ content: 'Report saved.', toolExecutions: [] }) }]);
    const [first] = evidence.split('### Task 2');
    expect(first.length).toBeLessThanOrEqual(6100);
    expect(evidence).toContain('### Task 2: Second [completed]\nSummary: Report saved.');
  });

  it('tolerates plain-text and empty outputs', () => {
    expect(taskEvidence([{ title: 'T', status: 'failed', output: 'plain words' }])).toContain('plain words');
    expect(taskEvidence([{ title: 'T', status: 'pending', output: null }])).toContain('### Task 1: T [pending]');
  });
});
