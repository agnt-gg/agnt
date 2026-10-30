// A failed grade inside the autonomous loop must not flag a still-running
// goal for review: the loop re-plans, and sets needs_review itself when it
// stops. Regression: the goal read needs_review while loop_status said it was
// executing/replanning. Outside the loop, a failed grade still flags review.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./database/index.js', async () => {
  const sqlite3 = (await import('sqlite3')).default;
  return { default: new sqlite3.Database(':memory:') };
});

const { default: db } = await import('./database/index.js');
const { commitGoalEvaluation } = await import('./GoalEvaluationCommit.js');

const exec = (sql) => new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
const statusOf = () => new Promise((resolve, reject) => db.get("SELECT status FROM goals WHERE id='g'", (err, row) => (err ? reject(err) : resolve(row.status))));

const commit = (passed, extra = {}) => commitGoalEvaluation({
  goal: { id: 'g', lifecycle_revision: 0 },
  userId: 'u',
  evaluationType: 'automatic',
  scores: { overall: passed ? 90 : 40 },
  passed,
  evaluationData: {},
  feedback: 'fixture',
  tokenUsage: null,
  taskEvaluations: [{ taskId: 't', criteriaMet: { ok: passed }, score: passed ? 90 : 40, feedback: 'fixture' }],
  ...extra,
});

beforeEach(async () => {
  await exec(`
    DROP TABLE IF EXISTS goals; DROP TABLE IF EXISTS goal_lifecycle_versions; DROP TABLE IF EXISTS goal_evaluations; DROP TABLE IF EXISTS task_evaluations;
    CREATE TABLE goals (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, deleted_at TEXT, updated_at TEXT, completed_at TEXT);
    CREATE TABLE goal_lifecycle_versions (kind TEXT, entity_id TEXT, revision INTEGER);
    CREATE TABLE goal_evaluations (id TEXT, goal_id TEXT, evaluation_type TEXT, overall_score REAL, passed INTEGER, evaluation_data TEXT, feedback TEXT, evaluated_by TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, estimated_cost REAL);
    CREATE TABLE task_evaluations (id TEXT, task_id TEXT, goal_evaluation_id TEXT, criteria_met TEXT, score REAL, feedback TEXT);
    INSERT INTO goals (id, user_id, status) VALUES ('g', 'u', 'executing');
  `);
});

describe('evaluation commit status', () => {
  it('Given a failed grade inside the loop, Then the goal keeps reading as running', async () => {
    expect((await commit(false, { keepStatusOnFail: true })).status).toBe('executing');
    expect(await statusOf()).toBe('executing');
  });
  it('Given a passing grade inside the loop, Then the goal is validated', async () => {
    expect((await commit(true, { keepStatusOnFail: true })).status).toBe('validated');
    expect(await statusOf()).toBe('validated');
  });
  it('Given a failed grade outside the loop, Then the goal is flagged for review as before', async () => {
    expect((await commit(false)).status).toBe('needs_review');
    expect(await statusOf()).toBe('needs_review');
  });
  it('Given the goal was paused meanwhile, Then nothing is committed', async () => {
    await exec("UPDATE goals SET status='paused'");
    await expect(commit(false, { keepStatusOnFail: true })).rejects.toMatchObject({ code: 'STALE_GOAL_EVALUATION' });
    expect(await statusOf()).toBe('paused');
  });
});
