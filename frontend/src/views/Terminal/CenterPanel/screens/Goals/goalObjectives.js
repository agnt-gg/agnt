import { API_CONFIG } from '@/tt.config.js';

/** The board's filter for goals that serve no objective (an objective id is a UUID, never this). */
export const NO_OBJECTIVE = 'none';

async function request(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Sign in to see objectives.');
  const response = await fetch(`${API_CONFIG.BASE_URL}/goals${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Objectives are unavailable right now'), { status: response.status });
  return result;
}

/** The objectives a person's goals serve: list, add, edit, retire, and link a goal to one. */
export const objectivesApi = {
  list: () => request('/objectives'),
  create: (input) => request('/objectives', { method: 'POST', body: input }),
  update: (id, input) => request('/objectives/' + encodeURIComponent(id), { method: 'PUT', body: input }),
  retire: (id) => request('/objectives/' + encodeURIComponent(id), { method: 'DELETE' }),
  link: (goalId, objectiveId) => request('/' + encodeURIComponent(goalId) + '/objective', { method: 'PUT', body: { objectiveId: objectiveId || null } }),
};

/** Does this goal pass the board's objective filter (null: no filter)? */
export function matchesObjective(goal, filter, objectives = []) {
  if (!filter) return true;
  if (filter === NO_OBJECTIVE) return !goal.objective_id || !objectives.some((o) => o.id === goal.objective_id);
  return goal.objective_id === filter;
}

/** How far along an objective is, by the goals that serve it: done of all, in percent. */
export const objectiveProgress = (objective) => (objective?.goals ? Math.round((objective.done / objective.goals) * 100) : 0);

/** Goals on the board that serve none of the live objectives (zero when there are no objectives). */
export function unlinkedCount(goals = [], objectives = []) {
  if (!objectives.length) return 0;
  return goals.filter((goal) => matchesObjective(goal, NO_OBJECTIVE, objectives)).length;
}

/** The title of the objective a goal serves, or '' when it serves none. */
export const servesTitle = (goal, objectives = []) => objectives.find((o) => o.id === goal?.objective_id)?.title || '';
