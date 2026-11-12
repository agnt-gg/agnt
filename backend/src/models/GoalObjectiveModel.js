import { randomUUID } from 'node:crypto';

const MAX_TITLE = 120;
const MAX_TEXT = 120;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

function text(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(400, `An objective needs a ${label}`);
    return '';
  }
  if (typeof value !== 'string') fail(400, `Invalid ${label}`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(400, `An objective needs a ${label}`);
  if (trimmed.length > max) fail(400, `The ${label} is too long (${max} characters at most)`);
  return trimmed;
}

const row = (r) => ({
  id: r.id, title: r.title, target: r.target, current: r.current,
  goals: r.goal_count || 0, done: r.done_count || 0, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** A person's objectives: a few outcomes their goals serve, each with a target and where it stands now (both in their own words). */
export class GoalObjectiveModel {
  constructor(db) {
    this.db = db;
  }

  run(sql, args = []) { return new Promise((resolve, reject) => this.db.run(sql, args, function done(error) { if (error) reject(error); else resolve(this); })); }
  get(sql, args = []) { return new Promise((resolve, reject) => this.db.get(sql, args, (error, result) => (error ? reject(error) : resolve(result)))); }
  all(sql, args = []) { return new Promise((resolve, reject) => this.db.all(sql, args, (error, result) => (error ? reject(error) : resolve(result)))); }

  /** Live objectives, oldest first, each with how many goals serve it and how many of those are done. */
  async list(userId) {
    const rows = await this.all(`SELECT o.*,
        (SELECT COUNT(*) FROM goals g WHERE g.objective_id=o.id AND g.user_id=o.user_id AND g.deleted_at IS NULL) AS goal_count,
        (SELECT COUNT(*) FROM goals g WHERE g.objective_id=o.id AND g.user_id=o.user_id AND g.deleted_at IS NULL AND g.status IN ('completed','validated')) AS done_count
      FROM goal_objectives o WHERE o.user_id=? AND o.archived_at IS NULL ORDER BY o.created_at, o.id LIMIT 50`, [userId]);
    return rows.map(row);
  }

  async owned(userId, id) {
    const found = await this.get('SELECT * FROM goal_objectives WHERE id=? AND user_id=? AND archived_at IS NULL', [id, userId]);
    if (!found) fail(404, 'Objective not found');
    return found;
  }

  async create(userId, input = {}) {
    const title = text(input.title, MAX_TITLE, 'title', { required: true });
    const target = text(input.target, MAX_TEXT, 'target');
    const current = text(input.current, MAX_TEXT, 'current value');
    const id = randomUUID();
    const at = new Date().toISOString();
    await this.run('INSERT INTO goal_objectives(id,user_id,title,target,current,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id, userId, title, target, current, at, at]);
    return (await this.list(userId)).find((o) => o.id === id);
  }

  async update(userId, id, input = {}) {
    const existing = await this.owned(userId, id);
    const title = input.title === undefined ? existing.title : text(input.title, MAX_TITLE, 'title', { required: true });
    const target = input.target === undefined ? existing.target : text(input.target, MAX_TEXT, 'target');
    const current = input.current === undefined ? existing.current : text(input.current, MAX_TEXT, 'current value');
    await this.run('UPDATE goal_objectives SET title=?,target=?,current=?,updated_at=? WHERE id=? AND user_id=?', [title, target, current, new Date().toISOString(), id, userId]);
    return (await this.list(userId)).find((o) => o.id === id);
  }

  /** Retire an objective. Its goals stay; they simply no longer serve it. */
  async archive(userId, id) {
    await this.owned(userId, id);
    await this.run('UPDATE goal_objectives SET archived_at=? WHERE id=? AND user_id=?', [new Date().toISOString(), id, userId]);
    await this.run('UPDATE goals SET objective_id=NULL WHERE objective_id=? AND user_id=?', [id, userId]);
    return { success: true };
  }

  /** Link a goal to an objective, or unlink it with null. */
  async link(userId, goalId, objectiveId) {
    if (objectiveId !== null && objectiveId !== undefined && objectiveId !== '') {
      if (typeof objectiveId !== 'string') fail(400, 'Invalid objective');
      await this.owned(userId, objectiveId);
    }
    const result = await this.run('UPDATE goals SET objective_id=? WHERE id=? AND user_id=?', [objectiveId || null, goalId, userId]);
    if (!result.changes) fail(404, 'Goal not found');
    return { goalId, objectiveId: objectiveId || null };
  }
}
