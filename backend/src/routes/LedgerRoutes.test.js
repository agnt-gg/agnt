/**
 * HTTP contract test for the ledger read API (PRD-122).
 *
 * The model tests prove the aggregates. This proves the SURFACE a client
 * actually consumes: real express routing, real status codes, real JSON shape,
 * against a real database.
 *
 * The most important assertion here is that every monetary response carries the
 * full triple (charged / unpriced / notional). A response that returns a bare
 * cost would reintroduce the defect this PRD exists to fix one layer up, where
 * no model test would see it.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

const USER = 'user-ledger-http';
const OTHER = 'user-ledger-other';
const PRICED = { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };

// The routes are guarded; substitute a fixed identity so this test is about the
// ledger surface rather than about auth (auth is covered elsewhere). Mirrors
// the real middleware, which sets BOTH `id` and `userId`.
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
let AgentExecutionModel;
const savedEnv = {};

const get = async (url, user) => {
  const res = await fetch(baseUrl + url, user ? { headers: { 'x-test-user': user } } : undefined);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body };
};

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-ledger-http-'));
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
  AgentExecutionModel = (await import('../models/AgentExecutionModel.js')).default;
  const LedgerRoutes = (await import('./LedgerRoutes.js')).default;

  for (const [id, email] of [[USER, 'http@test.local'], [OTHER, 'other@test.local']]) {
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [id, email, id]);
  }

  const app = express();
  app.use('/ledger', LedgerRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 120000);

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('GET /summary', () => {
  it('returns the full cost triple, never a bare total', async () => {
    await recordLlmCall({
      userId: USER, origin: 'chat', ...PRICED,
      usage: { inputTokens: 10000, outputTokens: 1000 },
    });

    const { status, body } = await get('/ledger/summary?window=30d');
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // The triple is the contract. Omitting unpricedCalls is how a total starts
    // silently understating itself.
    expect(body).toHaveProperty('costUsd');
    expect(body).toHaveProperty('unpricedCalls');
    expect(body).toHaveProperty('notionalUsd');
    expect(body.costUsd).toBeGreaterThan(0);
  });

  it('reports dropped writes from EVERY process, not just the one answering', async () => {
    const LlmCallModel = (await import('../models/LlmCallModel.js')).default;
    // Simulate the workflow process losing a write. It shares only the
    // database with the API process, so this is the sole channel by which the
    // failure can become visible here.
    await LlmCallModel.noteWriteFailure('workflow', 'db locked');

    const { body } = await get('/ledger/summary?window=30d');
    expect(body.ledgerHealth.totalFailures).toBeGreaterThanOrEqual(1);
    expect(body.ledgerHealth.byProcess.find((r) => r.source === 'workflow').failures).toBe(1);

    // In-process numbers are still reported, but explicitly scoped so they
    // cannot be misread as a global guarantee.
    expect(body.ledgerHealth.thisProcess.scope).toBe('backend');
    expect(body.ledgerHealth.thisProcess).toHaveProperty('pid');
  });

  it('scopes totals to the authenticated user', async () => {
    const mine = await get('/ledger/summary?window=30d', USER);
    const theirs = await get('/ledger/summary?window=30d', OTHER);
    expect(mine.body.costUsd).toBeGreaterThan(0);
    expect(theirs.body.costUsd).toBe(0);
    expect(theirs.body.calls).toBe(0);
  });
});

describe('GET /breakdown', () => {
  it('buckets by origin and the buckets reconcile to the summary', async () => {
    await recordLlmCall({
      userId: USER, origin: 'goal_task', originId: 'g1', ...PRICED,
      usage: { inputTokens: 5000, outputTokens: 500 },
    });

    const { status, body } = await get('/ledger/breakdown?groupBy=origin&window=30d');
    expect(status).toBe(200);
    expect(body.rows.map((r) => r.bucket).sort()).toEqual(['chat', 'goal_task']);

    const summary = await get('/ledger/summary?window=30d');
    const summed = body.rows.reduce((s, r) => s + r.costUsd, 0);
    expect(summed).toBeCloseTo(summary.body.costUsd, 10);
  });

  it('rejects an unwhitelisted groupBy with 400, not 500', async () => {
    // groupBy is the one value reaching SQL as an identifier. A bad one is a
    // client mistake and must not read as a server fault.
    const { status, body } = await get('/ledger/breakdown?groupBy=nonsense_column');
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unsupported groupBy/);
  });
});

describe('GET /tree/:executionId', () => {
  it('returns the tree with per-node and subtree cost, including unattached rows', async () => {
    const rootId = await AgentExecutionModel.create(
      USER, null, 'Root', 'conv-http', 'root', PRICED.provider, PRICED.model, 'running'
    );
    const childId = await AgentExecutionModel.create(
      USER, null, 'Child', 'conv-http', 'child', PRICED.provider, PRICED.model, 'running',
      { parentExecutionId: rootId, rootExecutionId: rootId, origin: 'agent' }
    );

    await recordLlmCall({ userId: USER, origin: 'agent', executionId: rootId, rootExecutionId: rootId, ...PRICED, usage: { inputTokens: 1000, outputTokens: 100 } });
    await recordLlmCall({ userId: USER, origin: 'agent', executionId: childId, rootExecutionId: rootId, ...PRICED, usage: { inputTokens: 2000, outputTokens: 200 } });
    // Goal work with no execution row of its own — real spend that a naive
    // tree walk over agent_executions alone would miss.
    await recordLlmCall({ userId: USER, origin: 'goal_task', originId: 'g-tree', rootExecutionId: rootId, ...PRICED, usage: { inputTokens: 3000, outputTokens: 300 } });

    const { status, body } = await get(`/ledger/tree/${rootId}`);
    expect(status).toBe(200);
    expect(body.rootExecutionId).toBe(rootId);
    expect(body.nodes).toHaveLength(2);

    const child = body.nodes.find((n) => n.id === childId);
    expect(child.parentExecutionId).toBe(rootId);
    expect(child.ledger.costUsd).toBeGreaterThan(0);

    expect(body.unattached).toHaveLength(1);
    expect(body.unattached[0].origin).toBe('goal_task');

    const nodeSum = body.nodes.reduce((s, n) => s + (n.ledger?.costUsd || 0), 0);
    expect(body.subtree.costUsd).toBeCloseTo(nodeSum + body.unattached[0].costUsd, 10);
    expect(body.subtree.calls).toBe(3);
  });

  it('resolves the whole tree from a CHILD id, not just from the root', async () => {
    const rootId = await AgentExecutionModel.create(
      USER, null, 'R2', 'conv-http2', 'r', PRICED.provider, PRICED.model, 'running'
    );
    const childId = await AgentExecutionModel.create(
      USER, null, 'C2', 'conv-http2', 'c', PRICED.provider, PRICED.model, 'running',
      { parentExecutionId: rootId, rootExecutionId: rootId, origin: 'agent' }
    );

    const { body } = await get(`/ledger/tree/${childId}`);
    expect(body.rootExecutionId).toBe(rootId);
    expect(body.nodes.map((n) => n.id).sort()).toEqual([rootId, childId].sort());
  });

  it('404s for an unknown execution', async () => {
    const { status } = await get('/ledger/tree/does-not-exist');
    expect(status).toBe(404);
  });

  it("404s for another user's execution rather than leaking it", async () => {
    const foreign = await AgentExecutionModel.create(
      OTHER, null, 'Theirs', 'conv-x', 'x', PRICED.provider, PRICED.model, 'running'
    );
    const { status } = await get(`/ledger/tree/${foreign}`, USER);
    expect(status).toBe(404);
  });
});
