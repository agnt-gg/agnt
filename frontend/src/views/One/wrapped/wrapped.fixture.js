/**
 * A year in review shaped as GET /api/wrapped/:year returns it, for the Wrapped specs.
 *
 * One active day in March, then every day from October 1 to November 12, with
 * October 28 the busiest; the window ends November 12, so November is partial.
 */
export function yearFixture(overrides = {}) {
  const days = [['2026-03-03', 50]];
  for (let d = new Date(Date.UTC(2026, 9, 1)); d <= new Date(Date.UTC(2026, 10, 12)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push([iso, iso === '2026-10-28' ? 400 : iso.startsWith('2026-11') ? 120 : 100]);
  }
  return {
    success: true,
    year: 2026,
    window: { from: '2026-01-01', through: '2026-11-12', complete: false },
    totals: {
      calls: 4200, costUsd: 12.5, unpricedCalls: 3, notionalUsd: 640.2, notionalUncachedUsd: 2400.9, notionalSavedUsd: 1760.7,
      uncachedCostUsd: 20, savedUsd: 7.5, inputTokens: 90000000, outputTokens: 47000000, cacheReadTokens: 81000000, cacheWriteTokens: 1000000,
    },
    days,
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
