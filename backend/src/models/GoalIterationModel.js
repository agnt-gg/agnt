import db from './database/index.js';

class GoalIterationModel {
  static create(goalId, iterationNumber, evaluationScore, passed, worldState, replannedTasks, gitHash, durationMs) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO goal_iterations (goal_id, iteration_number, evaluation_score, evaluation_passed, world_state_snapshot, replanned_tasks, git_commit_hash, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          goalId,
          iterationNumber,
          evaluationScore,
          passed ? 1 : 0,
          JSON.stringify(worldState || {}),
          JSON.stringify(replannedTasks || []),
          gitHash,
          durationMs,
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
        `SELECT * FROM goal_iterations WHERE goal_id = ? ORDER BY iteration_number ASC`,
        [goalId],
        (err, rows) => {
          if (err) reject(err);
          else {
            resolve(
              (rows || []).map((row) => ({
                ...row,
                evaluation_passed: !!row.evaluation_passed,
                world_state_snapshot: JSON.parse(row.world_state_snapshot || '{}'),
                replanned_tasks: JSON.parse(row.replanned_tasks || '[]'),
              }))
            );
          }
        }
      );
    });
  }

  static findOne(goalId, iterationNumber) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM goal_iterations WHERE goal_id = ? AND iteration_number = ?`,
        [goalId, iterationNumber],
        (err, row) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              ...row,
              evaluation_passed: !!row.evaluation_passed,
              world_state_snapshot: JSON.parse(row.world_state_snapshot || '{}'),
              replanned_tasks: JSON.parse(row.replanned_tasks || '[]'),
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  static getLatest(goalId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM goal_iterations WHERE goal_id = ? ORDER BY iteration_number DESC LIMIT 1`,
        [goalId],
        (err, row) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              ...row,
              evaluation_passed: !!row.evaluation_passed,
              world_state_snapshot: JSON.parse(row.world_state_snapshot || '{}'),
              replanned_tasks: JSON.parse(row.replanned_tasks || '[]'),
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }
}

export default GoalIterationModel;
