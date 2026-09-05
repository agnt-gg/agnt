// Presentation only: keep the server's execution statuses intact. The board,
// filter counts, and card actions must all use the same classification.
export const GOAL_COLUMNS = Object.freeze([
  { id: 'todo', title: 'To do', icon: 'fas fa-inbox', color: 'var(--color-text-muted)', description: 'Ideas & incoming work', action: 'View idea' },
  { id: 'plan', title: 'Plan', icon: 'fas fa-file-alt', color: 'var(--color-violet)', description: 'Review the approach', action: 'Review plan', decision: true },
  { id: 'build', title: 'Build', icon: 'fas fa-code', color: 'var(--color-green)', description: 'Execution, tests & repairs', action: 'View progress' },
  { id: 'review', title: 'Review', icon: 'fas fa-eye', color: 'var(--color-orange)', description: 'Review the result', action: 'Review result', decision: true },
  { id: 'done', title: 'Done', icon: 'fas fa-check-circle', color: 'var(--color-green)', description: 'Completed & accepted work', action: 'View result' },
]);

function hasExecutionHistory(goal) {
  // GoalService.reviewGoal distinguishes unrun proposals from result reviews
  // using iterations, loop state, and task status. List payloads also provide
  // completed_tasks, before detailed tasks have been fetched.
  return Number(goal.current_iteration) > 0 ||
    goal.loop_status != null ||
    Number(goal.completed_tasks) > 0 ||
    (Array.isArray(goal.tasks) && goal.tasks.some((task) => task.status != null && task.status !== 'pending'));
}

export function getGoalStage(goal = {}) {
  const status = String(goal.status || '').toLowerCase();
  if (['completed', 'validated'].includes(status)) return 'done';
  if (['executing', 'paused', 'queued', 'failed', 'error', 'stopped'].includes(status)) return 'build';
  // needs_review also represents proposals which have never executed.
  if (status === 'needs_review') return hasExecutionHistory(goal) ? 'review' : 'plan';
  if (status === 'planning') {
    // Feedback parks an executed goal in planning until its retry starts.
    if (hasExecutionHistory(goal)) return 'build';
    return Number(goal.task_count) > 0 || goal.tasks?.length > 0 ? 'plan' : 'todo';
  }
  // Unplanned and unknown states stay discoverable instead of disappearing.
  return 'todo';
}

export function getGoalColumn(goal) {
  return GOAL_COLUMNS.find((column) => column.id === getGoalStage(goal));
}

export function needsGoalReview(goal) {
  return Boolean(getGoalColumn(goal).decision);
}

export function matchesGoalFilter(goal, filter) {
  if (filter === 'attention') return needsGoalReview(goal);
  return getGoalStage(goal) === filter;
}
