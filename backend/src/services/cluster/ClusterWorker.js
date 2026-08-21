import db from '../../models/database/index.js';
import LlmCallModel from '../../models/LlmCallModel.js';
import { getNodeLabel, isWorker } from './nodeIdentity.js';
import { decodeGrantUnverified } from './clusterToken.js';

/**
 * The pull loop: ask the primary for work, do it here, report back.
 *
 * ---------------------------------------------------------------------------
 * WHY PULL AND NOT PUSH
 * ---------------------------------------------------------------------------
 * A push scheduler has to know the fleet — how many nodes exist, which are
 * alive, what each can do — and every one of those is state that goes stale
 * and needs its own repair path. A worker that asks needs none of it. Adding
 * capacity is `docker run` with two environment variables, and removing it is
 * turning the container off: the lease expires and the work returns to the
 * queue on its own.
 *
 * ---------------------------------------------------------------------------
 * WHAT A WORKER IS
 * ---------------------------------------------------------------------------
 * An ordinary AGNT install with AGNT_NODE_ROLE=worker. It has its own agents,
 * its own provider credentials and its own database — it simply does not own
 * the GOAL. Task rows live on the primary and are reached over HTTP; nothing
 * here writes to another machine's database.
 *
 * That is also why credentials are never shipped anywhere: each node holds its
 * own, encrypted with its own per-install ENCRYPTION_KEY. The fact that
 * secretResolver makes those keys non-portable stops being an obstacle and
 * becomes the reason no secret broker is needed at all.
 *
 * SCOPE: one operator, one account. The grant is minted for a single userId
 * and the worker executes as its own local user. Multi-tenant seat accounting
 * is a cloud concern and is deliberately not attempted here.
 */

/** Empty-queue backoff. Jittered so N workers do not synchronise into a herd. */
const IDLE_MIN_MS = 2000;

/**
 * How long an idle worker may sleep between polls.
 *
 * WHY THIS IS SECONDS AND NOT HALF A MINUTE
 * ────────────────────────────────────────
 * This ceiling is the wake-up latency of an idle fleet, and it was measured
 * costing exactly that: with a 30s ceiling, the first task of a new goal waits
 * up to half a minute on a completely free fleet, and whichever node happens
 * to wake first drains a short burst on its own while the others are still
 * asleep — the opposite of what the operator added them for.
 *
 * The polling cost this trades against is tiny and, unusually, exactly
 * computable: one HTTP request per node per interval. A ten-node fleet at 5s
 * is 120 requests a minute against a primary on the same host or LAN, which
 * is less traffic than one page of the UI.
 *
 * Overridable because a fleet spread across a metered WAN link has a different
 * answer, and that operator should not have to fork the file to say so.
 */
const DEFAULT_IDLE_MAX_MS = 5000;

function idleMaxMs() {
  const raw = Number(process.env.AGNT_WORKER_IDLE_MAX_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IDLE_MAX_MS;
  // Never below the floor: a "ceiling" under the minimum would inverse the
  // curve and turn the backoff into a busy loop.
  return Math.max(IDLE_MIN_MS, Math.floor(raw));
}

/** How long a claim is held before it must be renewed. */
const LEASE_MS = 120000;

const state = {
  running: false,
  stopping: false,
  timer: null,
  polls: 0,
  claimed: 0,
  completed: 0,
  failed: 0,
  lastError: null,
};

function config() {
  return {
    primary: String(process.env.AGNT_CLUSTER_PRIMARY || '').replace(/\/+$/, ''),
    token: process.env.AGNT_CLUSTER_TOKEN || '',
  };
}

/**
 * The local user this worker executes as.
 *
 * ---------------------------------------------------------------------------
 * WHY A WORKER PROVISIONS ITS OWN USER ROW
 * ---------------------------------------------------------------------------
 * This used to read the first row of `users` and give up when there was none,
 * telling the operator to "sign in on this install first". That instruction
 * cannot be carried out on the machine it is given to: a worker is headless by
 * definition — no browser, no published port, nobody sitting in front of it —
 * and the row it was waiting for is created by an interactive sign-in. The
 * result was that a correctly-enrolled worker booted healthy, reached its
 * primary, and then never polled, which made the enrolment env block this
 * module tells operators to copy a set of instructions that could not work.
 *
 * The grant already carries the answer. `mintNodeToken` signs the userId, and
 * the worker is holding that token before it ever polls, so the identity does
 * not need to be discovered — only recorded. The worker is not DECIDING who it
 * is; the primary already decided, and this writes that decision down locally
 * so every `WHERE user_id = ?` on this node resolves.
 *
 * Resolution order, most authoritative first:
 *   1. AGNT_CLUSTER_WORKER_USER_ID — an operator overriding on purpose.
 *   2. the grant's userId — provisioned locally if absent.
 *   3. the first local user — only when there is no readable grant at all.
 *
 * The grant deliberately outranks an existing local row. They are normally the
 * same person, but when they differ the primary will only ever hand out work
 * for the GRANT's account, and executing it as somebody else would resolve
 * that somebody else's agents and provider credentials.
 */
function userExists(userId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM users WHERE id = ?`, [userId], (err, row) => (err ? reject(err) : resolve(!!row)));
  });
}

function firstLocalUserId() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM users ORDER BY created_at LIMIT 1`, [], (err, row) =>
      err ? reject(err) : resolve(row?.id || null)
    );
  });
}

