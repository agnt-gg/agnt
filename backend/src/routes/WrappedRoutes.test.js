/**
 * HTTP contract for the year in review (GET /api/wrapped/:year): real express
 * routing, real status codes and JSON, against a throwaway database seeded
 * through the ledger's own write path and the execution tables the dashboard
 * reads.
 *
 * The year under test is LAST year, so its window is complete and the result
 * does not depend on the day the suite runs. The streak is the exception by
 * design: it runs up to today, like the dashboard's.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

const USER = 'user-wrapped';
const OTHER = 'user-wrapped-other';
// Runs every day from Jan 1 of the year under test until today; the ledger only from March 11.
const LONG = 'user-wrapped-long-streak';
const YEAR = new Date().getFullYear() - 1;

vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    const id = req.headers['x-test-user'] || USER;
    req.user = { isAuthenticated: true, id, userId: id };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

let server;
let baseUrl;
let db;
let TMP;
let recordLlmCall;
let yearWindow;
let localDayStart;
const savedEnv = {};

const get = async (url, user) => {
  const res = await fetch(baseUrl + url, user ? { headers: { 'x-test-user': user } } : undefined);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
};
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

/** A local wall-clock moment, written the way `ts` / CURRENT_TIMESTAMP store it (UTC). */
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m, d, hh, mm).toISOString().replace('T', ' ').slice(0, 19);
/** The same moment as ISO 8601 with 'T' and 'Z', the other way created_at is written. */
const atIso = (y, m, d, hh = 12) => new Date(y, m, d, hh).toISOString();

async function call({ user = USER, ts, origin = 'chat', originId = null, model = 'claude-sonnet-4-5-20250929', provider = 'anthropic', conversationId = null }) {
  const id = await recordLlmCall({ userId: user, origin, originId, conversationId, provider, model, usage: { inputTokens: 1000, outputTokens: 100 } });
  await dbRun('UPDATE llm_calls SET ts = ? WHERE id = ?', [ts, id]);
  return id;
}

let seq = 0;
/** A workflow run; `tokens` adds an LLM node that measured that many (input, output). */
async function workflowRun(user, workflowId, ts, credits, tokens = null) {
  const id = `wfe-${++seq}`;
  await dbRun(
    `INSERT INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time, credits_used)
     VALUES (?, ?, ?, 'Fixture', 'completed', ?, ?)`,
    [id, workflowId, user, ts, credits],
  );
  if (tokens) {
    await dbRun(
      `INSERT INTO node_executions (id, execution_id, node_id, status, start_time, input_tokens, output_tokens)
       VALUES (?, ?, 'llm-node', 'completed', ?, ?, ?)`,
      [`ne-${seq}`, id, ts, tokens[0], tokens[1]],
    );
  }
}
const agentRun = (user, ts, credits, totalTokens = 0) => dbRun(
  `INSERT INTO agent_executions (id, agent_id, agent_name, user_id, status, start_time, credits_used, total_tokens)
   VALUES (?, NULL, 'Fixture Agent', ?, 'completed', ?, ?, ?)`,
  [`age-${++seq}`, user, ts, credits, totalTokens],
);

