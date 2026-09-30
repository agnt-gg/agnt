import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import db, { dbReady } from './database/index.js';
import UserModel, { NODE_STATS_SQL } from './UserModel.js';

/**
 * getUserStats used to aggregate every node execution a user ever ran on each
 * call (1,115 MB read per call on a real install, polled every 60 s). It now
 * keeps a per-user rowid watermark. These tests hold the incremental count to
 * the ORIGINAL query as an oracle through everything that can move it: appended
 * rows, nodes that finish after being counted, a node re-run in a loop
 * rewriting earlier rows of its run, other users' rows, crashed runs,
 * deletions and concurrent callers.
 *
 * Runs against the isolated test database (tests/setup/isolate-data-dir.mjs).
 */

const USER = 'user-node-stats';
const OTHER = 'user-node-stats-other';
const WORKFLOW = 'wf-node-stats';

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

// The query getUserStats ran before this change, verbatim in meaning.
async function oracle(userId) {
  const row = await get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(ne.status = 'completed'), 0) AS completed, COALESCE(SUM(ne.status = 'error'), 0) AS error
       FROM node_executions ne JOIN workflow_executions e ON ne.execution_id = e.id WHERE e.user_id = ?`,
    [userId],
  );
  return { totalNodeExecutions: row.total, successfulNodeExecutions: row.completed, failedNodeExecutions: row.error };
}

async function statsFor(userId) {
  const stats = await UserModel.getUserStats(userId);
  return {
    totalNodeExecutions: stats.totalNodeExecutions,
    successfulNodeExecutions: stats.successfulNodeExecutions,
    failedNodeExecutions: stats.failedNodeExecutions,
  };
}

const expectMatchesOracle = async (userId = USER) => expect(await statsFor(userId)).toEqual(await oracle(userId));

let sequence = 0;
async function startRun(userId, { startedAt = new Date() } = {}) {
  const id = `run-${++sequence}`;
  await run(`INSERT INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time) VALUES (?, ?, ?, 'stats', 'started', ?)`, [
    id, WORKFLOW, userId, startedAt.toISOString(),
  ]);
  return id;
}
const finishRun = (runId, status = 'completed') =>
  run(`UPDATE workflow_executions SET status = ?, end_time = ? WHERE id = ?`, [status, new Date().toISOString(), runId]);
const startNode = (runId, nodeId) =>
  run(`INSERT INTO node_executions (id, execution_id, node_id, status, start_time) VALUES (?, ?, ?, 'started', ?)`, [
    `${runId}:${nodeId}:${++sequence}`, runId, nodeId, new Date().toISOString(),
  ]);
// Exactly how ExecutionModel.updateNodeExecution writes: by (execution_id, node_id), so every row of a looped node.
const finishNode = (runId, nodeId, status) => run(`UPDATE node_executions SET status = ? WHERE execution_id = ? AND node_id = ?`, [status, runId, nodeId]);

beforeAll(async () => {
  await dbReady;
  for (const id of [USER, OTHER]) await run(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`, [id, `${id}@test.local`, id]);
  await run(`INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, '{}', ?)`, [WORKFLOW, USER]);
});

beforeEach(async () => {
  await run(`DELETE FROM node_executions WHERE execution_id IN (SELECT id FROM workflow_executions WHERE workflow_id = ?)`, [WORKFLOW]);
  await run(`DELETE FROM workflow_executions WHERE workflow_id = ?`, [WORKFLOW]);
  UserModel.invalidateNodeStats();
});

