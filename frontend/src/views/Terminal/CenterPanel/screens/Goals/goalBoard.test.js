import { describe, it, expect } from 'vitest';
import { GOAL_COLUMNS, getGoalStage, getGoalColumn, matchesGoalFilter } from './goalBoard.js';

describe('Goals Kanban stages', () => {
  it('keeps the requested five-column order', () => {
    expect(GOAL_COLUMNS.map(({ title }) => title)).toEqual(['To do', 'Plan', 'Build', 'Review', 'Done']);
  });

  it.each([
    [{ status: 'pending' }, 'todo'],
    [{ status: 'planning', task_count: 0 }, 'todo'],
    [{ status: 'planning', task_count: 3 }, 'plan'],
    [{ status: 'planning', tasks: [{ status: 'pending' }] }, 'plan'],
    [{ status: 'needs_review', task_count: 0, current_iteration: 0 }, 'plan'],
    [{ status: 'needs_review', tasks: [{ status: 'pending' }] }, 'plan'],
    [{ status: 'needs_review', current_iteration: 1 }, 'review'],
    [{ status: 'needs_review', completed_tasks: 1 }, 'review'],
    [{ status: 'needs_review', loop_status: 'max_iterations' }, 'review'],
    [{ status: 'needs_review', tasks: [{ status: 'failed' }] }, 'review'],
    [{ status: 'planning', current_iteration: 2 }, 'build'],
    [{ status: 'planning', completed_tasks: 2 }, 'build'],
    [{ status: 'queued' }, 'build'],
    [{ status: 'executing' }, 'build'],
    [{ status: 'paused' }, 'build'],
    [{ status: 'failed' }, 'build'],
    [{ status: 'error' }, 'build'],
    [{ status: 'stopped' }, 'build'],
    [{ status: 'completed' }, 'done'],
    [{ status: 'validated' }, 'done'],
    [{ status: 'new-server-status' }, 'todo'],
    [{}, 'todo'],
  ])('classifies %j as %s without mutating it', (goal, expected) => {
    const original = structuredClone(goal);
    expect(getGoalStage(goal)).toBe(expected);
    expect(goal).toEqual(original);
    expect(GOAL_COLUMNS.filter(({ id }) => matchesGoalFilter(goal, id))).toHaveLength(1);
  });

  it('counts plan and result reviews with the same predicate as the board', () => {
    const goals = [
      { status: 'planning', task_count: 3 },
      { status: 'needs_review', current_iteration: 2 },
      { status: 'queued' }, { status: 'failed' }, { status: 'completed' },
    ];
    expect(goals.filter((goal) => matchesGoalFilter(goal, 'attention'))).toEqual(goals.slice(0, 2));
  });

  it('gives every stage its matching action', () => {
    expect(GOAL_COLUMNS.map(({ action }) => action)).toEqual(['View idea', 'Review plan', 'View progress', 'Review result', 'View result']);
    expect(getGoalColumn({ status: 'validated' }).decision).toBeUndefined();
    expect(getGoalColumn({ status: 'needs_review', current_iteration: 1 }).decision).toBe(true);
  });
});
