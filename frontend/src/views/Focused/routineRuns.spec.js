import { describe, it, expect } from 'vitest';
import { runOutputFromGoalTasks, goalTasksAreFromRun, taskTone, waitingQuestion, resultOf } from './routineRuns.js';
import { formatDuration } from './focusedTime.js';

describe('routine run history', () => {
  it('reads the goal’s top-level tasks into a run output, in plan order', () => {
    const output = runOutputFromGoalTasks([
      { title: 'Send', status: 'completed', order_index: 2, output: JSON.stringify({ content: 'Sent.', files: [{ name: 'digest.html' }] }) },
      { title: 'Search', status: 'completed', order_index: 1, output: { content: 'Found 12 stories.' } },
      { title: 'Sub', status: 'completed', order_index: 0, parent_task_id: 'x', output: { content: 'hidden' } },
      { title: 'Pull analytics', status: 'failed', order_index: 3, error: 'Needs from you: an API key', output: null },
    ]);
    expect(output.tasks.map((t) => [t.title, t.status, t.content, t.error, t.files])).toEqual([
      ['Search', 'completed', 'Found 12 stories.', null, []],
      ['Send', 'completed', 'Sent.', null, ['digest.html']],
      ['Pull analytics', 'failed', '', 'Needs from you: an API key', []],
    ]);
  });

  it('uses the goal’s tasks only for the newest run, and only while no later run has reset them', () => {
    const newest = { id: 'r2', fired_at: '2026-11-21 14:00:49' };
    const older = { id: 'r1', fired_at: '2026-11-20 14:00:49' };
    const tasks = [{ started_at: '2026-11-21 14:01:10' }];
    expect(goalTasksAreFromRun(newest, newest, tasks)).toBe(true);
    expect(goalTasksAreFromRun(older, newest, tasks)).toBe(false);
    expect(goalTasksAreFromRun(newest, newest, [{ started_at: '2026-11-20 14:01:10' }])).toBe(false);
    expect(goalTasksAreFromRun(newest, newest, [])).toBe(false);
  });

  it('reads the question a waiting run asks, and nothing from any other run', () => {
    expect(waitingQuestion({ status: 'needs_input', error: 'Needs from you: Pull analytics: an API key' })).toBe('Pull analytics: an API key');
    expect(waitingQuestion({ status: 'needs_input', error: null })).toBe('It has a question for you.');
    expect(waitingQuestion({ status: 'failed', error: 'Needs from you: x' })).toBeNull();
    expect(waitingQuestion(null)).toBeNull();
  });

  it('a run’s result is its last finished step with something to read', () => {
    const output = { tasks: [
      { title: 'Search', status: 'completed', content: 'Found 12.' },
      { title: 'Summarize', status: 'completed', content: '## Top stories' },
      { title: 'Send', status: 'failed', content: '' },
    ] };
    expect(resultOf(output).title).toBe('Summarize');
    expect(resultOf({ tasks: [{ title: 'Draft', status: 'failed', content: 'Partial' }] }).title).toBe('Draft');
    expect(resultOf({ tasks: [] })).toBeNull();
    expect(resultOf(null)).toBeNull();
  });

  it('says how a task went and how long a run took', () => {
    expect(taskTone('completed')).toEqual({ label: 'Done', tag: 'green' });
    expect(taskTone('failed').label).toBe('Failed');
    expect(taskTone('pending').label).toBe('Not run');
    expect([formatDuration(45_000), formatDuration(134_000), formatDuration(3_780_000), formatDuration(null), formatDuration(120_000)]).toEqual(['45s', '2m 14s', '1h 3m', '', '2m']);
  });
});
