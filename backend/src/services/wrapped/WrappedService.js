import db from '../../models/database/index.js';
import ExecutionModel from '../../models/ExecutionModel.js';
import LlmCallModel, { CHAT_SURFACE_ORIGINS } from '../../models/LlmCallModel.js';

/**
 * The numbers behind AGNT One's year in review ("Wrapped").
 *
 * Activity (runs, active days, tokens and the streak) comes from the execution
 * tables, through the same ExecutionModel reads the dashboard and its streak
 * badge use, so the cards and the dashboard cannot disagree. Facts only the
 * ledger records (calls, models, providers, cost) come from the ledger, which
 * can start later than the runs do; `ledger.from` says where it starts.
 *
 * A year is whole local days (DATE(..., 'localtime'), as both sources bucket
 * them), and it ends at the start of today: a day is counted once it is over,
 * so the cards never show a half day as a slow one. The streak is the one
 * exception: like the dashboard's, it runs over all of history, as of today.
 */

const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
const dbAll = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows || []))));

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 'YYYY-MM-DD' + n local calendar days. */
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
};

/** The UTC instant a local calendar day starts at, written the way `ts` and `created_at` are stored. */
export function localDayStart(year, monthIndex, day) {
  return new Date(year, monthIndex, day).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The year's window: from local Jan 1 to the start of today, or to the next
 * Jan 1 once the year is over. `from` and `through` are the first and last
 * local dates inside it.
 */
export function yearWindow(year, now = new Date()) {
  const since = localDayStart(year, 0, 1);
  const nextYear = localDayStart(year + 1, 0, 1);
  const today = localDayStart(now.getFullYear(), now.getMonth(), now.getDate());
  const complete = today >= nextYear;
  const last = complete ? new Date(year, 11, 31) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { since, until: complete ? nextYear : today, complete, from: `${year}-01-01`, through: localDate(last) };
}

/** What counts as built, per kind: the owner's own rows, as their lists show them. */
const BUILT = Object.freeze({
  skills: { table: 'skills', owner: 'user_id = ? AND COALESCE(is_builtin, 0) = 0' },
  agents: { table: 'agents', owner: 'created_by = ? AND deleted_at IS NULL' },
  widgets: { table: 'widget_definitions', owner: 'user_id = ?' },
  goals: { table: 'goals', owner: 'user_id = ? AND deleted_at IS NULL' },
  workflows: { table: 'workflows', owner: 'user_id = ? AND deleted_at IS NULL' },
});

// created_at is written both as 'YYYY-MM-DD HH:MM:SS' and as ISO 8601 with a
// 'T' and 'Z'; datetime() reads both, so the comparison is by instant.
const CREATED_IN = 'datetime(created_at) >= ? AND datetime(created_at) < ?';

async function builtByMonth(userId, range) {
  const built = {};
  for (const [kind, { table, owner }] of Object.entries(BUILT)) {
    const rows = await dbAll(
      `SELECT strftime('%Y-%m', created_at, 'localtime') AS month, COUNT(*) AS n
         FROM ${table} WHERE ${owner} AND ${CREATED_IN} GROUP BY month`,
      [userId, range.since, range.until],
    );
    built[kind] = Object.fromEntries(rows.filter((r) => r.month).map((r) => [r.month, Number(r.n)]));
  }
  return built;
}

/** The goals that ran most (by ledger calls), and how many goals set this year passed evaluation. */
async function goalsOfYear(userId, range, callsByOrigin) {
  const owned = await dbAll(
    'SELECT id, title, status, datetime(created_at) AS created FROM goals WHERE user_id = ? AND deleted_at IS NULL',
    [userId],
  );
  const titles = new Map(owned.map((g) => [g.id, g.title]));
  const top = callsByOrigin
    .filter((r) => titles.has(r.bucket))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 3)
    .map((r) => ({ title: titles.get(r.bucket), calls: r.calls }));
  const setThisYear = owned.filter((g) => g.created >= range.since && g.created < range.until);
  return { top, created: setThisYear.length, validated: setThisYear.filter((g) => g.status === 'validated').length };
}

