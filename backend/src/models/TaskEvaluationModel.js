import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class TaskEvaluationModel {
  /**
   * Create a new task evaluation record
   */
  static create(taskId, goalEvaluationId, criteriaMet, score, feedback) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO task_evaluations (id, task_id, goal_evaluation_id, criteria_met, score, feedback) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, taskId, goalEvaluationId, JSON.stringify(criteriaMet), score, feedback],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Find evaluation by ID
   */
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM task_evaluations WHERE id = ?`, [id], (err, evaluation) => {
        if (err) reject(err);
        else if (evaluation) {
          evaluation.criteria_met = JSON.parse(evaluation.criteria_met || '{}');
          resolve(evaluation);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Find all evaluations for a task
   */
  static findByTaskId(taskId) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM task_evaluations WHERE task_id = ? ORDER BY evaluated_at DESC`, [taskId], (err, evaluations) => {
        if (err) reject(err);
        else {
          evaluations.forEach((evaluation) => {
            evaluation.criteria_met = JSON.parse(evaluation.criteria_met || '{}');
          });
          resolve(evaluations);
        }
      });
    });
  }

  /**
   * Find all evaluations for a goal evaluation
   */
  static findByGoalEvaluationId(goalEvaluationId) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM task_evaluations WHERE goal_evaluation_id = ?`, [goalEvaluationId], (err, evaluations) => {
        if (err) reject(err);
        else {
          evaluations.forEach((evaluation) => {
            evaluation.criteria_met = JSON.parse(evaluation.criteria_met || '{}');
          });
          resolve(evaluations);
        }
      });
    });
  }

  /**
   * Delete evaluation
   */
  static delete(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM task_evaluations WHERE id = ?', [id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default TaskEvaluationModel;