/**
 * Record the account this node was enrolled for.
 *
 * INSERT OR IGNORE, and no email: the address is not in the grant, and
 * inventing one risks colliding with the real sign-in that may follow on this
 * install. sqlite permits many NULLs in a UNIQUE column, so an absent email is
 * the honest representation of "not known here".
 */
function provisionUser(userId, label) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)`,
      [userId, `cluster worker${label ? ` (${label})` : ''}`],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function localUserId() {
  if (process.env.AGNT_CLUSTER_WORKER_USER_ID) return process.env.AGNT_CLUSTER_WORKER_USER_ID;

  const grant = decodeGrantUnverified(config().token);
  if (grant?.userId) {
    if (!(await userExists(grant.userId))) {
      await provisionUser(grant.userId, grant.label);
      console.log(`[cluster/worker] provisioned local user ${grant.userId} from the enrolment grant`);
    }
    return grant.userId;
  }

  return firstLocalUserId();
}

async function callPrimary(path, { method = 'POST', body = null } = {}) {
  const { primary, token } = config();
  const response = await fetch(`${primary}/api/cluster${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return response;
}

/** Jittered backoff. Doubling with a floor and a ceiling, never a fixed sleep. */
function idleDelay(consecutiveEmptyPolls) {
  const base = Math.min(idleMaxMs(), IDLE_MIN_MS * 2 ** Math.min(consecutiveEmptyPolls, 5));
  return Math.floor(base / 2 + Math.random() * (base / 2));
}

/**
 * Run one claimed task on this node.
 *
 * Executes through TaskOrchestrator.executeTaskViaAgentChat — the exact path
 * the primary uses for a local task — so a remotely-executed task produces the
 * same result shape, the same tool access and the same ledger accounting as a
 * local one. The alternative, a second execution path for remote work, is how
 * the two silently diverge.
 */
async function runTask(assignment, userId) {
  const { default: TaskOrchestrator } = await import('../goal/TaskOrchestrator.js');
  const { default: AgentTaskMatcher } = await import('../goal/AgentTaskMatcher.js');

  const { task, goal } = assignment;

  // Keep the lease alive for as long as the work takes. Same reasoning as
  // TaskOrchestrator._holdClaim: an agent turn can sit in one provider call
  // for minutes and report nothing, and a lease that lapses mid-call would let
  // the primary hand this task to somebody else while we are still doing it.
  const renewal = setInterval(() => {
    callPrimary('/renew', { body: { taskId: task.id, leaseMs: LEASE_MS } }).catch((error) => {
      console.warn(`[cluster/worker] lease renewal failed for ${task.id}: ${error.message}`);
    });
  }, Math.floor(LEASE_MS / 3));
  if (typeof renewal.unref === 'function') renewal.unref();

  // Marks the start of this task's spend window. sqlite's CURRENT_TIMESTAMP is
  // UTC 'YYYY-MM-DD HH:MM:SS', so the bound has to be written in exactly that
  // shape or the comparison silently matches nothing and every task reports
  // zero cost.
  const spendSince = new Date().toISOString().replace('T', ' ').slice(0, 19);

  try {
    const shaped = {
      id: task.id,
      goal_id: task.goalId,
      title: task.title,
      description: task.description,
      required_tools: task.requiredTools || [],
    };

    const agent = await AgentTaskMatcher.selectAgentForTask(shaped, userId);
    const message = TaskOrchestrator.prepareTaskMessage(shaped, {
      goal: goal ? { title: goal.title, description: goal.description } : null,
      ...(task.input || {}),
    });

    const result = await TaskOrchestrator.executeTaskViaAgentChat(agent, message, userId, null, null, null, {
      origin: 'goal_task',
      originId: task.goalId,
    });

    await callPrimary('/complete', {
      body: {
        taskId: task.id,
        status: 'completed',
        result,
        spend: await collectSpend(userId, task.goalId, spendSince),
      },
    });
    state.completed += 1;
    console.log(`[cluster/worker] completed ${task.id} (${task.title})`);
  } catch (error) {
    state.failed += 1;
    state.lastError = error.message;
    console.error(`[cluster/worker] task ${task.id} failed: ${error.message}`);
    // Report the failure rather than going quiet. A worker that dies silently
    // is handled by the lease, but a worker that KNOWS it failed should say so
    // — otherwise the task waits out a full lease for no reason.
    await callPrimary('/complete', {
      body: {
        taskId: task.id,
        status: 'failed',
        error: error.message,
        // A failed task still SPENT. Reporting cost only on success is how a
        // fleet's most expensive failures become invisible.
        spend: await collectSpend(userId, task.goalId, spendSince),
      },
    }).catch(() => {});
  } finally {
    clearInterval(renewal);
  }
}

