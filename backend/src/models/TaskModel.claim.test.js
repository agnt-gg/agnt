/**
 * Task claiming — the guard clause is the product.
 *
 * Everything in this file exists to prove one sentence: a task can be handed
 * to exactly one node, and a node that dies gives it back without anyone
 * intervening.
 *
 * A NOTE ON WHAT "CONCURRENT" MEANS HERE
 * ──────────────────────────────────────
 * node-sqlite3 serialises statements on a single connection, so two claims
 * issued from this process do not physically overlap. That does NOT weaken the
 * assertion, because the thing being tested is the conditional UPDATE's WHERE
 * clause — the mechanism that makes a real overlap safe. If the guard were
 * wrong (a SELECT-then-UPDATE, say) the second claim would still succeed here
 * and the test would still fail. What this cannot prove is sqlite's own
 * atomicity, which is not ours to test.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import db, { dbReady } from './database/index.js';
import TaskModel from './TaskModel.js';
import generateUUID from '../utils/generateUUID.js';

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const NODE_A = 'node-aaaa';
const NODE_B = 'node-bbbb';

let userId;
const createdGoals = [];

async function makeGoal(status = 'executing') {
  const goalId = generateUUID();
  await run(
    `INSERT INTO goals (id, user_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
    [goalId, userId, 'claim test goal', 'claim test goal', status]
  );
  createdGoals.push(goalId);
  return goalId;
}

/** Read the raw claim columns, bypassing findOne's JSON parsing. */
const claimRow = (taskId) =>
  get(`SELECT status, claimed_by, claim_expires_at, attempt_count FROM tasks WHERE id = ?`, [taskId]);

