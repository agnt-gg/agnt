/**
 * HTTP contract for the cluster wire.
 *
 * The model tests prove the claim SQL and the token tests prove the grant.
 * This proves the surface a worker actually talks to: real express routing,
 * real status codes, real database, real grants.
 *
 * The assertions that matter most are the refusals — an unauthenticated claim,
 * a claim that reaches across accounts, and a result posted by a node that has
 * already lost the task.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';

const OWNER = 'user-cluster-owner';
const STRANGER = 'user-cluster-stranger';

// The two operator routes are guarded by the app's normal session auth, which
// is covered by Middleware.auth.test.js. Substitute a fixed identity so this
// file is about the cluster contract.
vi.mock('./Middleware.js', () => ({
  authenticateToken: (req, _res, next) => {
    const id = req.headers['x-test-user'] || OWNER;
    req.user = { isAuthenticated: true, id, userId: id };
    next();
  },
  authenticateTokenOptional: (req, _res, next) => next(),
  sessionMiddleware: (req, _res, next) => next(),
  getUserTokenFromSession: () => null,
}));

// A worker's result is written through TaskOrchestrator.processTaskResult so
// local and remote execution produce the same output shape. Stub it to keep
// this test on the wire rather than in the agent stack — and assert it is the
// function that gets called.
const processTaskResult = vi.fn(async (taskId) => {
  const TaskModel = (await import('../models/TaskModel.js')).default;
  await TaskModel.updateStatus(taskId, 'completed', 100);
  return { content: 'ok' };
});
// Goal completion is the primary's job even when a WORKER finished the last
// task. checkGoalCompletion mirrors the real implementation against the real
// database so the assertions below are about the wire, not about a stub
// agreeing with itself.
const checkGoalCompletion = vi.fn(async (goalId) => {
  const TaskModel = (await import('../models/TaskModel.js')).default;
  const tasks = await TaskModel.findByGoalId(goalId);
  return tasks.length > 0 && tasks.every((t) => t.status === 'completed');
});
const completeGoal = vi.fn(async () => {});
const runningGoals = new Map();

vi.mock('../services/goal/TaskOrchestrator.js', () => ({
  default: {
    processTaskResult: (...args) => processTaskResult(...args),
    checkGoalCompletion: (...args) => checkGoalCompletion(...args),
    completeGoal: (...args) => completeGoal(...args),
    runningGoals,
  },
}));

let server;
let baseUrl;
let db;
let TaskModel;
let generateUUID;

const req = async (method, path, { token, user, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (user) headers['x-test-user'] = user;
  // fetch() throws outright on a GET/HEAD with a body, so the shared helper
  // has to drop it rather than pass it through.
  const sendsBody = body && !['GET', 'HEAD'].includes(method);
  const res = await fetch(baseUrl + path, { method, headers, ...(sendsBody ? { body: JSON.stringify(body) } : {}) });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    /* 204 and error bodies may be empty */
  }
  return { status: res.status, body: parsed };
};

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

async function seedGoal(userId, status = 'executing') {
  const goalId = generateUUID();
  await dbRun(`INSERT INTO goals (id, user_id, title, description, status) VALUES (?, ?, ?, ?, ?)`, [
    goalId,
    userId,
    'cluster goal',
    'cluster goal',
    status,
  ]);
  return goalId;
}

/** Mint a grant the way an operator would: through the enrol endpoint. */
async function enrol(userId, label = 'test-node') {
  const { body } = await req('POST', '/api/cluster/enroll', { user: userId, body: { label } });
  return body;
}

