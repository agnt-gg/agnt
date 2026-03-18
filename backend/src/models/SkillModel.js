import db from './database/index.js';

class SkillModel {
  static findAll(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skills WHERE user_id = ? OR is_builtin = 1 ORDER BY updated_at DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM skills WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findByIds(ids) {
    if (!ids || ids.length === 0) return Promise.resolve([]);
    const placeholders = ids.map(() => '?').join(',');
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skills WHERE id IN (${placeholders})`,
        ids,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static createOrUpdate(id, skill, userId) {
    return new Promise((resolve, reject) => {
      const {
        name,
        description,
        instructions = '',
        license = '',
        compatibility = '',
        metadata = '{}',
        allowedTools = '[]',
        icon = '🧩',
        category = 'general',
        isBuiltin = 0,
      } = skill;

      db.run(
        `INSERT OR REPLACE INTO skills (id, user_id, name, description, instructions, license, compatibility, metadata, allowed_tools, icon, category, is_builtin, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, userId, name, description, instructions, license, compatibility, metadata, allowedTools, icon, category, isBuiltin],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM skills WHERE id = ?`,
        [id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default SkillModel;