beforeAll(async () => {
  await dbReady;
  userId = generateUUID();
  await run(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`, [
    userId,
    `claim-${userId}@test.local`,
    'claim test',
  ]);
});

afterEach(async () => {
  // Goals are per-test so one test's queue can never be another's shortlist.
  for (const goalId of createdGoals.splice(0)) {
    await run(`DELETE FROM tasks WHERE goal_id = ?`, [goalId]);
    await run(`DELETE FROM goals WHERE id = ?`, [goalId]);
  }
});

describe('claim — exactly one winner', () => {
  it('gives the task to one node and refuses the other', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'only once', 'only once');

    const [a, b] = await Promise.all([
      TaskModel.claim(taskId, NODE_A),
      TaskModel.claim(taskId, NODE_B),
    ]);

    expect([a, b].filter(Boolean), 'both nodes claimed the same task').toHaveLength(1);

    const row = await claimRow(taskId);
    expect(row.claimed_by).toBe(a ? NODE_A : NODE_B);
    // The loser must not have burned an attempt — it never ran anything.
    expect(row.attempt_count).toBe(1);
  });

  it('is re-entrant for the node that already holds it', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 're-entrant', 're-entrant');

    expect(await TaskModel.claim(taskId, NODE_A)).toBe(true);
    // A retry inside one node must not look like a lost claim. This is what
    // lets a goal resume immediately after AGNT is killed and restarted inside
    // the lease window, instead of stalling on a lease it owns itself.
    expect(await TaskModel.claim(taskId, NODE_A)).toBe(true);
    expect((await claimRow(taskId)).attempt_count).toBe(2);
  });

  it('REFUSES to re-take our own live claim in strict mode', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'strict', 'strict');

    expect(await TaskModel.claim(taskId, NODE_A, 60000, { reentrant: false })).toBe(true);
    expect(await TaskModel.claim(taskId, NODE_A, 60000, { reentrant: false })).toBe(false);
    expect((await claimRow(taskId)).attempt_count, 'a refused claim must not burn an attempt').toBe(1);
  });

  it('strict mode still takes over a lease that has lapsed', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'strict expiry', '');

    // Strictness must not cost the crash-recovery property: an EXPIRED lease is
    // claimable by anyone, including its previous holder.
    expect(await TaskModel.claim(taskId, NODE_A, -1000, { reentrant: false })).toBe(true);
    expect(await TaskModel.claim(taskId, NODE_A, 60000, { reentrant: false })).toBe(true);
  });

  it('refuses a task that is already finished', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'done', 'done');
    await TaskModel.updateStatus(taskId, 'completed', 100);

    expect(await TaskModel.claim(taskId, NODE_A)).toBe(false);
  });

  it('claims a task a previous partial run left as assigned', async () => {
    // Single-node behaviour must not change: executeGoal only resets
    // failed/running to pending, so an 'assigned' row reaches dispatch as-is.
    // Requiring 'pending' here would silently skip it forever.
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'assigned', 'assigned');
    await run(`UPDATE tasks SET status = 'assigned' WHERE id = ?`, [taskId]);

    expect(await TaskModel.claim(taskId, NODE_A)).toBe(true);
  });
});

describe('the lease is what makes a dead node harmless', () => {
  it('lets another node take over once the lease lapses', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'handover', 'handover');

    // NODE_A takes it, then "dies" — simulated by an already-expired lease,
    // which is precisely the state a crash leaves behind.
    expect(await TaskModel.claim(taskId, NODE_A, -1000)).toBe(true);
    expect(await TaskModel.claim(taskId, NODE_B)).toBe(true);

    const row = await claimRow(taskId);
    expect(row.claimed_by).toBe(NODE_B);
    expect(row.attempt_count, 'the takeover is a second attempt').toBe(2);
  });

  it('treats a live lease as untouchable', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'live lease', 'live lease');

    expect(await TaskModel.claim(taskId, NODE_A, 60000)).toBe(true);
    expect(await TaskModel.claim(taskId, NODE_B)).toBe(false);
  });

  it('reclaims a malformed row rather than leaking it forever', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'malformed', 'malformed');
    await run(`UPDATE tasks SET claimed_by = ?, claim_expires_at = NULL WHERE id = ?`, [NODE_A, taskId]);

    // Holder set, no expiry: no clock will ever free it. Claimable is the only
    // answer that does not strand the task permanently.
    expect(await TaskModel.claim(taskId, NODE_B)).toBe(true);
  });
});

describe('renewClaim / releaseClaim are scoped to the owner', () => {
  it('renews only for the holder, and reports loss rather than renewing harder', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'renew', 'renew');
    await TaskModel.claim(taskId, NODE_A, 5000);

    const before = (await claimRow(taskId)).claim_expires_at;
    expect(await TaskModel.renewClaim(taskId, NODE_A, 60000)).toBe(true);
    expect((await claimRow(taskId)).claim_expires_at).toBeGreaterThan(before);

    // A node that has lost the claim must learn that from the return value.
    expect(await TaskModel.renewClaim(taskId, NODE_B, 60000)).toBe(false);
  });

  it('releases only for the holder', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'release', 'release');
    await TaskModel.claim(taskId, NODE_A);

    expect(await TaskModel.releaseClaim(taskId, NODE_B)).toBe(false);
    expect(await TaskModel.releaseClaim(taskId, NODE_A)).toBe(true);

    const row = await claimRow(taskId);
    expect(row.claimed_by).toBeNull();
    expect(row.claim_expires_at).toBeNull();
  });
});

describe('reapExpiredClaims — the only path that resurrects abandoned work', () => {
  it('returns a running task with a dead lease to pending', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'abandoned', 'abandoned');
    await TaskModel.claim(taskId, NODE_A, -1000);
    await TaskModel.updateStatus(taskId, 'running');

    // Without this, nothing ever looks at the row again: the pull query only
    // considers 'pending'.
    expect(await TaskModel.reapExpiredClaims()).toBe(1);

    const row = await claimRow(taskId);
    expect(row.status).toBe('pending');
    expect(row.claimed_by).toBeNull();
  });

  it('leaves a live lease alone', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'still working', 'still working');
    await TaskModel.claim(taskId, NODE_A, 60000);
    await TaskModel.updateStatus(taskId, 'running');

    expect(await TaskModel.reapExpiredClaims()).toBe(0);
    expect((await claimRow(taskId)).status).toBe('running');
  });

  it.each(['completed', 'failed', 'paused'])('never resurrects a %s task', async (status) => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, status, status);
    await TaskModel.claim(taskId, NODE_A, -1000);
    await TaskModel.updateStatus(taskId, status);

    // 'paused' is the sharp one: reviving it would be this function overruling
    // a human who deliberately stopped the work.
    expect(await TaskModel.reapExpiredClaims()).toBe(0);
    expect((await claimRow(taskId)).status).toBe(status);
  });
});

describe('claimNext — the pull side', () => {
  it('returns null when there is nothing to do', async () => {
    await makeGoal();
    expect(await TaskModel.claimNext(NODE_A)).toBeNull();
  });

  it('hands out tasks in order_index and never the same one twice', async () => {
    const goalId = await makeGoal();
    const first = await TaskModel.create(goalId, 'first', '', [], [], 0);
    const second = await TaskModel.create(goalId, 'second', '', [], [], 1);

    const a = await TaskModel.claimNext(NODE_A, { goalId });
    const b = await TaskModel.claimNext(NODE_B, { goalId });

    expect(a.id).toBe(first);
    expect(b.id).toBe(second);
    expect(await TaskModel.claimNext('node-cccc', { goalId })).toBeNull();
  });

  it('ignores goals that are not executing', async () => {
    const goalId = await makeGoal('paused');
    await TaskModel.create(goalId, 'paused goal task', '');
    expect(await TaskModel.claimNext(NODE_A, { goalId })).toBeNull();
  });

  it('will not hand out a task whose dependencies are unmet', async () => {
    const goalId = await makeGoal();
    const blocker = await TaskModel.create(goalId, 'blocker', '', [], [], 0);
    await TaskModel.create(goalId, 'blocked', '', [], [blocker], 1);

    // Claiming a blocked task would burn one of its attempts and hold it away
    // from the node that could legitimately run it later.
    const claimed = await TaskModel.claimNext(NODE_A, { goalId });
    expect(claimed.id).toBe(blocker);
    expect(await TaskModel.claimNext(NODE_B, { goalId })).toBeNull();

    await TaskModel.updateStatus(blocker, 'completed', 100);
    expect((await TaskModel.claimNext(NODE_B, { goalId })).title).toBe('blocked');
  });

  it('REGRESSION: two processes sharing one node id cannot both take a task', async () => {
    // MEASURED, not theorised. A four-way live race against six tasks (two
    // grants, two poll loops each — i.e. one enrolment env block copied into a
    // second container, exactly what the docs invite an operator to do)
    // produced TWELVE claims and left every row at attempt_count = 2.
    //
    // Cause: claimNext used the re-entrant claim, so the second process matched
    // `claimed_by = ?` against its OWN node id and re-took a task the first was
    // already executing. The guard that makes a claim safe was being satisfied
    // by the claimant itself.
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'one task, one runner', '');

    const [first, second] = await Promise.all([
      TaskModel.claimNext(NODE_A, { goalId }),
      TaskModel.claimNext(NODE_A, { goalId }),
    ]);

    const winners = [first, second].filter(Boolean);
    expect(winners, 'the same node claimed one task twice').toHaveLength(1);
    expect(winners[0].id).toBe(taskId);
    expect((await claimRow(taskId)).attempt_count).toBe(1);
  });

  it('REGRESSION: a shared node id cannot drain a queue twice over', async () => {
    const goalId = await makeGoal();
    for (let i = 0; i < 5; i++) await TaskModel.create(goalId, `t${i}`, '', [], [], 0);

    // Four concurrent pollers, ONE node id. Total hand-outs must equal the
    // number of tasks, not the number of pollers times the number of tasks.
    const drain = async () => {
      const got = [];
      for (;;) {
        const task = await TaskModel.claimNext(NODE_A, { goalId });
        if (!task) return got;
        got.push(task.id);
      }
    };
    const handedOut = (await Promise.all([drain(), drain(), drain(), drain()])).flat();

    expect(handedOut).toHaveLength(5);
    expect(new Set(handedOut).size).toBe(5);
  });

  it('stops handing out a task that keeps killing its claimant', async () => {
    const goalId = await makeGoal();
    const taskId = await TaskModel.create(goalId, 'poison', 'poison');

    // Each round: claim, "crash" (expired lease), lease lapses, next node
    // takes it. Without a ceiling this circulates through the fleet forever.
    for (let i = 0; i < 3; i++) {
      const claimed = await TaskModel.claimNext(NODE_A, { goalId, maxAttempts: 3, leaseMs: -1000 });
      expect(claimed?.id, `attempt ${i + 1} should still be claimable`).toBe(taskId);
    }
    expect(await TaskModel.claimNext(NODE_A, { goalId, maxAttempts: 3 })).toBeNull();
  });
});

describe('canExecuteTask', () => {
  it('answers false for a task that no longer exists', async () => {
    // Regression: db.get yields undefined for no match, and the old
    // `result.incomplete_deps === 0` threw a TypeError inside a Promise
    // executor — an unhandled rejection rather than a decision. Reachable
    // whenever a re-plan deletes a task while its goal is mid-flight.
    await expect(TaskModel.canExecuteTask('no-such-task-id')).resolves.toBe(false);
  });
});