/**
 * What this task actually cost, read back from the rows this node's own
 * execution already wrote.
 *
 * Measured, not re-derived: AGNT never models cost, it records what the
 * provider reported, and a parallel estimate for remote work would be a second
 * number that drifts from the first. Never throws — a task that ran must be
 * reportable even when its bookkeeping cannot be read.
 */
async function collectSpend(userId, goalId, sinceIso) {
  try {
    const rows = await LlmCallModel.findByOriginSince(userId, 'goal_task', goalId, sinceIso);
    return rows.map((row) => ({ ...row, originId: goalId }));
  } catch (error) {
    console.warn(`[cluster/worker] could not read local spend: ${error.message}`);
    return [];
  }
}

async function pollOnce(userId, consecutiveEmptyPolls) {
  state.polls += 1;

  const response = await callPrimary('/claim', { body: { leaseMs: LEASE_MS } });

  if (response.status === 204) return { worked: false, empty: consecutiveEmptyPolls + 1 };

  if (response.status === 429) {
    // The primary has hit its spend ceiling. This is "not now", not "never":
    // the window resets, so back off on the normal curve and keep asking
    // rather than exiting.
    const detail = await response.json().catch(() => ({}));
    console.warn(`[cluster/worker] primary is not admitting work (${detail.code || 'budget'})`);
    return { worked: false, empty: consecutiveEmptyPolls + 1 };
  }

  if (response.status === 401) {
    // A rejected grant will be rejected identically next second. Backing off
    // hard is the only useful response; hammering a primary that has refused
    // us is the behaviour that gets a worker rate-limited.
    throw Object.assign(new Error('Cluster grant rejected by the primary (401)'), { fatal: true });
  }

  if (!response.ok) throw new Error(`claim failed: HTTP ${response.status}`);

  const assignment = await response.json();
  if (!assignment?.task?.id) return { worked: false, empty: consecutiveEmptyPolls + 1 };

  state.claimed += 1;
  console.log(`[cluster/worker] claimed ${assignment.task.id} (${assignment.task.title})`);
  await runTask(assignment, userId);
  return { worked: true, empty: 0 };
}

/**
 * Start the loop. A no-op unless this process is configured as a worker, so it
 * is safe to call unconditionally from the boot path.
 */
export async function startClusterWorker() {
  if (!isWorker()) return { started: false, reason: 'not a worker node' };
  if (state.running) return { started: false, reason: 'already running' };

  const { primary, token } = config();
  if (!primary || !token) {
    // Refuse loudly. A worker with no primary is a process that will poll
    // nothing forever while looking healthy.
    console.error(
      '[cluster/worker] AGNT_NODE_ROLE=worker but AGNT_CLUSTER_PRIMARY / AGNT_CLUSTER_TOKEN are not set. ' +
        'Mint a grant on the primary with POST /api/cluster/enroll and copy the env block it returns.'
    );
    return { started: false, reason: 'missing primary or token' };
  }

  let userId = null;
  try {
    userId = await localUserId();
  } catch (error) {
    console.error(`[cluster/worker] could not resolve the local user: ${error.message}`);
    return { started: false, reason: 'user resolution failed' };
  }
  if (!userId) {
    // Only reachable when the grant cannot be read at all — a truncated or
    // hand-edited token. The grant is the fix, not a sign-in.
    console.error(
      '[cluster/worker] AGNT_CLUSTER_TOKEN carries no userId and this install has no local user. ' +
        'Re-mint the grant on the primary with POST /api/cluster/enroll.'
    );
    return { started: false, reason: 'no local user' };
  }

  state.running = true;
  state.stopping = false;
  console.log(`[cluster/worker] starting: label=${getNodeLabel()} primary=${primary}`);

  (async () => {
    let empty = 0;
    while (!state.stopping) {
      try {
        const outcome = await pollOnce(userId, empty);
        empty = outcome.empty;
        if (!outcome.worked) await sleep(idleDelay(empty), () => state.stopping);
      } catch (error) {
        state.lastError = error.message;
        console.error(`[cluster/worker] poll failed: ${error.message}`);
        // Fatal (a refused grant) backs off to the ceiling; everything else
        // uses the normal curve, because a primary that is restarting should
        // be waited for, not given up on.
        await sleep(error.fatal ? idleMaxMs() : idleDelay(++empty), () => state.stopping);
      }
    }
    state.running = false;
    console.log('[cluster/worker] stopped');
  })();

  return { started: true };
}

/** Stop after the current task finishes. Never interrupts work in flight. */
export function stopClusterWorker() {
  state.stopping = true;
  return { stopping: true };
}

export function getWorkerStats() {
  return { ...state };
}

/** Interruptible sleep, so a stop request is not held up by a 30s backoff. */
function sleep(ms, shouldAbort) {
  return new Promise((resolve) => {
    const step = Math.min(ms, 500);
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += step;
      if (elapsed >= ms || shouldAbort()) {
        clearInterval(tick);
        resolve();
      }
    }, step);
    if (typeof tick.unref === 'function') tick.unref();
  });
}
