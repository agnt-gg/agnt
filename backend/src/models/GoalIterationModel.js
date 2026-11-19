import db from './database/index.js';

// Rows are addressed by rowid, never by `id`. A database whose goal_iterations
// table predates the INTEGER PRIMARY KEY schema has `id TEXT PRIMARY KEY`,
// which the insert below never fills, so every row's id is NULL there:
// ordering by it is arbitrary, `id NOT IN (...)` matches nothing (prune
// deleted no row) and `WHERE id = ?` finds no row. rowid exists on both
// schemas, grows with every insert, and IS `id` on the current schema.
const SELECT_ROWS = 'SELECT rowid AS row_id, * FROM goal_iterations';

class GoalIterationModel {
  // How many iteration records to keep per goal (newest first). The
  // best-scoring record is always kept in addition to this window, so
  // revert-to-best keeps working however long a goal has been re-running.
  static RETAIN_PER_GOAL = 25;

  static create(goalId, iterationNumber, evaluationScore, passed, worldState, replannedTasks, durationMs, taskSnapshot = null) {
    const stateJson = JSON.stringify(worldState || {});
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO goal_iterations (goal_id, iteration_number, evaluation_score, evaluation_passed, world_state_snapshot, replanned_tasks, task_snapshot, duration_ms, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          goalId,
          iterationNumber,
          evaluationScore,
          passed ? 1 : 0,
          stateJson,
          JSON.stringify(replannedTasks || []),
          taskSnapshot ? JSON.stringify(taskSnapshot) : null,
          durationMs,
          stateJson, // Legacy 'state' column (NOT NULL in older databases)
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID); // the rowid on every schema
        }
      );
    });
  }

  /**
   * Attach the re-plan an iteration produced. The iteration row is written
   * when the work is graded, before re-planning rewrites the tasks, so the
   * graded state survives a pause or failure during the re-plan.
   * @param {number} id  the value create() resolved with
   */
  static setReplannedTasks(id, replannedTasks) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE goal_iterations SET replanned_tasks = ? WHERE rowid = ?`,
        [JSON.stringify(replannedTasks || []), id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(
        // Insertion order, not iteration_number: a goal that re-runs (e.g. on
        // a schedule) restarts numbering at 1 each run.
        `${SELECT_ROWS} WHERE goal_id = ? ORDER BY rowid ASC`,
        [goalId],
        (err, rows) => {
          if (err) reject(err);
          else {
            resolve((rows || []).map((row) => this._parseRow(row)));
          }
        }
      );
    });
  }

  static findOne(goalId, iterationNumber) {
    return new Promise((resolve, reject) => {
      db.get(
        // Iteration numbers repeat across runs; take the most recent occurrence.
        `${SELECT_ROWS} WHERE goal_id = ? AND iteration_number = ? ORDER BY rowid DESC LIMIT 1`,
        [goalId, iterationNumber],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? this._parseRow(row) : null);
        }
      );
    });
  }

  static getLatest(goalId) {
    return new Promise((resolve, reject) => {
      db.get(
        `${SELECT_ROWS} WHERE goal_id = ? ORDER BY rowid DESC LIMIT 1`,
        [goalId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? this._parseRow(row) : null);
        }
      );
    });
  }

  /**
   * The goal's tasks as the first recorded iteration found them, or null when
   * nothing is on record. Snapshots are taken before re-planning, so the
   * first one holds each task as it was planned.
   * @returns {Promise<Array<object>|null>}
   */
  static earliestTaskSnapshot(goalId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT task_snapshot FROM goal_iterations WHERE goal_id = ? AND task_snapshot IS NOT NULL ORDER BY rowid ASC LIMIT 1`,
        [goalId],
        (err, row) => {
          if (err) return reject(err);
          if (!row?.task_snapshot) return resolve(null);
          try {
            const snapshot = JSON.parse(row.task_snapshot);
            resolve(Array.isArray(snapshot) ? snapshot : null);
          } catch {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Delete old iteration records, keeping the newest RETAIN_PER_GOAL rows
   * plus the best-scoring row (whatever its age). Without this, a goal that
   * re-runs on a schedule accumulates snapshot rows forever.
   */
  static prune(goalId, keep = GoalIterationModel.RETAIN_PER_GOAL) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM goal_iterations
         WHERE goal_id = ?
           AND rowid NOT IN (SELECT rowid FROM goal_iterations WHERE goal_id = ? ORDER BY rowid DESC LIMIT ?)
           AND rowid NOT IN (SELECT rowid FROM goal_iterations WHERE goal_id = ? ORDER BY evaluation_score DESC, rowid DESC LIMIT 1)`,
        [goalId, goalId, keep, goalId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static _parseRow(row) {
    const { row_id: rowId, ...columns } = row;
    return {
      ...columns,
      id: columns.id ?? rowId ?? null,
      evaluation_passed: !!columns.evaluation_passed,
      world_state_snapshot: JSON.parse(columns.world_state_snapshot || '{}'),
      replanned_tasks: JSON.parse(columns.replanned_tasks || '[]'),
      task_snapshot: columns.task_snapshot ? JSON.parse(columns.task_snapshot) : null,
    };
  }
}

export default GoalIterationModel;
