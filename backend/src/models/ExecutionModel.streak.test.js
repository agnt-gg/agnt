/**
 * The streak must be a property of the user's HISTORY, not of any window.
 *
 * The bug this exists to prevent: the dashboard streak was derived on the
 * client from the Cumulative Credits chart's data, which only ever holds the
 * selected range. A real year-long streak therefore displayed as 15 on the
 * default 14-day view — the number silently tracked the dropdown instead of
 * the user. The load-bearing assertion here is the 400-day case: it is longer
 * than the largest range the chart offers (365), so it cannot pass if any
 * window is being applied.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let ExecutionModel;
let db;
let TMP;
const savedEnv = {};

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));

// Days are resolved with SQLite's own localtime clock, the same one the query
// under test groups by — so this can't drift from the implementation on a
// machine in any particular timezone.
const dayOffset = async (n) => {
  const { d } = await dbGet(`SELECT DATE('now', 'localtime', ?) AS d`, [`${n} days`]);
  return d;
};

// Midday keeps the row unambiguously inside its local date for any realistic
// UTC offset, so these fixtures don't flake near midnight.
const at = (ymd) => `${ymd} 12:00:00`;

let seq = 0;
const addWorkflowRun = (userId, ymd, credits = 5) =>
  dbRun(
    `INSERT INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time, credits_used)
     VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
    [`wfe-${++seq}`, 'wf-streak', userId, 'Streak Fixture', at(ymd), credits]
  );

const addAgentRun = (userId, ymd, credits = 3) =>
  dbRun(
    `INSERT INTO agent_executions (id, agent_id, agent_name, user_id, status, start_time, credits_used)
     VALUES (?, NULL, 'Streak Agent', ?, 'completed', ?, ?)`,
    [`age-${++seq}`, userId, at(ymd), credits]
  );

const makeUser = async (id) => {
  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [id, `${id}@test.local`, id]);
  return id;
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-streak-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install and copies in an orphaned database, which on a
  // developer machine means duplicating the real one into the temp directory.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ExecutionModel = (await import('./ExecutionModel.js')).default;

  // workflow_executions carries FKs to workflows and users, and foreign_keys
  // is ON, so both parents must exist before any fixture row is inserted.
  await makeUser('streak-owner');
  await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
    'wf-streak',
    JSON.stringify({ nodes: [], edges: [] }),
    'streak-owner',
  ]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('ExecutionModel.getActivityStreak', () => {
  it('reports a streak far longer than any chart range offers', async () => {
    // 400 consecutive days: longer than the 365-day maximum window, so a
    // window-clamped implementation cannot produce this number.
    const user = await makeUser('streak-400');
    for (let i = 0; i < 400; i++) await addWorkflowRun(user, await dayOffset(-i));

    const { streak, lastActiveDate } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(400);
    expect(lastActiveDate).toBe(await dayOffset(0));
  }, 120000);

  it('stops at the first day with no activity', async () => {
    const user = await makeUser('streak-gap');
    for (const d of [0, 1, 2]) await addWorkflowRun(user, await dayOffset(-d));
    // day -3 deliberately empty
    for (const d of [4, 5, 6, 7]) await addWorkflowRun(user, await dayOffset(-d));

    const { streak } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(3);
  });

  it('keeps a streak alive on a day that has not been worked in yet', async () => {
    // Today is unfinished, not broken: anchoring on yesterday is what stops a
    // live streak from reading 0 every morning.
    const user = await makeUser('streak-yesterday');
    for (const d of [1, 2, 3, 4, 5]) await addWorkflowRun(user, await dayOffset(-d));

    const { streak, lastActiveDate } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(5);
    expect(lastActiveDate).toBe(await dayOffset(-1));
  });

  it('counts agent runs, not just workflow runs', async () => {
    const user = await makeUser('streak-agent');
    await addAgentRun(user, await dayOffset(0));
    await addWorkflowRun(user, await dayOffset(-1));
    await addAgentRun(user, await dayOffset(-2));

    const { streak } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(3);
  });

  it('counts a day once even when it holds many runs', async () => {
    const user = await makeUser('streak-multi');
    for (const d of [0, 1]) {
      await addWorkflowRun(user, await dayOffset(-d));
      await addWorkflowRun(user, await dayOffset(-d));
      await addAgentRun(user, await dayOffset(-d));
    }

    const { streak } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(2);
  });

  it('does not count a day whose runs burned no credits', async () => {
    const user = await makeUser('streak-zero');
    await addWorkflowRun(user, await dayOffset(0), 0);
    await addWorkflowRun(user, await dayOffset(-1), 0);

    const { streak, lastActiveDate } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(0);
    expect(lastActiveDate).toBeNull();
  });

  it('returns zero for a user with no history at all', async () => {
    const user = await makeUser('streak-empty');
    const { streak, lastActiveDate } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(0);
    expect(lastActiveDate).toBeNull();
  });

  it('ignores a stale streak that ended before yesterday', async () => {
    const user = await makeUser('streak-stale');
    for (const d of [10, 11, 12, 13]) await addWorkflowRun(user, await dayOffset(-d));

    const { streak } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(0);
  });

  it('never counts another user\'s activity', async () => {
    const mine = await makeUser('streak-mine');
    const theirs = await makeUser('streak-theirs');
    await addWorkflowRun(mine, await dayOffset(0));
    for (let i = 0; i < 30; i++) await addWorkflowRun(theirs, await dayOffset(-i));

    const { streak } = await ExecutionModel.getActivityStreak(mine);
    expect(streak).toBe(1);
  });

  it('walks across chunk boundaries without dropping or double-counting a day', async () => {
    // 181 days: one past the 180-day chunk, so the second chunk load is
    // exercised and its seam is asserted exactly.
    const user = await makeUser('streak-seam');
    for (let i = 0; i < 181; i++) await addWorkflowRun(user, await dayOffset(-i));

    const { streak } = await ExecutionModel.getActivityStreak(user);
    expect(streak).toBe(181);
  }, 60000);
});