beforeAll(async () => {
  const dbModule = await import('../models/database/index.js');
  db = dbModule.default;
  await dbModule.dbReady;

  TaskModel = (await import('../models/TaskModel.js')).default;
  generateUUID = (await import('../utils/generateUUID.js')).default;

  for (const id of [OWNER, STRANGER]) {
    await dbRun(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`, [id, `${id}@test.local`, id]);
  }

  const { default: ClusterRoutes } = await import('./ClusterRoutes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/cluster', ClusterRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  processTaskResult.mockClear();
  checkGoalCompletion.mockClear();
  completeGoal.mockClear();
  runningGoals.clear();
  await dbRun(`DELETE FROM tasks`);
  await dbRun(`DELETE FROM goals`);
  await dbRun(`DELETE FROM llm_calls`);
});

describe('every node route refuses an unauthenticated caller', () => {
  it.each([
    ['POST', '/api/cluster/claim'],
    ['POST', '/api/cluster/renew'],
    ['POST', '/api/cluster/release'],
    ['POST', '/api/cluster/complete'],
    ['GET', '/api/cluster/whoami'],
  ])('%s %s is 401 without a grant', async (method, path) => {
    expect((await req(method, path, { body: {} })).status).toBe(401);
  });

  it('refuses a garbage grant', async () => {
    const { status } = await req('GET', '/api/cluster/whoami', { token: 'not.a.token' });
    expect(status).toBe(401);
  });
});

describe('enrolment', () => {
  it('returns a working grant and a copy-paste env block', async () => {
    const enrolment = await enrol(OWNER, 'hetzner-fsn1');

    expect(enrolment.nodeId).toMatch(/^node_/);
    expect(enrolment.env.AGNT_NODE_ROLE).toBe('worker');
    expect(enrolment.env.AGNT_CLUSTER_TOKEN).toBe(enrolment.token);
    expect(enrolment.env.AGNT_CLUSTER_PRIMARY).toContain('127.0.0.1');

    const who = await req('GET', '/api/cluster/whoami', { token: enrolment.token });
    expect(who.status).toBe(200);
    expect(who.body.nodeId).toBe(enrolment.nodeId);
  });
});

describe('claim', () => {
  it('is 204 — not 404, not an empty 200 — when the queue is empty', async () => {
    const { token } = await enrol(OWNER);
    await seedGoal(OWNER);

    // "No content" is literally what happened, and it keeps a polling loop
    // from having to tell an empty queue apart from an error.
    expect((await req('POST', '/api/cluster/claim', { token })).status).toBe(204);
  });

  it('hands out a task with the goal context a worker needs', async () => {
    const { token, nodeId } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'do the thing', 'in detail');

    const { status, body } = await req('POST', '/api/cluster/claim', { token });

    expect(status).toBe(200);
    expect(body.task).toMatchObject({ id: taskId, goalId, title: 'do the thing' });
    // A task title alone is not enough for an agent; the worker holds no goal
    // state of its own.
    expect(body.goal.title).toBe('cluster goal');

    const row = await dbGet(`SELECT claimed_by FROM tasks WHERE id = ?`, [taskId]);
    expect(row.claimed_by).toBe(nodeId);
  });

  it('never crosses accounts', async () => {
    const stranger = await enrol(STRANGER);
    const goalId = await seedGoal(OWNER);
    await TaskModel.create(goalId, 'owner work', '');

    // A grant is issued to ONE account. The join to goals.user_id is the only
    // thing keeping a worker inside its owner's work.
    expect((await req('POST', '/api/cluster/claim', { token: stranger.token })).status).toBe(204);
  });

  it('gives one task to one node', async () => {
    const a = await enrol(OWNER, 'a');
    const b = await enrol(OWNER, 'b');
    const goalId = await seedGoal(OWNER);
    await TaskModel.create(goalId, 'only once', '');

    const first = await req('POST', '/api/cluster/claim', { token: a.token });
    const second = await req('POST', '/api/cluster/claim', { token: b.token });

    expect(first.status).toBe(200);
    expect(second.status).toBe(204);
  });
});

describe('a polling worker is a live worker', () => {
  it('stays visible in the fleet view while the queue is empty', async () => {
    const idle = await enrol(OWNER, 'idle-poller');
    await seedGoal(OWNER);

    expect((await req('POST', '/api/cluster/claim', { token: idle.token })).status).toBe(204);

    const { body } = await req('GET', '/api/cluster/nodes', { user: OWNER });
    const seen = body.nodes.find((n) => n.nodeId === idle.nodeId);

    // For a healthy worker the poll IS the heartbeat: asking for work is the
    // only thing it does when there is none. A node that never appears until
    // it happens to win a task is indistinguishable from a dead one exactly
    // when the queue is quiet, which is most of the time.
    expect(seen, 'an idle worker that polled must appear in the fleet view').toBeDefined();
    expect(seen.stale).toBe(false);
    // ...but polling is not claiming.
    expect(seen.claims).toBe(0);
  });

  it('stays visible even while the spend ceiling is refusing it work', async () => {
    const idle = await enrol(OWNER, 'budget-blocked');
    await seedGoal(OWNER);

    process.env.AGNT_SPEND_LIMIT_USD = '0';
    try {
      expect((await req('POST', '/api/cluster/claim', { token: idle.token })).status).toBe(429);
    } finally {
      delete process.env.AGNT_SPEND_LIMIT_USD;
    }

    const { body } = await req('GET', '/api/cluster/nodes', { user: OWNER });
    // A node being refused work is still a node that is up.
    expect(body.nodes.find((n) => n.nodeId === idle.nodeId)).toBeDefined();
  });
});

describe('a goal the FLEET finished still finishes', () => {
  it('completes the goal when a worker reports the last task', async () => {
    const { token } = await enrol(OWNER, 'finisher');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'the last one', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'completed', result: { content: 'done' } },
    });

    // The primary's dispatch loop walks each group once and returns, so when
    // the last task lands minutes later from another machine there is nothing
    // left to notice. Without this the goal sits in 'executing' forever with
    // every task complete: no evaluation, no auto-merge, no insights.
    await vi.waitFor(() => expect(completeGoal).toHaveBeenCalledWith(goalId));
  });

  it('does not complete a goal that still has work outstanding', async () => {
    const { token } = await enrol(OWNER, 'partial');
    const goalId = await seedGoal(OWNER);
    const first = await TaskModel.create(goalId, 'first', '');
    await TaskModel.create(goalId, 'second', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId: first, status: 'completed', result: { content: 'done' } },
    });

    await vi.waitFor(() => expect(checkGoalCompletion).toHaveBeenCalledWith(goalId));
    expect(completeGoal).not.toHaveBeenCalled();
  });

  it('does not complete a goal on a reported failure', async () => {
    const { token } = await enrol(OWNER, 'failer2');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'doomed', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'failed', error: 'nope' },
    });

    await vi.waitFor(() => expect(checkGoalCompletion).toHaveBeenCalledWith(goalId));
    expect(completeGoal).not.toHaveBeenCalled();
  });

  it('leaves an autonomous goal alone — the loop owns its own completion', async () => {
    const { token } = await enrol(OWNER, 'autonomous');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'inside a loop', '');
    runningGoals.set(goalId, { autonomous: true });
    await req('POST', '/api/cluster/claim', { token });

    const { status } = await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'completed', result: { content: 'done' } },
    });

    expect(status).toBe(200);
    // Completing it underneath the autonomous loop would end that loop early.
    expect(completeGoal).not.toHaveBeenCalled();
  });

  it('reports success to the worker even if completion bookkeeping throws', async () => {
    const { token } = await enrol(OWNER, 'resilient');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'recorded regardless', '');
    await req('POST', '/api/cluster/claim', { token });
    checkGoalCompletion.mockRejectedValueOnce(new Error('bookkeeping exploded'));

    const { status } = await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'completed', result: { content: 'done' } },
    });

    // The result is already durably recorded. Telling the worker its result
    // was rejected would make it retry work that is already done.
    expect(status).toBe(200);
    expect((await dbGet(`SELECT status FROM tasks WHERE id = ?`, [taskId])).status).toBe('completed');
  });
});

describe('renew', () => {
  it('extends a lease this node holds', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'renew me', '');
    await req('POST', '/api/cluster/claim', { token });

    expect((await req('POST', '/api/cluster/renew', { token, body: { taskId } })).status).toBe(200);
  });

  it('answers 409, not 401, when the claim is gone', async () => {
    const a = await enrol(OWNER, 'a');
    const b = await enrol(OWNER, 'b');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'not yours', '');
    await req('POST', '/api/cluster/claim', { token: a.token });

    // The grant is fine; the CLAIM is gone. A worker reading this as an auth
    // failure would re-enrol instead of stopping work it no longer owns.
    const { status, body } = await req('POST', '/api/cluster/renew', { token: b.token, body: { taskId } });
    expect(status).toBe(409);
    expect(body.code).toBe('claim_lost');
  });

  it('rejects a request with no taskId', async () => {
    const { token } = await enrol(OWNER);
    expect((await req('POST', '/api/cluster/renew', { token, body: {} })).status).toBe(400);
  });
});

describe('complete', () => {
  it('writes the result through the same path local execution uses', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'finish me', '');
    await req('POST', '/api/cluster/claim', { token });

    const result = { content: 'done', tool_executions: [], usage: { input_tokens: 10 } };
    const { status } = await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'completed', result },
    });

    expect(status).toBe(200);
    // Two writers producing two output shapes for one column is how the goal
    // evaluator ends up needing a special case per execution site.
    expect(processTaskResult).toHaveBeenCalledWith(taskId, result);

    const row = await dbGet(`SELECT status, claimed_by FROM tasks WHERE id = ?`, [taskId]);
    expect(row.status).toBe('completed');
    expect(row.claimed_by, 'a finished task must not stay claimed').toBeNull();
  });

  it('records a reported failure without waiting out the lease', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'fail me', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'failed', error: 'provider exploded' },
    });

    const row = await dbGet(`SELECT status, error, claimed_by FROM tasks WHERE id = ?`, [taskId]);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('provider exploded');
    expect(row.claimed_by).toBeNull();
  });

  it('refuses a result from a node that has lost the claim', async () => {
    const a = await enrol(OWNER, 'a');
    const b = await enrol(OWNER, 'b');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'slow node', '');
    await req('POST', '/api/cluster/claim', { token: a.token });

    // A lease can lapse WHILE the work runs. Accepting this write anyway would
    // let a slow node overwrite a fresher result.
    const { status, body } = await req('POST', '/api/cluster/complete', {
      token: b.token,
      body: { taskId, status: 'completed', result: { content: 'stale' } },
    });

    expect(status).toBe(409);
    expect(body.code).toBe('claim_lost');
    expect(processTaskResult).not.toHaveBeenCalled();
  });
});

describe('fleet spend lands in the primary’s ledger', () => {
  it('records a worker’s measured spend against the WORKER, not the primary', async () => {
    const { token, nodeId } = await enrol(OWNER, 'spender');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'costly', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: {
        taskId,
        status: 'completed',
        result: { content: 'done' },
        spend: [
          {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            originId: goalId,
            input_tokens: 1000,
            output_tokens: 500,
            status: 'ok',
          },
        ],
      },
    });

    const row = await dbGet(`SELECT node_id, cost_usd, origin, origin_id FROM llm_calls WHERE origin_id = ?`, [
      goalId,
    ]);

    // Without this the fleet's spend sits in N sqlite files the operator never
    // opens. Stamping the PRIMARY here instead would give a per-node breakdown
    // that is uniform, plausible and wrong.
    expect(row.node_id).toBe(nodeId);
    expect(row.origin).toBe('goal_task');
    // Priced by the PRIMARY's catalogue, so one ledger is one pricing table.
    expect(row.cost_usd).toBeGreaterThan(0);
  });

  it('records spend for a task that failed', async () => {
    const { token, nodeId } = await enrol(OWNER, 'failer');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'expensive failure', '');
    await req('POST', '/api/cluster/claim', { token });

    await req('POST', '/api/cluster/complete', {
      token,
      body: {
        taskId,
        status: 'failed',
        error: 'provider exploded',
        spend: [
          {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            originId: goalId,
            input_tokens: 800,
            output_tokens: 0,
            status: 'error',
          },
        ],
      },
    });

    // Reporting cost only on success is how a fleet's most expensive failures
    // become invisible.
    const row = await dbGet(`SELECT node_id FROM llm_calls WHERE origin_id = ?`, [goalId]);
    expect(row.node_id).toBe(nodeId);
  });

  it('a bad spend row never turns a completed task into a failed one', async () => {
    const { token } = await enrol(OWNER, 'garbage');
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'still completes', '');
    await req('POST', '/api/cluster/claim', { token });

    const { status } = await req('POST', '/api/cluster/complete', {
      token,
      body: { taskId, status: 'completed', result: { content: 'ok' }, spend: [{ nonsense: true }, null] },
    });

    expect(status).toBe(200);
    expect((await dbGet(`SELECT status FROM tasks WHERE id = ?`, [taskId])).status).toBe('completed');
  });
});

describe('the spend ceiling is enforced at the claim', () => {
  afterEach(() => {
    delete process.env.AGNT_SPEND_LIMIT_USD;
  });

  it('refuses new work with 429 once the hard limit is reached', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    await TaskModel.create(goalId, 'too expensive to start', '');

    process.env.AGNT_SPEND_LIMIT_USD = '0';

    const { status, body } = await req('POST', '/api/cluster/claim', { token });

    // 429, not 402/403: the window resets, so a worker that backs off and
    // retries is correct. A permanent-sounding refusal makes workers give up
    // on a ceiling that clears at midnight.
    expect(status).toBe(429);
    expect(body.code).toBe('hard_limit_reached');
  });

  it('leaves the task untouched — refusing to start is not failing', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    const taskId = await TaskModel.create(goalId, 'untouched', '');

    process.env.AGNT_SPEND_LIMIT_USD = '0';
    await req('POST', '/api/cluster/claim', { token });

    const row = await dbGet(`SELECT status, claimed_by, attempt_count FROM tasks WHERE id = ?`, [taskId]);
    expect(row.status).toBe('pending');
    expect(row.claimed_by).toBeNull();
    expect(row.attempt_count, 'a refused claim must not burn an attempt').toBe(0);
  });

  it('admits again as soon as the limit is lifted', async () => {
    const { token } = await enrol(OWNER);
    const goalId = await seedGoal(OWNER);
    await TaskModel.create(goalId, 'later', '');

    process.env.AGNT_SPEND_LIMIT_USD = '0';
    expect((await req('POST', '/api/cluster/claim', { token })).status).toBe(429);

    delete process.env.AGNT_SPEND_LIMIT_USD;
    expect((await req('POST', '/api/cluster/claim', { token })).status).toBe(200);
  });
});

describe('nodes', () => {
  it('reports only the calling operator\u2019s nodes', async () => {
    const mine = await enrol(OWNER, 'mine');
    const theirs = await enrol(STRANGER, 'theirs');
    await req('GET', '/api/cluster/whoami', { token: mine.token });
    await req('GET', '/api/cluster/whoami', { token: theirs.token });

    const { body } = await req('GET', '/api/cluster/nodes', { user: OWNER });
    const ids = body.nodes.map((n) => n.nodeId);

    expect(ids).toContain(mine.nodeId);
    expect(ids).not.toContain(theirs.nodeId);
    expect(body.self.role).toBe('primary');
  });
});
