import db from './database/index.js';

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
          else resolve(this.lastID);
        }
      );
    });
  }

  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(
        // Order by id, not iteration_number: a goal that re-runs (e.g. on a
        // schedule) restarts numbering at 1 each run, so id is the only
        // chronologically correct ordering.
        `SELECT * FROM goal_iterations WHERE goal_id = ? ORDER BY id ASC`,
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
        `SELECT * FROM goal_iterations WHERE goal_id = ? AND iteration_number = ? ORDER BY id DESC LIMIT 1`,
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
        `SELECT * FROM goal_iterations WHERE goal_id = ? ORDER BY id DESC LIMIT 1`,
        [goalId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? this._parseRow(row) : null);
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
           AND id NOT IN (SELECT id FROM goal_iterations WHERE goal_id = ? ORDER BY id DESC LIMIT ?)
           AND id NOT IN (SELECT id FROM goal_iterations WHERE goal_id = ? ORDER BY evaluation_score DESC, id DESC LIMIT 1)`,
        [goalId, goalId, keep, goalId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static _parseRow(row) {
    return {
      ...row,
      evaluation_passed: !!row.evaluation_passed,
      world_state_snapshot: JSON.parse(row.world_state_snapshot || '{}'),
      replanned_tasks: JSON.parse(row.replanned_tasks || '[]'),
      task_snapshot: row.task_snapshot ? JSON.parse(row.task_snapshot) : null,
    };
  }
}

export default GoalIterationModel;
