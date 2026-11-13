import db from '../../models/database/index.js';
import LlmCallModel, { CHAT_SURFACE_ORIGINS } from '../../models/LlmCallModel.js';

/**
 * The numbers behind AGNT One's year in review ("Wrapped"): the ledger's totals
 * for the year, calls per local day, the most used models and goals, and what
 * was built and learned.
 *
 * A year is whole local days, the days the ledger itself buckets by
 * (DATE(ts, 'localtime')), and it ends at the start of today: a day is counted
 * once it is over, so the cards never show a half day as a slow one.
 */

const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
const dbAll = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows || []))));

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
  const [goals, built, learning] = await Promise.all([
    goalsOfYear(userId, range, byOriginId),
    builtByMonth(userId, range),
    learningOfYear(userId, range),
  ]);

  return {
    year,
    window: { from: window.from, through: window.through, complete: window.complete },
    totals,
    days: byDay.map((r) => [r.bucket, r.calls]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
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
