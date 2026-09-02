// Rail badges — the small live count on a sidebar row.
//
// A row that has something HAPPENING says so; the others stay quiet. Only
// three rows qualify: Goals (executing), Traces (running now) and Connectors
// (needs attention). Each is a pure function over the store so the number on
// the rail cannot disagree with the number on the screen it leads to — they
// read the same getter.
//
// Keys here MUST match the `badge` field in sections.js; sections.spec.js
// checks that every declared badge has a reader.

const RUNNING = new Set(['running', 'executing', 'in_progress', 'active']);

export function countExecutingGoals(goals) {
  return (goals || []).filter((g) => g && g.status === 'executing').length;
}

export function countRunningExecutions(executions) {
  return (executions || []).filter((e) => e && RUNNING.has(String(e.status || '').toLowerCase())).length;
}

export function countConnectorAttention(connectorsState) {
  const n = connectorsState?.attentionCount;
  return Number.isFinite(n) ? n : 0;
}

/** Readers keyed by section badge id. Each returns a number; 0 renders nothing. */
export const RAIL_BADGE_READERS = {
  goals: (store) => countExecutingGoals(store.getters['goals/allGoals']),
  traces: (store) => countRunningExecutions(store.getters['executionHistory/getExecutions']),
  connect: (store) => countConnectorAttention(store.state.connectors),
};

/** The label to draw: '' for zero, '99+' past two digits. */
export function badgeLabel(n) {
  if (!n || n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}
