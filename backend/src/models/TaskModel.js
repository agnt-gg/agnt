import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class TaskModel {
  static create(goalId, title, description, requiredTools = [], dependencies = [], orderIndex = 0, parentTaskId = null) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tasks (id, goal_id, parent_task_id, title, description, required_tools, dependencies, order_index, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, goalId, parentTaskId, title, description, JSON.stringify(requiredTools), JSON.stringify(dependencies), orderIndex, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT t.*, a.name as agent_name 
         FROM tasks t
         LEFT JOIN agents a ON t.agent_id = a.id
         WHERE t.goal_id = ?
         ORDER BY t.order_index, t.created_at`,
        [goalId],
        (err, tasks) => {
          if (err) reject(err);
          else {
            tasks.forEach((task) => {
              task.required_tools = JSON.parse(task.required_tools || '[]');
              task.dependencies = JSON.parse(task.dependencies || '[]');
            });
            resolve(tasks);
          }
        }
      );
    });
  }

  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT t.*, a.name as agent_name, w.workflow_data
         FROM tasks t
         LEFT JOIN agents a ON t.agent_id = a.id
         LEFT JOIN workflows w ON t.workflow_id = w.id
         WHERE t.id = ?`,
        [id],
        (err, task) => {
          if (err) reject(err);
          else if (task) {
            task.required_tools = JSON.parse(task.required_tools || '[]');
            task.dependencies = JSON.parse(task.dependencies || '[]');
            if (task.workflow_data) {
              task.workflow = JSON.parse(task.workflow_data);
            }
            resolve(task);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  static assignAgent(taskId, agentId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE tasks SET agent_id = ?, status = 'assigned' WHERE id = ?`, [agentId, taskId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static assignWorkflow(taskId, workflowId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE tasks SET workflow_id = ? WHERE id = ?`, [workflowId, taskId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static updateStatus(taskId, status, progress = null, startedAt = null, completedAt = null, input = null, output = null, error = null) {
    return new Promise((resolve, reject) => {
      const updatedAt = new Date().toISOString();
      let query = `UPDATE tasks SET status = ?, updated_at = ?`;
      let params = [status, updatedAt];

      if (progress !== null) {
        query += `, progress = ?`;
        params.push(progress);
      }
      if (startedAt) {
        query += `, started_at = ?`;
        params.push(startedAt);
      } else if (status === 'executing' || status === 'running') {
        // Auto-set started_at if not provided and status is executing/running
        query += `, started_at = ?`;
        params.push(updatedAt);
      }
      if (completedAt) {
        query += `, completed_at = ?`;
        params.push(completedAt);
      } else if (status === 'completed') {
        // Auto-set completed_at if not provided and status is completed
        query += `, completed_at = ?`;
        params.push(updatedAt);
      }
      if (input !== null) {
        query += `, input = ?`;
        params.push(JSON.stringify(input));
      }
      if (output !== null) {
        query += `, output = ?`;
        params.push(JSON.stringify(output));
      }
      if (error !== null) {
        query += `, error = ?`;
        params.push(error);
      }

      query += ` WHERE id = ?`;
      params.push(taskId);

      db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  /**
   * Restore tasks to a previously captured snapshot (revert-to-iteration).
   * Only touches tasks present in the snapshot; matches on task id AND goal id
   * so a stale snapshot can never write into another goal's tasks. Output is
   * written back verbatim — it was captured as stored (already serialized).
   */
  static async restoreSnapshot(goalId, snapshot) {
    const tasks = Array.isArray(snapshot) ? snapshot : [];
    const updatedAt = new Date().toISOString();
    let restored = 0;
    for (const t of tasks) {
      restored += await new Promise((resolve, reject) => {
        db.run(
          `UPDATE tasks SET title = ?, description = ?, status = ?, progress = ?, output = ?, error = ?, updated_at = ? WHERE id = ? AND goal_id = ?`,
          [t.title, t.description, t.status, t.progress || 0, t.output ?? null, t.error ?? null, updatedAt, t.id, goalId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
    }
    return restored;
  }

  static findPendingTasks() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT t.*, g.user_id 
         FROM tasks t
         JOIN goals g ON t.goal_id = g.id
         WHERE t.status = 'pending' AND g.status = 'executing'
         ORDER BY t.order_index`,
        [],
        (err, tasks) => {
          if (err) reject(err);
          else {
            tasks.forEach((task) => {
              task.required_tools = JSON.parse(task.required_tools || '[]');
              task.dependencies = JSON.parse(task.dependencies || '[]');
            });
            resolve(tasks);
          }
        }
      );
    });
  }

  static canExecuteTask(taskId) {
    return new Promise((resolve, reject) => {
      // Check if all dependencies are completed
      db.get(
        `SELECT t.dependencies, 
         (SELECT COUNT(*) FROM tasks dep WHERE dep.id IN (
           SELECT json_each.value FROM json_each(t.dependencies)
         ) AND dep.status != 'completed') as incomplete_deps
         FROM tasks t WHERE t.id = ?`,
        [taskId],
        (err, result) => {
          if (err) return reject(err);
          // A missing row used to be a TypeError: db.get yields undefined when
          // nothing matches, and `result.incomplete_deps` then throws inside a
          // Promise executor, i.e. an unhandled rejection rather than a
          // decision. It is reachable whenever a task is deleted while its
          // goal is mid-flight — a re-plan does exactly that. A task that does
          // not exist cannot be executed, so the honest answer is false.
          if (!result) return resolve(false);
          resolve(result.incomplete_deps === 0);
        }
      );
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CLAIMING
  //
  // A claim is a LEASE, not a lock. Nothing here needs a heartbeat, a liveness
  // detector, or an operator: a node that stops renewing stops owning, and the
  // only clock involved is the one already in the row.
  //
  // Every method below decides by `this.changes`, never by a preceding SELECT.
  // Reading a row and then writing it is two statements with a gap in between,
  // and two nodes will both read "unclaimed" in that gap. The conditional
  // UPDATE has no gap — sqlite applies it atomically, so exactly one caller
  // can observe changes === 1. This is the same shape SeatModel.reserveSeat
  // uses on the API to hand out a founding seat exactly once.
  // ───────────────────────────────────────────────────────────────────────────

  /** How long a claim is valid without renewal. */
  static DEFAULT_LEASE_MS = 120000;

  /**
   * Statuses a claim may be taken on.
   *
   * Deliberately "anything not finished" rather than "pending": the local
   * orchestrator dispatches tasks that a previous partial run left as
   * 'assigned', and requiring 'pending' here would silently skip them —
   * changing single-node behaviour, which this whole change must not do.
   * Terminal states are excluded because re-running finished work is the
   * failure, not the fix.
   */
  static CLAIMABLE_STATUSES = ['pending', 'assigned', 'running', 'needs_review'];

  /**
   * Take (or re-take) the claim on one specific task.
   *
   * Claimable when nobody holds it, when the holder's lease has lapsed, or —
   * in re-entrant mode only — when THIS node already holds it. A row with a
   * holder but a NULL expiry is malformed and treated as claimable, because
   * the alternative is a task that is unreachable forever.
   *
   * ---------------------------------------------------------------------------
   * WHY RE-ENTRANCY IS AN OPTION AND NOT A PROPERTY
   * ---------------------------------------------------------------------------
   * A node id identifies a MACHINE, not a process, and the two stop being the
   * same thing the moment an operator does the thing the docs invite: copy one
   * enrolment env block into a second container to add capacity. Both
   * containers then present the same grant, so both are `node_abc`.
   *
   * With unconditional re-entrancy that is a double execution, and it was
   * MEASURED, not theorised — a four-way live race against six tasks produced
   * twelve claims and left every row at attempt_count = 2. Both processes
   * shortlisted the same task, the first UPDATE took it, and the second matched
   * `claimed_by = ?` against its own id and took it again. The guard that makes
   * the claim safe was being satisfied by the claimant itself.
   *
   * The two callers genuinely want different answers:
   *
   *   PULL PATH (claimNext, cluster workers) — STRICT.
   *     Concurrency is the entire point, and a second process sharing an id is
   *     an ordinary deployment rather than a mistake. A live lease means
   *     somebody is working, and "somebody" must include us.
   *
   *   LOCAL DISPATCH (TaskOrchestrator) — RE-ENTRANT.
   *     One process, one goal loop, claims taken sequentially in a for-loop, so
   *     there is no concurrent claimant to protect against. What re-entrancy
   *     buys is RESUME: kill AGNT mid-task and restart it inside the lease
   *     window and the goal picks up immediately instead of stalling until a
   *     lease it owns expires.
   *
   * Default is re-entrant so the safe-but-blocking behaviour is never silently
   * acquired by an existing caller; the path that needs strictness asks for it.
   *
   * @param {string} taskId
   * @param {string} nodeId
   * @param {number} [leaseMs]
   * @param {object} [options]
   * @param {boolean} [options.reentrant=true]  allow re-taking our own live claim
   * @returns {Promise<boolean>} true when this node now owns the task
   */
  static claim(taskId, nodeId, leaseMs = TaskModel.DEFAULT_LEASE_MS, options = {}) {
    const { reentrant = true } = options;
    const now = Date.now();
    const placeholders = TaskModel.CLAIMABLE_STATUSES.map(() => '?').join(', ');

    // The ONLY difference between the two modes. Building the SQL rather than
    // branching into two near-identical statements keeps the rest of the guard
    // — status, expiry, malformed-row handling — impossible to fork by accident.
    const ownClaim = reentrant ? 'OR claimed_by = ?' : '';
    const params = reentrant
      ? [nodeId, now + leaseMs, taskId, ...TaskModel.CLAIMABLE_STATUSES, nodeId, now]
      : [nodeId, now + leaseMs, taskId, ...TaskModel.CLAIMABLE_STATUSES, now];

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE tasks
            SET claimed_by = ?,
                claim_expires_at = ?,
                attempt_count = COALESCE(attempt_count, 0) + 1
          WHERE id = ?
            AND status IN (${placeholders})
            AND (claimed_by IS NULL
                 ${ownClaim}
                 OR claim_expires_at IS NULL
                 OR claim_expires_at < ?)`,
        params,
        function (err) {
          if (err) reject(err);
          else resolve(this.changes === 1);
        }
      );
    });
  }

  /**
   * Claim the next available task, or null when there is nothing to do.
   *
   * This is the PULL side: a worker asks for work rather than being sent it.
   * That is what makes adding a node zero-configuration — a new process points
   * at the ledger and starts claiming, and no scheduler has to learn it
   * exists.
   *
   * Candidates are read first and then claimed one at a time. The SELECT is
   * only a shortlist and is allowed to be stale; the UPDATE is what decides.
   * Losing a race is expected under contention, not an error — the loop simply
   * moves to the next candidate.
   *
   * @param {string} nodeId
   * @param {object} [options]
   * @param {number} [options.leaseMs]
   * @param {string|null} [options.goalId]      restrict to one goal
   * @param {string|null} [options.userId]      restrict to one owner's goals
   * @param {number} [options.maxAttempts=5]    poison-task ceiling
   * @param {number} [options.candidates=5]     shortlist size
   * @returns {Promise<object|null>}
   */
  static async claimNext(nodeId, options = {}) {
    const {
      leaseMs = TaskModel.DEFAULT_LEASE_MS,
      goalId = null,
      userId = null,
      maxAttempts = 5,
      candidates = 5,
    } = options;
    const now = Date.now();

    // userId is scoping, not a filter of convenience: a node grant is issued
    // to ONE account, and the join to goals.user_id is the only thing keeping
    // a worker from picking up work that is not its owner's. Applied in SQL
    // rather than after the fact so no code path can forget it.
    const params = [maxAttempts, now];
    let scope = '';
    if (userId) {
      scope += ' AND g.user_id = ?';
      params.push(userId);
    }
    if (goalId) {
      scope += ' AND t.goal_id = ?';
      params.push(goalId);
    }
    params.push(candidates);

    const shortlist = await new Promise((resolve, reject) => {
      db.all(
        `SELECT t.id
           FROM tasks t
           JOIN goals g ON t.goal_id = g.id
          WHERE t.status = 'pending'
            AND g.status = 'executing'
            AND COALESCE(t.attempt_count, 0) < ?
            AND (t.claimed_by IS NULL OR t.claim_expires_at IS NULL OR t.claim_expires_at < ?)
            ${scope}
          ORDER BY t.order_index, t.created_at
          LIMIT ?`,
        params,
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    for (const { id } of shortlist) {
      // Dependencies are checked BEFORE the claim: claiming a blocked task
      // would burn one of its attempts and hold it away from the node that
      // could legitimately run it later.
      if (!(await TaskModel.canExecuteTask(id))) continue;
      // STRICT: see claim(). Two processes may legitimately share one node id
      // (the same grant copied into a second container), and re-entrancy would
      // let the second one take a task the first is already running.
      if (await TaskModel.claim(id, nodeId, leaseMs, { reentrant: false })) {
        return TaskModel.findOne(id);
      }
    }
    return null;
  }

  /**
   * Extend a claim this node already holds.
   *
   * Scoped to `claimed_by = ?` so a node can never extend someone else's
   * lease. Returns false once the claim has been lost, which is the signal to
   * stop working rather than to renew harder.
   *
   * @returns {Promise<boolean>}
   */
  static renewClaim(taskId, nodeId, leaseMs = TaskModel.DEFAULT_LEASE_MS) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE tasks SET claim_expires_at = ? WHERE id = ? AND claimed_by = ?`,
        [Date.now() + leaseMs, taskId, nodeId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes === 1);
        }
      );
    });
  }

  /**
   * Give a claim back immediately instead of waiting out the lease.
   *
   * Purely an optimisation: everything stays correct if this never runs,
   * because the lease expires anyway. It exists so an orderly failure returns
   * work to the fleet in milliseconds rather than minutes.
   *
   * @returns {Promise<boolean>}
   */
  static releaseClaim(taskId, nodeId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE tasks SET claimed_by = NULL, claim_expires_at = NULL WHERE id = ? AND claimed_by = ?`,
        [taskId, nodeId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes === 1);
        }
      );
    });
  }

  /**
   * Return abandoned work to the queue.
   *
   * A node that dies mid-task leaves the row 'running' with a lease nobody
   * renews. Nothing else would ever look at it again: the pull query only
   * considers 'pending'. This is the one place that reclassifies such a row,
   * and it is why a crash needs no operator.
   *
   * Only ever touches rows whose lease has DEMONSTRABLY lapsed. Terminal and
   * deliberately-halted states are excluded — resurrecting a paused task would
   * be this function overruling a human.
   *
   * @returns {Promise<number>} rows returned to 'pending'
   */
  static reapExpiredClaims(now = Date.now()) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE tasks
            SET status = 'pending',
                claimed_by = NULL,
                claim_expires_at = NULL,
                updated_at = ?
          WHERE claimed_by IS NOT NULL
            AND claim_expires_at IS NOT NULL
            AND claim_expires_at < ?
            AND status IN ('running', 'assigned')`,
        [new Date().toISOString(), now],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default TaskModel;
