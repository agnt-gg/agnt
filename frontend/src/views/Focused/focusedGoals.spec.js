import { describe, it, expect } from 'vitest';
import { goalSections, goalFilterCounts, goalLine, goalProgress, GOAL_FILTERS } from './focusedGoals.js';

const goal = (id, status, over = {}) => ({ id, title: `Goal ${id}`, status, updated_at: '2026-11-20T10:00:00Z', ...over });
const routine = (id, goalId, over = {}) => ({ id, goalId, label: `Routine ${id}`, cadence: 'Every day', enabled: true, ...over });

describe('Goals page sections', () => {
  const goals = [
    goal('plan', 'needs_review'),
    goal('review', 'needs_review', { current_iteration: 1, completed_tasks: 2, task_count: 17 }),
    goal('build', 'executing', { completed_tasks: 4, task_count: 12 }),
    goal('todo', 'planning'),
    goal('done', 'validated'),
    goal('ran-by-routine', 'validated'),
  ];
  const routines = [routine('r1', 'ran-by-routine'), routine('r2', null, { label: 'Inbox cleanup' })];

  it('groups by what each goal needs from you, repeating goals in their own section', () => {
    const sections = goalSections({ goals, routines });
    expect(sections.map((s) => [s.id, s.rows.map((r) => r.id)])).toEqual([
      ['needs', ['plan', 'review']],
      ['progress', ['build']],
      ['todo', ['todo']],
      ['repeating', ['r1', 'r2']],
      ['done', ['done']],
    ]);
  });

  it('lists a goal a routine runs once, under Repeating', () => {
    const ids = goalSections({ goals, routines }).filter((s) => s.kind === 'goal').flatMap((s) => s.rows.map((r) => r.id));
    expect(ids).not.toContain('ran-by-routine');
  });

  it('filters to one group, In progress including goals not started yet', () => {
    expect(goalSections({ goals, routines, filter: 'needs' }).map((s) => s.id)).toEqual(['needs']);
    expect(goalSections({ goals, routines, filter: 'progress' }).map((s) => s.id)).toEqual(['progress', 'todo']);
    expect(goalSections({ goals, routines, filter: 'repeating' }).map((s) => s.id)).toEqual(['repeating']);
  });

  it('searches titles and schedules, and leaves empty sections out', () => {
    expect(goalSections({ goals, routines, query: 'inbox' }).map((s) => [s.id, s.rows.length])).toEqual([['repeating', 1]]);
    expect(goalSections({ goals: [], routines: [] })).toEqual([]);
    expect(goalSections()).toEqual([]);
  });

  it('counts every filter from the same sections', () => {
    expect(goalFilterCounts({ goals, routines })).toEqual({ all: 7, needs: 2, progress: 2, repeating: 2, done: 1 });
    expect(GOAL_FILTERS.map((f) => f.id)).toEqual(['all', 'needs', 'progress', 'repeating', 'done']);
  });
});

describe('a goal in plain words', () => {
  it('says what it needs and how far along it is', () => {
    expect(goalLine(goal('p', 'needs_review'))).toBe('A plan is ready for your OK');
    expect(goalLine(goal('r', 'needs_review', { current_iteration: 1, completed_tasks: 2, task_count: 17 }))).toBe('Ready for your review \u00b7 2 of 17 tasks done');
    expect(goalLine(goal('b', 'executing', { completed_tasks: 4, task_count: 12 }))).toBe('Working on it \u00b7 4 of 12 tasks done');
    expect(goalLine(goal('x', 'paused'))).toBe('Paused');
    expect(goalLine(goal('f', 'failed'))).toBe('Stopped before it finished');
    expect(goalLine(goal('d', 'completed'))).toBe('Done');
    expect(goalLine(goal('t', 'planning'))).toBe('Not started yet');
  });

  it('measures progress from its tasks, or not at all', () => {
    expect(goalProgress(goal('b', 'executing', { completed_tasks: 3, task_count: 12 }))).toBe(0.25);
    expect(goalProgress(goal('t', 'planning', { tasks: [{ status: 'completed' }, { status: 'pending' }] }))).toBe(0.5);
    expect(goalProgress(goal('n', 'planning'))).toBeNull();
  });
});
