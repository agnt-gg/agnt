/**
 * tenant_due_work against the REAL schema: createTables + migrations + the boot
 * chain, in a throwaway AGNT_HOME. This view is what the fleet reads to decide
 * whether to wake or keep a hosted instance, so a wrong row here is a missed
 * run or a tenant that never sleeps.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

let db;
let TMP;
let refreshDueWorkView;
let TriggerWakeModel;
const savedEnv = {};

const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const rowsFor = async (source) => all('SELECT * FROM tenant_due_work WHERE source = ? ORDER BY ref', [source]);

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-duework-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  ({ refreshDueWorkView } = await import('./dueWorkView.js'));
  TriggerWakeModel = (await import('./TriggerWakeModel.js')).default;

  await run("INSERT OR IGNORE INTO users (id, email, name) VALUES ('u1', 'u1@test.local', 'u1')");
  for (const [id, status] of [['wf-on', 'listening'], ['wf-off', 'stopped']]) {
    await run('INSERT INTO workflows (id, workflow_data, user_id, status) VALUES (?, ?, ?, ?)', [id, '{"nodes":[],"edges":[]}', 'u1', status]);
  }
}, 120000);

afterAll(async () => {
  await new Promise((res) => db.close(() => res()));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('boot', () => {
  it('builds the view', async () => {
    const [view] = await all("SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'tenant_due_work'");
    expect(view).toBeTruthy();
  });

  it('is safe to rebuild any number of times', async () => {
    await refreshDueWorkView(db);
    await refreshDueWorkView(db);
    await expect(all('SELECT COUNT(*) AS n FROM tenant_due_work')).resolves.toBeTruthy();
  });
});

describe('triggers', () => {
  it('lists a listening workflow\'s next fire time in epoch seconds', async () => {
    const at = Date.UTC(2026, 8, 30, 12, 0, 0);
    await TriggerWakeModel.upsert({ workflowId: 'wf-on', nodeId: 'n1', triggerType: 'trigger-timer', nextFireAt: at, anchorAt: at, scheduleKey: 'k' });
    const [row] = await rowsFor('trigger');
    expect(row).toMatchObject({ ref: 'wf-on:n1', kind: 'due', due_at: at / 1000 });
  });

  it('ignores a stopped workflow\'s leftover row', async () => {
    await TriggerWakeModel.upsert({ workflowId: 'wf-off', nodeId: 'n1', triggerType: 'trigger-timer', nextFireAt: 1, anchorAt: 1, scheduleKey: 'k' });
    expect((await rowsFor('trigger')).map((r) => r.ref)).toEqual(['wf-on:n1']);
  });

  it('upsert replaces, and deleteForWorkflow removes', async () => {
    await TriggerWakeModel.upsert({ workflowId: 'wf-on', nodeId: 'n1', triggerType: 'trigger-timer', nextFireAt: 2000, anchorAt: 1, scheduleKey: 'k' });
    expect((await TriggerWakeModel.get('wf-on', 'n1')).next_fire_at).toBe(2000);
    expect(await TriggerWakeModel.deleteForWorkflow('wf-on')).toBe(1);
    expect(await TriggerWakeModel.get('wf-on', 'n1')).toBeNull();
  });
});

describe('schedules, goals, tasks, runs', () => {
  it('reads both datetime formats the app writes', async () => {
    await run("INSERT INTO schedules (id, user_id, target_type, target_id, cron, next_run) VALUES ('s-iso', 'u1', 'goal', 'g', '* * * * *', '2026-09-30T12:00:00.000Z')");
    await run("INSERT INTO schedules (id, user_id, target_type, target_id, cron, next_run) VALUES ('s-sql', 'u1', 'goal', 'g', '* * * * *', '2026-09-30 12:00:00')");
    await run("INSERT INTO schedules (id, user_id, target_type, target_id, cron, next_run, enabled) VALUES ('s-off', 'u1', 'goal', 'g', '* * * * *', '2026-09-30 12:00:00', 0)");
    const rows = await rowsFor('schedule');
    expect(rows.map((r) => r.ref)).toEqual(['s-iso', 's-sql']);
    for (const r of rows) expect(r).toMatchObject({ kind: 'due', due_at: Date.UTC(2026, 8, 30, 12) / 1000 });
  });

  it('marks an executing goal resumable', async () => {
    await run("INSERT INTO goals (id, user_id, title, description, status) VALUES ('g-run', 'u1', 't', 'd', 'executing')");
    await run("INSERT INTO goals (id, user_id, title, description, status) VALUES ('g-done', 'u1', 't', 'd', 'completed')");
    expect(await rowsFor('goal')).toEqual([expect.objectContaining({ ref: 'g-run', kind: 'resumable' })]);
  });

  it('marks a recent open workflow run in flight, and not an old one', async () => {
    await run("INSERT INTO workflow_executions (id, workflow_id, user_id, status, start_time) VALUES ('r-new', 'wf-on', 'u1', 'started', datetime('now', '-5 minutes'))");
    await run("INSERT INTO workflow_executions (id, workflow_id, user_id, status, start_time) VALUES ('r-old', 'wf-on', 'u1', 'started', datetime('now', '-3 hours'))");
    await run("INSERT INTO workflow_executions (id, workflow_id, user_id, status, start_time, end_time) VALUES ('r-done', 'wf-on', 'u1', 'completed', datetime('now'), datetime('now'))");
    expect(await rowsFor('workflow_run')).toEqual([expect.objectContaining({ ref: 'r-new', kind: 'in_flight' })]);
  });
});

describe('optional tables', () => {
  it('picks up conversation_work once it exists', async () => {
    expect(await rowsFor('conversation')).toEqual([]);
    await run(`CREATE TABLE IF NOT EXISTS conversation_work (id TEXT PRIMARY KEY, status TEXT, next_wake INTEGER)`);
    await run("INSERT INTO conversation_work (id, status, next_wake) VALUES ('c-wait', 'retry_wait', 1790000000000)");
    await refreshDueWorkView(db);
    expect(await rowsFor('conversation')).toEqual([expect.objectContaining({ ref: 'c-wait', kind: 'due', due_at: 1790000000 })]);
  });
});
