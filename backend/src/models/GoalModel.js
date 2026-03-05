import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class GoalModel {
  static create(title, description, userId, priority = 'medium', successCriteria = {}) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO goals (id, user_id, title, description, priority, success_criteria, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, title, description, priority, JSON.stringify(successCriteria), createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM goals WHERE id = ?`, [id], (err, goal) => {
        if (err) reject(err);
        else if (goal) {
          goal.success_criteria = JSON.parse(goal.success_criteria || '{}');
          goal.world_state = JSON.parse(goal.world_state || '{}');
          resolve(goal);
        } else {
          resolve(null);
        }
      });
    });
  }
  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT g.*, 
         COUNT(t.id) as task_count,
         COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks
         FROM goals g
         LEFT JOIN tasks t ON g.id = t.goal_id
         WHERE g.user_id = ?
         GROUP BY g.id
         ORDER BY g.created_at DESC`,
        [userId],
        (err, goals) => {
          if (err) reject(err);
          else {
            goals.forEach((goal) => {
              goal.success_criteria = JSON.parse(goal.success_criteria || '{}');
            });
            resolve(goals);
          }
        }
      );
    });
  }
  static updateStatus(id, status, completedAt = null) {
    const updatedAt = new Date().toISOString();
    const finalCompletedAt = completedAt || (status === 'completed' || status === 'validated' ? updatedAt : null);
    return new Promise((resolve, reject) => {
      db.run(`UPDATE goals SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`, [status, finalCompletedAt, updatedAt, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
  static updateProgress(id, actualDuration) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE goals SET actual_duration = ? WHERE id = ?`, [actualDuration, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
  static updateWorldState(id, worldState) {
    const updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE goals SET world_state = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(worldState), updatedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateIteration(id, iteration) {
    const updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE goals SET current_iteration = ?, updated_at = ? WHERE id = ?`,
        [iteration, updatedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateLoopStatus(id, loopStatus) {
    const updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE goals SET loop_status = ?, updated_at = ? WHERE id = ?`,
        [loopStatus, updatedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static getWorldState(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT world_state FROM goals WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row ? JSON.parse(row.world_state || '{}') : {});
      });
    });
  }

  static updateMaxIterations(id, maxIterations) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE goals SET max_iterations = ? WHERE id = ?`,
        [maxIterations, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM goals WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default GoalModel;
