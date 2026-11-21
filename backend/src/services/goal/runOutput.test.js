import { describe, it, expect } from 'vitest';
import { summarizeRunOutput, RUN_OUTPUT_CONTENT_LIMIT } from './runOutput.js';

describe('summarizeRunOutput', () => {
  it('keeps each top-level task’s title, status, result and file names, in plan order', () => {
    const record = summarizeRunOutput([
      { title: 'Send', status: 'completed', order_index: 2, output: JSON.stringify({ content: 'Sent.', files: [{ name: 'digest.html' }, 'notes.md'], toolExecutions: [{ big: 'x'.repeat(5000) }] }) },
      { title: 'Search', status: 'completed', order_index: 1, output: { content: 'Found 12 stories.' } },
      { title: 'Sub-step', status: 'completed', order_index: 0, parent_task_id: 't1', output: { content: 'hidden' } },
    ]);
    expect(record).toEqual({
      tasks: [
        { title: 'Search', status: 'completed', error: null, content: 'Found 12 stories.', truncated: false, files: [] },
        { title: 'Send', status: 'completed', error: null, content: 'Sent.', truncated: false, files: ['digest.html', 'notes.md'] },
      ],
    });
    expect(JSON.stringify(record)).not.toContain('toolExecutions');
  });

  it('caps a long result and says so', () => {
    const [task] = summarizeRunOutput([{ title: 'Write', status: 'completed', output: { content: 'a'.repeat(RUN_OUTPUT_CONTENT_LIMIT + 50) } }]).tasks;
    expect(task.content).toHaveLength(RUN_OUTPUT_CONTENT_LIMIT);
    expect(task.truncated).toBe(true);
  });

  it('keeps the error of a task that did not finish, and plain-text outputs', () => {
    expect(summarizeRunOutput([
      { title: 'Pull analytics', status: 'failed', error: 'Needs from you: an API key', output: null },
      { title: 'Note', status: 'completed', output: 'plain words' },
    ]).tasks.map((t) => [t.status, t.error, t.content])).toEqual([['failed', 'Needs from you: an API key', ''], ['completed', null, 'plain words']]);
  });

  it('is empty, not an error, without tasks', () => {
    expect(summarizeRunOutput()).toEqual({ tasks: [] });
    expect(summarizeRunOutput(null)).toEqual({ tasks: [] });
  });
});
