// #95: fire-now awaited the target's whole run (a goal can take minutes), so
// HTTP clients timed out while the run went on, and the response had no id to
// poll. Runs also recorded 'completed' when the goal reported its own failure.
// Real (per-run temporary) database: covers the run-row SQL and the
// duration_ms migration, with a controllable fake executor as the target.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';

// Schedules are a paid feature (SchedulerService refuses them without a paid
// plan); these tests are about firing, so the owner has a paid licence.
vi.mock('../auth/licence.js', async (original) => ({ ...(await original()), verifiedPlan: async () => 'personal' }));
import db, { dbReady } from '../../models/database/index.js';
import ScheduleModel from '../../models/ScheduleModel.js';
import SchedulerService from './SchedulerService.js';

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => (err ? reject(err) : resolve(row))));
const runRow = (id) => get('SELECT * FROM schedule_runs WHERE id = ?', [id]);

// A target type of our own, so the default goal executor is never touched.
const TARGET = 'fire-now-fixture';
let finishRun; // resolves the in-flight fake run with its result
let user;
const deferredExecutor = () => new Promise((resolve, reject) => { finishRun = { resolve, reject }; });

const newSchedule = async () => {
  const id = await ScheduleModel.create({ userId: user, targetType: TARGET, targetId: 'goal-fixture', cron: '0 9 * * *', timezone: 'UTC', nextRun: null, enabled: true, onMissed: 'skip' });
  return ScheduleModel.findOne(id);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(async () => {
  await dbReady;
  user = randomUUID();
  await run('INSERT INTO users (id, email) VALUES (?, ?)', [user, `${user}@test.local`]);
  SchedulerService.registerExecutor(TARGET, deferredExecutor);
});
afterEach(() => finishRun?.resolve({ status: 'completed' }));

describe('fireNow', () => {
  it('Given a target that is still running Then it answers at once with a running run id', async () => {
    const schedule = await newSchedule();
    const result = await SchedulerService.fireNow(schedule.id);
    expect(result).toMatchObject({ fired: true, scheduleId: schedule.id, status: 'running' });
    expect(result.runId).toEqual(expect.any(String));
    expect(await runRow(result.runId)).toMatchObject({ status: 'running', schedule_id: schedule.id, duration_ms: null });
  });

  it('Given the run finishes Then the row records completed, the goal and how long it took', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'completed' });
    await settle();
    const row = await runRow(runId);
    expect(row).toMatchObject({ status: 'completed', error: null, run_target_id: 'goal-fixture' });
    expect(row.duration_ms).toEqual(expect.any(Number));
    expect(await ScheduleModel.findOne(schedule.id)).toMatchObject({ last_status: 'completed', last_error: null });
  });

  it('Given the goal reports its own error Then the run is failed, not completed', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'error', error: 'planner unreachable' });
    await settle();
    expect(await runRow(runId)).toMatchObject({ status: 'failed', error: 'planner unreachable' });
    expect(await ScheduleModel.findOne(schedule.id)).toMatchObject({ last_status: 'failed', last_error: 'planner unreachable' });
  });

  it('Given the goal ends needing review Then that outcome is recorded as is', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'needs_review', reason: 'evaluation_failed' });
    await settle();
    expect(await runRow(runId)).toMatchObject({ status: 'needs_review', error: 'evaluation_failed' });
  });

  it('Given the executor throws Then the run is failed with the message and nothing is unhandled', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.reject(new Error('executor exploded'));
    await settle();
    expect(await runRow(runId)).toMatchObject({ status: 'failed', error: 'executor exploded' });
  });

  it('Given an invalid cron Then it does not fire and says why', async () => {
    const schedule = await newSchedule();
    await run('UPDATE schedules SET cron = ? WHERE id = ?', ['not a cron', schedule.id]);
    const result = await SchedulerService.fireNow(schedule.id);
    expect(result).toMatchObject({ fired: false, scheduleId: schedule.id });
    expect(result.reason).toMatch(/Invalid cron/);
  });
});

describe('heartbeat path', () => {
  it('Given a due schedule Then _fireOne still waits for the run to finish', async () => {
    const schedule = await newSchedule();
    let done = false;
    const firing = SchedulerService._fireOne(schedule, new Date()).then(() => { done = true; });
    await settle();
    expect(done).toBe(false);
    finishRun.resolve({ status: 'completed' });
    await firing;
    expect(done).toBe(true);
  });
});

describe('restart', () => {
  it("Given runs left 'running' by a previous process Then they are marked interrupted", async () => {
    const schedule = await newSchedule();
    const runId = await ScheduleModel.startRun({ scheduleId: schedule.id, targetType: TARGET, targetId: 'goal-fixture' });
    expect(await ScheduleModel.markInterruptedRuns()).toBeGreaterThanOrEqual(1);
    expect(await runRow(runId)).toMatchObject({ status: 'interrupted' });
  });
});