async function learningOfYear(userId, range) {
  const params = [userId, range.since, range.until];
  const [insights, evaluations, memories] = await Promise.all([
    dbAll(`SELECT status, COUNT(*) AS n FROM insights WHERE user_id = ? AND ${CREATED_IN} GROUP BY status`, params),
    dbAll(`SELECT decision, COUNT(*) AS n FROM skill_evaluations WHERE user_id = ? AND ${CREATED_IN} GROUP BY decision`, params),
    dbGet(`SELECT COUNT(*) AS n FROM agent_memory WHERE user_id = ? AND ${CREATED_IN}`, params),
  ]);
  const count = (rows, key, values) => rows.filter((r) => values.includes(r[key])).reduce((sum, r) => sum + Number(r.n), 0);
  return {
    insightsApplied: count(insights, 'status', ['applied']),
    insightsRejected: count(insights, 'status', ['rejected']),
    skillTrials: evaluations.reduce((sum, r) => sum + Number(r.n), 0),
    // SkillForge's own stats count a promoted skill as kept too.
    skillsKept: count(evaluations, 'decision', ['kept', 'promoted']),
    skillsPromoted: count(evaluations, 'decision', ['promoted']),
    memories: Number(memories?.n) || 0,
  };
}

/**
 * The year's activity, by local day: runs, whether the day was active (the
 * streak's rule: some run did work), and tokens, as the dashboard counts them.
 * The streak is the dashboard's: unbroken days up to today, over all history.
 */
async function activityOfYear(userId, window) {
  const [runsByDay, dashboardDays, current] = await Promise.all([
    ExecutionModel.countRunsByDay(userId, window.from, window.through),
    // The dashboard's daily figures; its end date is exclusive.
    ExecutionModel.getAgentActivityData(userId, window.from, addDays(window.through, 1)),
    ExecutionModel.getActivityStreak(userId),
  ]);
  const inYear = dashboardDays.filter((row) => row.date >= window.from && row.date <= window.through);
  const active = new Set(inYear.filter((row) => Number(row.credits_used) > 0).map((row) => row.date));
  const runs = new Map(runsByDay.map((row) => [row.date, row.runs]));
  const tokenDays = inYear.filter((row) => Number(row.total_tokens) > 0).map((row) => row.date).sort();
  return {
    days: [...new Set([...runs.keys(), ...active])].sort().map((date) => ({ date, runs: runs.get(date) || 0, active: active.has(date) })),
    runs: runsByDay.reduce((sum, row) => sum + row.runs, 0),
    tokens: inYear.reduce((sum, row) => sum + (Number(row.total_tokens) || 0), 0),
    tokensFrom: tokenDays[0] || null,
    streak: {
      days: current.streak,
      since: current.streak > 0 ? addDays(current.lastActiveDate, -(current.streak - 1)) : null,
      lastActiveDate: current.lastActiveDate,
    },
  };
}

const byCallsThenName = (a, b) => b.calls - a.calls || String(a.bucket).localeCompare(String(b.bucket));

// Calls a person started in a chat surface ('chat' is the pre-split legacy
// origin), against calls that workflows and goals made on their own.
const CONVERSATION_ORIGINS = new Set([...CHAT_SURFACE_ORIGINS, 'chat']);
const AUTOMATION_ORIGINS = new Set(['workflow_node', 'goal_task', 'goal_eval']);

function splitByOrigin(rows) {
  const sum = (set) => rows.filter((r) => set.has(r.bucket)).reduce((n, r) => n + r.calls, 0);
  return { conversation: sum(CONVERSATION_ORIGINS), automation: sum(AUTOMATION_ORIGINS) };
}

/** The year in review for one user. `now` is injectable so the window can be tested. */
export async function yearInReview(userId, year, now = new Date()) {
  const window = yearWindow(year, now);
  const range = { since: window.since, until: window.until };
  const breakdown = async (groupBy) => (await LlmCallModel.breakdown(userId, { groupBy, ...range })).filter((r) => r.bucket);

  const [totals, byDay, byModel, byProvider, byConversation, byOrigin, byOriginId] = await Promise.all([
    LlmCallModel.summary(userId, range),
    breakdown('day'),
    breakdown('model'),
    breakdown('provider'),
    breakdown('conversation'),
    breakdown('origin'),
    breakdown('origin_id'),
  ]);
  const [goals, built, learning, activity] = await Promise.all([
    goalsOfYear(userId, range, byOriginId),
    builtByMonth(userId, range),
    learningOfYear(userId, range),
    activityOfYear(userId, window),
  ]);

  return {
    year,
    window: { from: window.from, through: window.through, complete: window.complete },
    activity,
    totals,
    ledger: { from: byDay.map((r) => r.bucket).sort()[0] || null },
    models: { count: byModel.length, top: byModel.sort(byCallsThenName).slice(0, 5).map((r) => ({ name: r.bucket, calls: r.calls })) },
    providers: { count: byProvider.length },
    conversations: { count: byConversation.length },
    origins: Object.fromEntries(byOrigin.map((r) => [r.bucket, r.calls])),
    split: splitByOrigin(byOrigin),
    goals,
    built,
    learning,
  };
}
