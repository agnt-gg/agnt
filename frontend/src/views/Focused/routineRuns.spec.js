import { describe, it, expect } from 'vitest';
import { runOutputFromGoalTasks, goalTasksAreFromRun, taskTone } from './routineRuns.js';
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

  it('says how a task went and how long a run took', () => {
    expect(taskTone('completed')).toEqual({ label: 'Done', tag: 'green' });
    expect(taskTone('failed').label).toBe('Failed');
    expect(taskTone('pending').label).toBe('Not run');
    expect([formatDuration(45_000), formatDuration(134_000), formatDuration(3_780_000), formatDuration(null)]).toEqual(['45s', '2m 14s', '1h 3m', '']);
  });
});