// 2026-10-21: a deleted goal's schedule kept firing (and failing) every week.
describe('a target that is gone', () => {
  it('Given the executor says the target is gone Then the run fails and the schedule is switched off', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'error', reason: 'goal_missing', error: 'The goal this routine runs no longer exists.', disableSchedule: true });
    await settle();
    expect(await runRow(runId)).toMatchObject({ status: 'failed', error: 'The goal this routine runs no longer exists.' });
    expect((await ScheduleModel.findOne(schedule.id)).enabled).toBeFalsy();
  });
});

// Every run of a routine starts from pending tasks, keeping what each task is.
describe('TaskModel.resetForNewRun', () => {
  it('Given finished tasks Then they are pending again with no output, error or times, and only that goal is touched', async () => {
    const { default: TaskModel } = await import('../../models/TaskModel.js');
    const { default: GoalModel } = await import('../../models/GoalModel.js');
    const goalId = await GoalModel.create('Daily digest', 'Email me the news', user, 'low', {});
    const other = await GoalModel.create('Other', 'x', user, 'low', {});
    const done = await TaskModel.create(goalId, 'Research', 'Find the news', ['web_search'], [], 1);
    const failed = await TaskModel.create(goalId, 'Send', 'Email it', [], [], 2);
    const untouched = await TaskModel.create(other, 'Keep', 'x');
    await TaskModel.updateStatus(done, 'completed', 100, null, null, null, { content: 'old news' });
    await TaskModel.updateStatus(failed, 'failed', 40, null, null, null, null, 'smtp down');
    await TaskModel.updateStatus(untouched, 'completed', 100);
    expect(await TaskModel.resetForNewRun(goalId)).toBe(2);
    const rows = await TaskModel.findByGoalId(goalId);
    expect(rows.map((t) => [t.title, t.status, t.progress, t.output, t.error, t.started_at, t.completed_at, t.order_index])).toEqual([
      ['Research', 'pending', 0, null, null, null, null, 1],
      ['Send', 'pending', 0, null, null, null, null, 2],
    ]);
    const tools = rows[0].required_tools;
    expect(typeof tools === 'string' ? JSON.parse(tools) : tools).toEqual(['web_search']);
    expect((await TaskModel.findByGoalId(other))[0].status).toBe('completed');
  });
});

describe('what a run produced', () => {
  const OUTPUT = { tasks: [{ title: 'Search', status: 'completed', error: null, content: 'Found 12 stories.', truncated: false, files: [] }] };

  it('Given the target reports its output Then the run keeps it, the history lists it without the body, and the run returns it', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'completed', runOutput: OUTPUT });
    await settle();
    const [listed] = await ScheduleModel.findRunHistory(schedule.id);
    expect(listed).toMatchObject({ id: runId, status: 'completed', has_output: 1 });
    expect(listed).not.toHaveProperty('output');
    expect((await ScheduleModel.findRun(schedule.id, runId)).output).toEqual(OUTPUT);
    expect(await ScheduleModel.findRun('another-schedule', runId)).toBeNull();
  });

  it('Given a target that reports nothing Then the run has no output', async () => {
    const schedule = await newSchedule();
    const { runId } = await SchedulerService.fireNow(schedule.id);
    finishRun.resolve({ goalId: 'goal-fixture', status: 'completed' });
    await settle();
    expect((await ScheduleModel.findRunHistory(schedule.id))[0].has_output).toBe(0);
    expect((await ScheduleModel.findRun(schedule.id, runId)).output).toBeNull();
  });

  it('Given more runs than are kept Then only the newest keep their output, and every run stays listed', async () => {
    const schedule = await newSchedule();
    const runIds = [];
    for (let i = 0; i < 4; i++) {
      const runId = await ScheduleModel.startRun({ scheduleId: schedule.id, targetType: TARGET, targetId: 'goal-fixture' });
      await run("UPDATE schedule_runs SET fired_at = datetime('now', ?) WHERE id = ?", [`-${10 - i} minutes`, runId]);
      await ScheduleModel.finishRun(runId, { status: 'completed', output: OUTPUT });
      runIds.push(runId);
    }
    await ScheduleModel.pruneRunOutputs(runIds[3], 2);
    const history = await ScheduleModel.findRunHistory(schedule.id);
    expect(history.map((r) => [r.id, r.has_output])).toEqual([[runIds[3], 1], [runIds[2], 1], [runIds[1], 0], [runIds[0], 0]]);
  });
});
