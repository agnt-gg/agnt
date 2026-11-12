import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { initializeGoalObjectives } from './database/goalObjectives.js';
import { GoalObjectiveModel } from './GoalObjectiveModel.js';

let db, model;
const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (error) => (error ? reject(error) : resolve())));
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row))));
const goal = (id, user, status = 'planning', extra = {}) => run('INSERT INTO goals(id,user_id,status,deleted_at) VALUES(?,?,?,?)', [id, user, status, extra.deleted ? 'now' : null]);

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT,deleted_at TEXT)');
  await initializeGoalObjectives(db);
  await initializeGoalObjectives(db); // idempotent
  model = new GoalObjectiveModel(db);
});
afterEach(() => new Promise((resolve) => db.close(() => resolve())));

describe('objectives', () => {
  it('counts the live goals that serve each objective, and how many are done', async () => {
    const signups = await model.create('ann', { title: 'Grow sign-ups 20%', target: '+20%', current: '+12%' });
    for (const [id, status, extra] of [['g1', 'completed'], ['g2', 'validated'], ['g3', 'executing'], ['g4', 'completed', { deleted: true }]]) {
      await goal(id, 'ann', status, extra);
      await model.link('ann', id, signups.id);
    }
    await goal('b1', 'ben', 'completed');
    await run('UPDATE goals SET objective_id=? WHERE id=?', [signups.id, 'b1']);
    expect(await model.list('ann')).toEqual([expect.objectContaining({ title: 'Grow sign-ups 20%', target: '+20%', current: '+12%', goals: 3, done: 2 })]);
    expect(await model.list('ben')).toEqual([]);
  });

  it('validates input and edits in place', async () => {
    await expect(model.create('ann', {})).rejects.toMatchObject({ status: 400 });
    await expect(model.create('ann', { title: 'x'.repeat(121) })).rejects.toMatchObject({ status: 400 });
    await expect(model.create('ann', { title: 'Ok', target: 42 })).rejects.toMatchObject({ status: 400 });
    const mine = await model.create('ann', { title: '  Close books in 3 days  ' });
    expect(mine).toMatchObject({ title: 'Close books in 3 days', target: '', current: '' });
    await expect(model.update('ben', mine.id, { title: 'stolen' })).rejects.toMatchObject({ status: 404 });
    await expect(model.update('ann', mine.id, { title: '' })).rejects.toMatchObject({ status: 400 });
    expect(await model.update('ann', mine.id, { current: '4 days' })).toMatchObject({ title: 'Close books in 3 days', current: '4 days' });
  });

  it('retiring an objective unlinks its goals, and nothing can link to it afterwards', async () => {
    const objective = await model.create('ann', { title: 'Answer support in 1 hour' });
    await goal('g1', 'ann');
    await model.link('ann', 'g1', objective.id);
    await goal('b1', 'ben');
    await run('UPDATE goals SET objective_id=? WHERE id=?', [objective.id, 'b1']);
    await expect(model.archive('ben', objective.id)).rejects.toMatchObject({ status: 404 });
    await model.archive('ann', objective.id);
    expect(await get('SELECT objective_id FROM goals WHERE id=?', ['g1'])).toEqual({ objective_id: null });
    expect(await get('SELECT objective_id FROM goals WHERE id=?', ['b1'])).toEqual({ objective_id: objective.id });
    await expect(model.link('ann', 'g1', objective.id)).rejects.toMatchObject({ status: 404 });
    expect(await model.list('ann')).toEqual([]);
  });

  it('links and unlinks a goal', async () => {
    const objective = await model.create('ann', { title: 'O' });
    await goal('g1', 'ann');
    expect(await model.link('ann', 'g1', objective.id)).toEqual({ goalId: 'g1', objectiveId: objective.id });
    expect(await model.link('ann', 'g1', null)).toEqual({ goalId: 'g1', objectiveId: null });
    await goal('b1', 'ben');
    await expect(model.link('ann', 'b1', objective.id)).rejects.toMatchObject({ status: 404, message: 'Goal not found' });
    await expect(model.link('ann', 'g1', 7)).rejects.toMatchObject({ status: 400 });
  });
});
