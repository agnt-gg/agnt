/**
 * A routine (scheduled goal) runs its plan every time. Re-planning inside a
 * run rewrites task titles and descriptions; before task plans existed those
 * rewrites became the routine's tasks for every later run, until a daily
 * digest's tasks read "SKIP (no-op)" and did nothing at all.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import db, { dbReady } from './database/index.js';
import TaskModel from './TaskModel.js';
import generateUUID from '../utils/generateUUID.js';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); }));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

let userId;
const createdGoals = [];

async function makeGoal() {
  const goalId = generateUUID();
  await run(`INSERT INTO goals (id, user_id, title, description, status) VALUES (?, ?, ?, ?, ?)`, [goalId, userId, 'plan test', 'plan test', 'planning']);
  createdGoals.push(goalId);
  return goalId;
}

/** What the re-planner does to a task mid-run. */
const replan = (taskId, title, description) =>
  run(`UPDATE tasks SET title = ?, description = ?, status = 'failed', output = '{"x":1}', error = 'Did not pass' WHERE id = ?`, [title, description, taskId]);

/** A task as an older install left it: no plan recorded. */
const forgetPlan = (taskId) => run(`UPDATE tasks SET plan_title = NULL, plan_description = NULL WHERE id = ?`, [taskId]);

const row = (taskId) => get(`SELECT title, description, plan_title, plan_description, status, output, error FROM tasks WHERE id = ?`, [taskId]);

beforeAll(async () => {
  await dbReady;
  userId = generateUUID();
  await run(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`, [userId, `plan-${userId}@test.local`, 'plan test']);
});

afterEach(async () => {
  for (const goalId of createdGoals.splice(0)) {
    await run(`DELETE FROM tasks WHERE goal_id = ?`, [goalId]);
    await run(`DELETE FROM goals WHERE id = ?`, [goalId]);
  }
});

describe('a task plan', () => {
  it('Given a new task, Then its plan is what it was created as', async () => {
    const taskId = await TaskModel.create(await makeGoal(), 'Search for AI news', 'Find 15 stories');
    expect(await row(taskId)).toMatchObject({ plan_title: 'Search for AI news', plan_description: 'Find 15 stories' });
  });

  it('Given a run re-planned a task, Then the next run starts from the plan, not the rewrite', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'Search for AI news', 'Find 15 stories');
    await replan(taskId, 'SKIP (no-op)', 'Make no tool calls.');

    expect(await TaskModel.resetForNewRun(goalId)).toBe(1);
    expect(await row(taskId)).toEqual({
      title: 'Search for AI news', description: 'Find 15 stories',
      plan_title: 'Search for AI news', plan_description: 'Find 15 stories',
      status: 'pending', output: null, error: null,
    });
  });

  it('Given a task with no plan, Then its earliest recorded definition becomes the plan', async () => {
    const goalId = await makeGoal();
    const recordedId = await TaskModel.create(goalId, 'Search for AI news', 'Find 15 stories');
    const newerId = await TaskModel.create(goalId, 'Send the digest', 'Email it');
    await replan(recordedId, 'OPERATOR ACTION REQUIRED', 'Output BLOCKER.');
    await forgetPlan(recordedId);
    await forgetPlan(newerId);

    const loaded = [];
    const recorded = await TaskModel.recordPlan(goalId, async () => {
      loaded.push(goalId);
      return [{ id: recordedId, title: 'Search for AI news', description: 'Find 15 stories' }, { id: 'gone', title: 'Deleted task' }];
    });

    expect(recorded).toBe(2);
    expect(loaded).toHaveLength(1);
    expect(await row(recordedId)).toMatchObject({ plan_title: 'Search for AI news', plan_description: 'Find 15 stories' });
    // Not in the history: its own definition is the plan.
    expect(await row(newerId)).toMatchObject({ plan_title: 'Send the digest', plan_description: 'Email it' });

    await TaskModel.resetForNewRun(goalId);
    expect(await row(recordedId)).toMatchObject({ title: 'Search for AI news', description: 'Find 15 stories' });
  });

  it('Given every task has a plan, Then nothing is loaded and no plan changes', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'Rank the stories', 'Top 5-10');
    await replan(taskId, 'Rank v2', 'Rewritten');
    const recorded = await TaskModel.recordPlan(goalId, async () => { throw new Error('history must not be read'); });
    expect(recorded).toBe(0);
    expect(await row(taskId)).toMatchObject({ plan_title: 'Rank the stories', plan_description: 'Top 5-10' });
  });

  it('Given a task with no plan and no history, Then a new run keeps it and records it as the plan', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'Imported task', null);
    await forgetPlan(taskId);
    await TaskModel.resetForNewRun(goalId);
    expect(await row(taskId)).toMatchObject({ title: 'Imported task', description: null, plan_title: 'Imported task', plan_description: null, status: 'pending' });
  });

  it('Given a planned task with no description, Then a rewrite gains none on the next run', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'Untitled step', null);
    await replan(taskId, 'Untitled step', 'A re-planned description');
    await TaskModel.resetForNewRun(goalId);
    expect(await row(taskId)).toMatchObject({ title: 'Untitled step', description: null });
  });
});
