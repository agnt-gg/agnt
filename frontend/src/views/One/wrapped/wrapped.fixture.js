/**
 * A year in review shaped as GET /api/wrapped/:year returns it, for the Wrapped specs.
 *
 * Runs every day from January 1 to November 12 (the window ends November 12,
 * so November is partial): 100 a day to September, 200 a day in October with
 * 900 on October 28, 150 a day in November. The current streak is 500 days,
 * since July 2 of the year before. The ledger and token counts start March 3.
 */
export function fixtureDays() {
  const days = [];
  for (let d = new Date(Date.UTC(2026, 0, 1)); d <= new Date(Date.UTC(2026, 10, 12)); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const runs = date === '2026-10-28' ? 900 : date.startsWith('2026-10') ? 200 : date.startsWith('2026-11') ? 150 : 100;
    days.push({ date, runs, active: true });
  }
  return days;
}

export function yearFixture(overrides = {}) {
  return {
    success: true,
    year: 2026,
    window: { from: '2026-01-01', through: '2026-11-12', complete: false },
    activity: {
      days: fixtureDays(),
      runs: 36000,
      tokens: 59000000000,
      tokensFrom: '2026-03-03',
      streak: { days: 500, since: '2025-07-02', lastActiveDate: '2026-11-13' },
    },
    totals: {
      calls: 4200, costUsd: 12.5, unpricedCalls: 3, notionalUsd: 640.2, notionalUncachedUsd: 2400.9, notionalSavedUsd: 1760.7,
      uncachedCostUsd: 20, savedUsd: 7.5, inputTokens: 90000000, outputTokens: 47000000, cacheReadTokens: 81000000, cacheWriteTokens: 1000000,
    },
    ledger: { from: '2026-03-03' },
    models: {
      count: 30,
      top: [
        { name: 'claude-opus-5-5', calls: 1900 },
        { name: 'gpt-6-astra', calls: 900 },
        { name: 'claude-opus-5', calls: 600 },
        { name: 'glm-4.6v-flash', calls: 300 },
        { name: 'gpt-5.5', calls: 150 },
      ],
    },
    providers: { count: 6 },
    conversations: { count: 210 },
    origins: { chat: 1300, orchestrator: 1000, workflow_node: 1200, goal_task: 200, goal_eval: 100, suggestion: 400 },
    split: { conversation: 2300, automation: 1500 },
    goals: { top: [{ title: 'Morning digest', calls: 400 }, { title: 'Search the site', calls: 120 }], created: 12, validated: 10 },
    built: { skills: { '2026-09': 30, '2026-10': 5 }, agents: { '2026-09': 12 }, widgets: {}, goals: { '2026-04': 12 }, workflows: { '2026-10': 2 } },
    learning: { insightsApplied: 120, insightsRejected: 7, skillTrials: 40, skillsKept: 11, skillsPromoted: 4, memories: 900 },
    ...overrides,
  };
}

/** The fixture with its activity days replaced (and runs re-totalled). */
export function withDays(days, activity = {}) {
  const base = yearFixture();
  return yearFixture({ activity: { ...base.activity, days, runs: days.reduce((n, d) => n + d.runs, 0), ...activity } });
}
