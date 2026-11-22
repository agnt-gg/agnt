import { getGoalStage } from '@/views/Terminal/CenterPanel/screens/Goals/goalBoard.js';

/**
 * The Goals page: one-off goals and repeating goals (routines) in one list,
 * grouped by what each one needs from you. Pure: goals and schedule rows in,
 * sections out. A goal a routine runs is the routine's, so it is listed once,
 * under Repeating.
 */

/** Filters across the top of the page, in order. */
export const GOAL_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'progress', label: 'In progress' },
  { id: 'repeating', label: 'Repeating' },
  { id: 'done', label: 'Done' },
]);

const SECTIONS = Object.freeze([
  { id: 'needs', title: 'Needs you', stages: ['plan', 'review'] },
  { id: 'progress', title: 'In progress', stages: ['build'] },
  { id: 'todo', title: 'Not started', stages: ['todo'] },
]);

const timeOf = (value) => {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};
const newestFirst = (a, b) => timeOf(b.updated_at || b.created_at) - timeOf(a.updated_at || a.created_at);

/** What a goal's row says under its title, in plain words. */
export function goalLine(goal = {}) {
  const stage = getGoalStage(goal);
  const total = Number(goal.task_count) || (Array.isArray(goal.tasks) ? goal.tasks.length : 0);
  const done = Number(goal.completed_tasks) || (Array.isArray(goal.tasks) ? goal.tasks.filter((t) => t?.status === 'completed').length : 0);
  const tasks = total ? `${done} of ${total} tasks done` : '';
  const status = String(goal.status || '').toLowerCase();
  if (stage === 'plan') return 'Annie made a plan. Approve it and she starts';
  if (stage === 'review') return 'Annie finished. Check the result before it’s done';
  if (stage === 'build') {
    if (status === 'paused') return ['Paused', tasks].filter(Boolean).join(' \u00b7 ');
    if (['failed', 'error', 'stopped'].includes(status)) return 'Stopped before it finished';
    if (status === 'queued') return 'Waiting to start';
    return ['Working on it', tasks].filter(Boolean).join(' \u00b7 ');
  }
  if (stage === 'done') return 'Done';
  return 'Not started yet';
}

/** The one button a goal that needs you shows, named for what it does. */
export function goalAction(goal = {}) {
  return getGoalStage(goal) === 'plan' ? 'Approve the plan' : 'Check the result';
}

/** "3 of 9 tasks", or '' when the goal has no tasks to count. */
export function goalSteps(goal = {}) {
  const total = Number(goal.task_count) || (Array.isArray(goal.tasks) ? goal.tasks.length : 0);
  if (!total) return '';
  const done = Number(goal.completed_tasks) || (Array.isArray(goal.tasks) ? goal.tasks.filter((t) => t?.status === 'completed').length : 0);
  return `${done} of ${total} tasks`;
}

/** 0 to 1, or null when the goal has no tasks to count. */
export function goalProgress(goal = {}) {
  const total = Number(goal.task_count) || (Array.isArray(goal.tasks) ? goal.tasks.length : 0);
  if (!total) return null;
  const done = Number(goal.completed_tasks) || (Array.isArray(goal.tasks) ? goal.tasks.filter((t) => t?.status === 'completed').length : 0);
  return Math.max(0, Math.min(1, done / total));
}

/**
 * The page's sections for a filter. Each section is { id, title, kind, rows };
 * kind is 'goal' or 'repeating'. Empty sections are left out.
 */
export function goalSections({ goals = [], routines = [], filter = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const hit = (...texts) => !q || texts.some((t) => String(t || '').toLowerCase().includes(q));
  const routineGoalIds = new Set((Array.isArray(routines) ? routines : []).map((r) => r?.goalId).filter((id) => id != null).map(String));
  const oneOff = (Array.isArray(goals) ? goals : [])
    .filter((g) => g && g.id != null && !routineGoalIds.has(String(g.id)) && hit(g.title, g.description))
    .sort(newestFirst);
  const byStage = (stages) => oneOff.filter((g) => stages.includes(getGoalStage(g)));
  const repeating = (Array.isArray(routines) ? routines : []).filter((r) => r && hit(r.label, r.cadence));

  const all = [
    ...SECTIONS.map((s) => ({ id: s.id, title: s.title, kind: 'goal', rows: byStage(s.stages) })),
    { id: 'repeating', title: 'Repeating', kind: 'repeating', rows: repeating },
    { id: 'done', title: 'Done', kind: 'goal', rows: byStage(['done']) },
  ];
  const wanted = filter === 'all' ? null : filter === 'progress' ? ['progress', 'todo'] : [filter];
  return all.filter((s) => s.rows.length && (!wanted || wanted.includes(s.id)));
}

/** How many goals each filter would show. */
export function goalFilterCounts({ goals = [], routines = [] } = {}) {
  const sections = goalSections({ goals, routines });
  const n = (id) => sections.find((s) => s.id === id)?.rows.length || 0;
  return {
    all: sections.reduce((sum, s) => sum + s.rows.length, 0),
    needs: n('needs'),
    progress: n('progress') + n('todo'),
    repeating: n('repeating'),
    done: n('done'),
  };
}