describe('incremental node-execution stats', () => {
  it('match the original full aggregate through the whole life of runs', async () => {
    await expectMatchesOracle(); // empty

    const first = await startRun(USER);
    await startNode(first, 'a');
    await expectMatchesOracle(); // counted while still running
    await finishNode(first, 'a', 'completed');
    await startNode(first, 'b');
    await expectMatchesOracle();
    await finishNode(first, 'b', 'error');
    await finishRun(first, 'error');
    await expectMatchesOracle(); // run finalized after being counted

    const settled = await startRun(USER);
    for (const node of ['a', 'b', 'c']) { await startNode(settled, node); await finishNode(settled, node, 'completed'); }
    await finishRun(settled);
    const other = await startRun(OTHER);
    await startNode(other, 'x');
    await finishNode(other, 'x', 'completed');
    await expectMatchesOracle();
    await expectMatchesOracle(OTHER);

    // A looped node: every UPDATE rewrites all of its rows in this run, including ones already counted.
    const looping = await startRun(USER);
    await startNode(looping, 'loop');
    await finishNode(looping, 'loop', 'completed');
    await expectMatchesOracle();
    await startNode(looping, 'loop');
    await expectMatchesOracle();
    await finishNode(looping, 'loop', 'error'); // flips the earlier, already-counted row too
    await expectMatchesOracle();
    await finishRun(looping, 'error');
    await expectMatchesOracle();
    await expectMatchesOracle(); // and again once folded into the cache
  });

  it('do not let a crashed, never-finalized run pin the watermark', async () => {
    const crashed = await startRun(USER, { startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) });
    await startNode(crashed, 'a'); // stays 'started' forever
    await expectMatchesOracle();
    const later = await startRun(USER);
    await startNode(later, 'b');
    await finishNode(later, 'b', 'completed');
    await finishRun(later);
    await expectMatchesOracle();
    // Settled: nothing below the newest row is re-read on the next call.
    const [{ m }] = await all(`SELECT max(rowid) AS m FROM node_executions`);
    const next = await get(NODE_STATS_SQL.since, [m, m, USER]);
    expect(next.total).toBe(0);
  });

  it('share one computation between concurrent callers, and stay exact under them', async () => {
    const r = await startRun(USER);
    for (let i = 0; i < 5; i++) { await startNode(r, `n${i}`); await finishNode(r, `n${i}`, 'completed'); }
    await finishRun(r);
    // One recount, not five: on a cold cache each is a full history read.
    const first = UserModel.getNodeExecutionStats(USER);
    expect(UserModel.getNodeExecutionStats(USER)).toBe(first);
    await first;
    const results = await Promise.all(Array.from({ length: 5 }, () => statsFor(USER)));
    const expected = await oracle(USER);
    for (const result of results) expect(result).toEqual(expected);
    await expectMatchesOracle();
  });

  it('recount after invalidation, so a reset shows at once', async () => {
    const older = await startRun(USER);
    for (let i = 0; i < 4; i++) { await startNode(older, `n${i}`); await finishNode(older, `n${i}`, 'completed'); }
    await finishRun(older);
    const newer = await startRun(USER);
    await startNode(newer, 'kept');
    await finishNode(newer, 'kept', 'completed');
    await finishRun(newer);
    await expectMatchesOracle();

    // Delete OLDER history: the newest rowid is unchanged, so nothing but invalidation can reveal it —
    // which is why every code path that deletes execution history must call invalidateNodeStats().
    await run(`DELETE FROM node_executions WHERE execution_id = ?`, [older]);
    expect(await statsFor(USER)).not.toEqual(await oracle(USER));
    UserModel.invalidateNodeStats();
    await expectMatchesOracle();
  });

  it('keep the response shape the frontend reads', async () => {
    const stats = await UserModel.getUserStats(USER);
    for (const key of ['totalWorkflows', 'totalCustomTools', 'totalAgents', 'totalExecutions', 'successfulExecutions', 'failedExecutions', 'startedExecutions', 'totalNodeExecutions', 'successfulNodeExecutions', 'failedNodeExecutions']) {
      expect(typeof stats[key], key).toBe('number');
    }
    expect(stats.workflowStatuses).toEqual({ complete: stats.successfulExecutions, error: stats.failedExecutions, started: stats.startedExecutions });
  });

  it('read only new rows on a warm call', async () => {
    const plan = (await all(`EXPLAIN QUERY PLAN ${NODE_STATS_SQL.since}`, [1, 2, USER])).map((row) => row.detail).join(' | ');
    expect(plan).toMatch(/SEARCH ne USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)/);
  });
});
