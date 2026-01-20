import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class GoldenStandardModel {
  /**
   * Create a new golden standard from a successful goal
   */
  static create(goalId, category, title, description, successScore, templateData, createdBy) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO golden_standards (id, goal_id, category, title, description, success_score, template_data, created_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, goalId, category, title, description, successScore, JSON.stringify(templateData), createdBy],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Find golden standard by ID
   */
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM golden_standards WHERE id = ?`, [id], (err, standard) => {
        if (err) reject(err);
        else if (standard) {
          standard.template_data = JSON.parse(standard.template_data || '{}');
          resolve(standard);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Find all golden standards by category
   */
  static findByCategory(category) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM golden_standards WHERE category = ? ORDER BY success_score DESC`, [category], (err, standards) => {
        if (err) reject(err);
        else {
          standards.forEach((standard) => {
            standard.template_data = JSON.parse(standard.template_data || '{}');
          });
          resolve(standards);
        }
      });
    });
  }

  /**
   * Find all golden standards by user
   */
  static findByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM golden_standards WHERE created_by = ? ORDER BY created_at DESC`, [userId], (err, standards) => {
        if (err) reject(err);
        else {
          standards.forEach((standard) => {
            standard.template_data = JSON.parse(standard.template_data || '{}');
          });
          resolve(standards);
        }
      });
    });
  }

  /**
   * Find all golden standards
   */
  static findAll() {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM golden_standards ORDER BY success_score DESC, created_at DESC`, [], (err, standards) => {
        if (err) reject(err);
        else {
          standards.forEach((standard) => {
            standard.template_data = JSON.parse(standard.template_data || '{}');
          });
          resolve(standards);
        }
      });
    });
  }

  /**
   * Find top golden standards by category
   */
  static findTopByCategory(category, limit = 5) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM golden_standards WHERE category = ? ORDER BY success_score DESC LIMIT ?`, [category, limit], (err, standards) => {
        if (err) reject(err);
        else {
          standards.forEach((standard) => {
            standard.template_data = JSON.parse(standard.template_data || '{}');
          });
          resolve(standards);
        }
      });
    });
  }

  /**
   * Delete golden standard
   */
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM golden_standards WHERE id = ? AND created_by = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default GoldenStandardModel;