/** Local dates from `from` through `through`, inclusive. */
function localDates(from, through) {
  const dates = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  for (let d = new Date(fy, fm - 1, fd); ; d.setDate(d.getDate() + 1)) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (ymd > through) return dates;
    dates.push(ymd);
  }
}
let today;

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-wrapped-http-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ({ recordLlmCall } = await import('../services/execution/LedgerRecorder.js'));
  ({ yearWindow, localDayStart } = await import('../services/wrapped/WrappedService.js'));
  const WrappedRoutes = (await import('./WrappedRoutes.js')).default;

  for (const [id, email] of [[USER, 'wrapped@test.local'], [OTHER, 'wrapped-other@test.local'], [LONG, 'wrapped-long@test.local']]) {
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [id, email, id]);
  }

  // ── The ledger ──
  // Edges of the year: the first and last minute are in, a minute either side is out.
  await call({ ts: at(YEAR, 0, 1, 0, 1), conversationId: 'c1' });
  await call({ ts: at(YEAR, 11, 31, 23, 59), conversationId: 'c1' });
  await call({ ts: at(YEAR - 1, 11, 31, 23, 59) });
  await call({ ts: at(YEAR + 1, 0, 1, 0, 1) });
  // A busy day in March with two models, and goal work.
  for (let i = 0; i < 3; i++) await call({ ts: at(YEAR, 2, 10, 9 + i), origin: 'orchestrator', model: 'gpt-5', provider: 'openai', conversationId: 'c2' });
  await call({ ts: at(YEAR, 2, 10, 15), origin: 'workflow_node' });
  for (let i = 0; i < 2; i++) await call({ ts: at(YEAR, 3, 2, 10 + i), origin: 'goal_task', originId: 'goal-digest' });
  await call({ ts: at(YEAR, 3, 3), origin: 'goal_eval', originId: 'goal-search' });
  // Goals that were deleted, or are someone else's, are not ranked.
  await call({ ts: at(YEAR, 3, 4), origin: 'goal_task', originId: 'goal-deleted' });
  await call({ ts: at(YEAR, 3, 4, 13), origin: 'goal_task', originId: 'goal-theirs' });
  // Another user's year.
  await call({ user: OTHER, ts: at(YEAR, 5, 1), origin: 'goal_task', originId: 'goal-theirs' });

  // ── What was built ──
  const goal = (id, user, title, status, created, deleted = null) => dbRun(
    'INSERT INTO goals (id, user_id, title, description, status, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, user, title, title, status, created, deleted],
  );
  await goal('goal-digest', USER, 'Morning digest', 'validated', at(YEAR, 1, 3));
  await goal('goal-search', USER, 'Search the site', 'needs_review', atIso(YEAR, 1, 20));
  await goal('goal-old', USER, 'Last year', 'validated', at(YEAR - 1, 5, 1));
  await goal('goal-deleted', USER, 'Gone', 'validated', at(YEAR, 1, 4), at(YEAR, 1, 5));
  await goal('goal-theirs', OTHER, 'Not yours', 'validated', at(YEAR, 1, 3));

  const agent = (id, user, created, deleted = null) => dbRun(
    'INSERT INTO agents (id, name, status, created_by, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, id, 'active', user, created, deleted],
  );
  await agent('agent-a', USER, at(YEAR, 7, 2));
  await agent('agent-b', USER, atIso(YEAR, 7, 9));
  await agent('agent-gone', USER, at(YEAR, 7, 3), at(YEAR, 8, 1));
  await agent('agent-theirs', OTHER, at(YEAR, 7, 2));

  const skill = (id, user, builtin, created) => dbRun(
    'INSERT INTO skills (id, user_id, name, description, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, user, id, id, builtin, created],
  );
  await skill('skill-mine', USER, 0, at(YEAR, 8, 5));
  await skill('skill-builtin', USER, 1, at(YEAR, 8, 5));
  await skill('skill-before', USER, 0, at(YEAR - 1, 8, 5));

  await dbRun('INSERT INTO widget_definitions (id, user_id, name, created_at) VALUES (?, ?, ?, ?)', ['widget-mine', USER, 'Clock', at(YEAR, 4, 6)]);
  await dbRun('INSERT INTO workflows (id, workflow_data, user_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)', ['wf-mine', '{}', USER, at(YEAR, 6, 7), null]);
  await dbRun('INSERT INTO workflows (id, workflow_data, user_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)', ['wf-gone', '{}', USER, at(YEAR, 6, 8), at(YEAR, 6, 9)]);

  // ── What was learned ──
  const insight = (id, status, created) => dbRun(
    `INSERT INTO insights (id, user_id, source_type, source_id, target_type, category, title, description, status, created_at)
     VALUES (?, ?, 'goal', 'g', 'agent', 'tooling', ?, ?, ?, ?)`,
    [id, USER, id, id, status, created],
  );
  await insight('ins-1', 'applied', at(YEAR, 2, 1));
  await insight('ins-2', 'applied', at(YEAR, 2, 2));
  await insight('ins-3', 'rejected', at(YEAR, 2, 3));
  await insight('ins-4', 'pending', at(YEAR, 2, 4));
  await insight('ins-old', 'applied', at(YEAR - 1, 2, 1));

  const trial = (id, decision) => dbRun(
    'INSERT INTO skill_evaluations (id, skill_id, user_id, source_goal_id, decision, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, 'skill-mine', USER, 'goal-digest', decision, at(YEAR, 8, 10)],
  );
  await trial('ev-1', 'kept');
  await trial('ev-2', 'promoted');
  await trial('ev-3', 'discarded');

  for (const [id, created] of [['mem-1', at(YEAR, 3, 1)], ['mem-2', at(YEAR, 3, 2)], ['mem-old', at(YEAR - 1, 3, 1)]]) {
    await dbRun('INSERT INTO agent_memory (id, agent_id, user_id, memory_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, 'agent-a', USER, 'fact', id, created]);
  }

  // ── Runs, in the tables the dashboard reads ──
  // Edges of the year: the first and last half hour are in, a half hour either side is out.
  await workflowRun(USER, 'wf-mine', at(YEAR, 0, 1, 0, 30), 5);
  await workflowRun(USER, 'wf-mine', at(YEAR, 11, 31, 23, 30), 5);
  await workflowRun(USER, 'wf-mine', at(YEAR - 1, 11, 31, 23, 30), 5);
  await workflowRun(USER, 'wf-mine', at(YEAR + 1, 0, 1, 0, 30), 5);
  // March 10: three workflow runs (one with an LLM node), a run that did no work, and an agent run.
  await workflowRun(USER, 'wf-mine', at(YEAR, 2, 10, 9), 5, [700, 300]);
  await workflowRun(USER, 'wf-mine', at(YEAR, 2, 10, 10), 5);
  await workflowRun(USER, 'wf-mine', at(YEAR, 2, 10, 11), 5);
  await workflowRun(USER, 'wf-mine', at(YEAR, 2, 10, 12), 0);
  await agentRun(USER, at(YEAR, 2, 10, 15), 3, 1500);
  // March 11: a run that did no work is a run, but not an active day.
  await workflowRun(USER, 'wf-mine', at(YEAR, 2, 11, 12), 0);
  await agentRun(USER, at(YEAR, 5, 1, 12), 3, 2500);
  await agentRun(OTHER, at(YEAR, 5, 1, 12), 3);

  ({ today } = await new Promise((res, rej) => db.get(`SELECT DATE('now', 'localtime') AS today`, [], (e, r) => (e ? rej(e) : res(r)))));
  await dbRun('INSERT INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', ['wf-long', '{}', LONG]);
  await dbRun('BEGIN');
  for (const ymd of localDates(`${YEAR}-01-01`, today)) {
    const [y, m, d] = ymd.split('-').map(Number);
    await workflowRun(LONG, 'wf-long', at(y, m - 1, d, 12), 5);
  }
  await dbRun('COMMIT');
  await call({ user: LONG, ts: at(YEAR, 2, 11, 12) });
  await call({ user: LONG, ts: at(YEAR, 5, 1, 12) });

  const app = express();
  app.use('/wrapped', WrappedRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A person's first year in review fills the dashboard's daily rollup for the
  // year's days, once. Pay that here, under this hook's timeout, rather than
  // inside whichever test happens to ask first.
  for (const user of [USER, OTHER, LONG]) {
    const warm = await get(`/wrapped/${YEAR}`, user);
    if (warm.status !== 200) throw new Error(`warm-up for ${user} answered ${warm.status}`);
  }
}, 120000);

