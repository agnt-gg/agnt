import db from '../../models/database/index.js';
import LlmCallModel from '../../models/LlmCallModel.js';
import { getNodeLabel, isWorker } from './nodeIdentity.js';

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
const IDLE_MAX_MS = 30000;

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
 * A desktop backend has exactly one user row — the person running the app —
 * which is the same assumption sessionTokenCache asserts and the same one that
 * must be revisited before this is ever multi-tenant.
 */
async function localUserId() {
  if (process.env.AGNT_CLUSTER_WORKER_USER_ID) return process.env.AGNT_CLUSTER_WORKER_USER_ID;
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM users ORDER BY created_at LIMIT 1`, [], (err, row) =>
      err ? reject(err) : resolve(row?.id || null)
    );
  });
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
  const base = Math.min(IDLE_MAX_MS, IDLE_MIN_MS * 2 ** Math.min(consecutiveEmptyPolls, 5));
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

  const userId = await localUserId();
  if (!userId) {
    console.error('[cluster/worker] no local user row — cannot execute tasks. Sign in on this install first.');
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
        await sleep(error.fatal ? IDLE_MAX_MS : idleDelay(++empty), () => state.stopping);
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
