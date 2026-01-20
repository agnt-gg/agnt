import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class GoalEvaluationModel {
  /**
   * Create a new goal evaluation record
   */
  static create(goalId, evaluationType, overallScore, passed, evaluationData, feedback, evaluatedBy = 'system') {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO goal_evaluations (id, goal_id, evaluation_type, overall_score, passed, evaluation_data, feedback, evaluated_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, goalId, evaluationType, overallScore, passed ? 1 : 0, JSON.stringify(evaluationData), feedback, evaluatedBy],
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
      db.get(`SELECT * FROM goal_evaluations WHERE id = ?`, [id], (err, evaluation) => {
        if (err) reject(err);
        else if (evaluation) {
          evaluation.evaluation_data = JSON.parse(evaluation.evaluation_data || '{}');
          evaluation.passed = Boolean(evaluation.passed);
          resolve(evaluation);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Find all evaluations for a goal
   */
  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM goal_evaluations WHERE goal_id = ? ORDER BY evaluated_at DESC`, [goalId], (err, evaluations) => {
        if (err) reject(err);
        else {
          evaluations.forEach((evaluation) => {
            evaluation.evaluation_data = JSON.parse(evaluation.evaluation_data || '{}');
            evaluation.passed = Boolean(evaluation.passed);
          });
          resolve(evaluations);
        }
      });
    });
  }

  /**
   * Get the latest evaluation for a goal
   */
  static findLatestByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM goal_evaluations WHERE goal_id = ? ORDER BY evaluated_at DESC LIMIT 1`, [goalId], (err, evaluation) => {
        if (err) reject(err);
        else if (evaluation) {
          evaluation.evaluation_data = JSON.parse(evaluation.evaluation_data || '{}');
          evaluation.passed = Boolean(evaluation.passed);
          resolve(evaluation);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Delete evaluation
   */
  static delete(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM goal_evaluations WHERE id = ?', [id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default GoalEvaluationModel;