afterAll(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise((r) => server.close(r));
  if (db) await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('yearWindow: whole local days, ending at the start of today', () => {
  it('writes the instant a local day starts the way ts is stored', () => {
    const start = localDayStart(2026, 2, 8);
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(Date.parse(start.replace(' ', 'T') + 'Z')).toBe(new Date(2026, 2, 8).getTime());
  });

  it('mid-year, runs from Jan 1 to the start of today, through yesterday', () => {
    const w = yearWindow(2026, new Date(2026, 10, 13, 15, 30));
    expect(w).toEqual({ since: localDayStart(2026, 0, 1), until: localDayStart(2026, 10, 13), complete: false, from: '2026-01-01', through: '2026-11-12' });
  });

  it('once the year is over, covers every day of it', () => {
    const w = yearWindow(2025, new Date(2026, 0, 10, 8));
    expect(w).toMatchObject({ until: localDayStart(2026, 0, 1), complete: true, through: '2025-12-31' });
  });

  it('on Jan 1 itself, holds no days yet', () => {
    const w = yearWindow(2026, new Date(2026, 0, 1, 9));
    expect(w.until).toBe(w.since);
    expect(w.through).toBe('2025-12-31');
  });
});

describe('GET /wrapped/:year', () => {
  it.each(['abc', '1999', String(new Date().getFullYear() + 1), '2026.5'])('rejects %s with 400', async (year) => {
    const { status, body } = await get(`/wrapped/${year}`);
    expect(status).toBe(400);
    expect(body.error).toMatch(/year must be a whole number/);
  });

  it('counts the ledger for exactly the year: the first and last minute in, a minute either side out', async () => {
    const { status, body } = await get(`/wrapped/${YEAR}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.year).toBe(YEAR);
    expect(body.window).toEqual({ from: `${YEAR}-01-01`, through: `${YEAR}-12-31`, complete: true });
    expect(body.totals.calls).toBe(11);
    expect(body.totals).toHaveProperty('costUsd');
    expect(body.totals).toHaveProperty('unpricedCalls');
    expect(body.totals).toHaveProperty('notionalUsd');
    expect(body.ledger).toEqual({ from: `${YEAR}-01-01` });
  });

  it('counts runs and active days by local day from the execution tables: a run that did no work is a run, not an active day', async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    expect(body.activity.days).toEqual([
      { date: `${YEAR}-01-01`, runs: 1, active: true },
      { date: `${YEAR}-03-10`, runs: 5, active: true },
      { date: `${YEAR}-03-11`, runs: 1, active: false },
      { date: `${YEAR}-06-01`, runs: 1, active: true },
      { date: `${YEAR}-12-31`, runs: 1, active: true },
    ]);
    expect(body.activity.runs).toBe(9);
  });

  it('totals tokens the way the dashboard does: LLM nodes, agent runs, and ledger calls that belong to no run', async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    // 1,000 from the node, 4,000 from agent runs, 10 × 1,100 from ledger calls (the workflow_node one is the node's).
    expect(body.activity.tokens).toBe(16000);
    expect(body.activity.tokensFrom).toBe(`${YEAR}-01-01`);
  });

  it('the streak and active days come from runs, so they reach back before the ledger starts', async () => {
    const { body } = await get(`/wrapped/${YEAR}`, LONG);
    const daysOfYear = localDates(`${YEAR}-01-01`, `${YEAR}-12-31`);
    const daysToToday = localDates(`${YEAR}-01-01`, today);
    expect(body.ledger).toEqual({ from: `${YEAR}-03-11` });
    expect(body.totals.calls).toBe(2);
    expect(body.activity.days).toHaveLength(daysOfYear.length);
    expect(body.activity.days.every((d) => d.active && d.runs === 1)).toBe(true);
    expect(body.activity.days[0].date).toBe(`${YEAR}-01-01`);
    expect(body.activity.runs).toBe(daysOfYear.length);
    // The dashboard's streak: every day since Jan 1 of last year, up to today.
    expect(body.activity.streak).toEqual({ days: daysToToday.length, since: `${YEAR}-01-01`, lastActiveDate: today });
    expect(body.activity.tokens).toBe(2200);
    expect(body.activity.tokensFrom).toBe(`${YEAR}-03-11`);
  });

  it('ranks models and counts providers, conversations and where calls came from', async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    expect(body.models.count).toBe(2);
    expect(body.models.top[0]).toEqual({ name: 'claude-sonnet-4-5-20250929', calls: 8 });
    expect(body.models.top[1]).toEqual({ name: 'gpt-5', calls: 3 });
    expect(body.providers.count).toBe(2);
    expect(body.conversations.count).toBe(2);
    expect(body.origins).toEqual({ chat: 2, orchestrator: 3, workflow_node: 1, goal_task: 4, goal_eval: 1 });
    // Every chat surface (and legacy 'chat') is conversation; workflows and goals running on their own are automation.
    expect(body.split).toEqual({ conversation: 5, automation: 6 });
  });

  it("ranks the person's own live goals, and counts the year's goals that passed evaluation", async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    expect(body.goals.top).toEqual([{ title: 'Morning digest', calls: 2 }, { title: 'Search the site', calls: 1 }]);
    expect(body.goals.created).toBe(2);
    expect(body.goals.validated).toBe(1);
  });

  it('counts what was built by local month: no built-in skills, no deleted items, ISO dates included', async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    const m = (month) => `${YEAR}-${String(month).padStart(2, '0')}`;
    expect(body.built).toEqual({
      skills: { [m(9)]: 1 },
      agents: { [m(8)]: 2 },
      widgets: { [m(5)]: 1 },
      goals: { [m(2)]: 2 },
      workflows: { [m(7)]: 1 },
    });
  });

  it('counts what was learned in the year; a promoted skill also counts as kept', async () => {
    const { body } = await get(`/wrapped/${YEAR}`);
    expect(body.learning).toEqual({ insightsApplied: 2, insightsRejected: 1, skillTrials: 3, skillsKept: 2, skillsPromoted: 1, memories: 2 });
  });

  it('each person gets their own year', async () => {
    const { body } = await get(`/wrapped/${YEAR}`, OTHER);
    expect(body.totals.calls).toBe(1);
    expect(body.goals.top).toEqual([{ title: 'Not yours', calls: 1 }]);
    expect(body.built.agents).toEqual({ [`${YEAR}-08`]: 1 });
    expect(body.built.skills).toEqual({});
    expect(body.learning.insightsApplied).toBe(0);
    expect(body.activity.days).toEqual([{ date: `${YEAR}-06-01`, runs: 1, active: true }]);
    expect(body.activity.runs).toBe(1);
    expect(body.activity.tokens).toBe(1100);
  });

  // Its first ask fills a year of empty rollup days, so it gets room under a loaded run.
  it('a year with no activity answers with zeros, not an error', { timeout: 30000 }, async () => {
    const { status, body } = await get(`/wrapped/${YEAR - 5}`);
    expect(status).toBe(200);
    expect(body.totals.calls).toBe(0);
    expect(body.ledger).toEqual({ from: null });
    expect(body.activity).toEqual({ days: [], runs: 0, tokens: 0, tokensFrom: null, streak: { days: 0, since: null, lastActiveDate: null } });
    expect(body.models).toEqual({ count: 0, top: [] });
    expect(body.goals.top).toEqual([]);
  });
});
