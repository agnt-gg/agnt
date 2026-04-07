import db from './database/index.js';

class GroupModel {
  static create(id, userId, name, description = null, color = '#6366f1', sortOrder = 0, parentId = null) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO groups (id, user_id, name, description, color, sort_order, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, description, color, sortOrder, parentId],
        function (err) {
          if (err) reject(err);
          else resolve({ id, changes: this.changes });
        }
      );
    });
  }

  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT g.*, COUNT(co.id) as conversation_count
         FROM groups g
         LEFT JOIN content_outputs co ON co.group_id = g.id
         WHERE g.user_id = ?
         GROUP BY g.id
         ORDER BY g.name COLLATE NOCASE ASC`,
        [userId],
        (err, groups) => {
          if (err) reject(err);
          else resolve(groups || []);
        }
      );
    });
  }

  static findOne(id, userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM groups WHERE id = ? AND user_id = ?', [id, userId], (err, group) => {
        if (err) reject(err);
        else resolve(group);
      });
    });
  }

  static update(id, userId, fields) {
    const allowed = ['name', 'description', 'color', 'sort_order', 'parent_id'];
    const sets = [];
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
      if (allowed.includes(key) && value !== undefined) {
        sets.push(`${key} = ?`);
        values.push(value === null ? null : value);
      }
    }

    if (sets.length === 0) return Promise.resolve({ changes: 0 });

    sets.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE groups SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
        values,
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      // ON DELETE CASCADE removes child groups
      // ON DELETE SET NULL on content_outputs.group_id ungroups conversations
      db.run('DELETE FROM groups WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  // Get all descendant group IDs (for moving children before delete)
  static findDescendantIds(id, userId) {
    return new Promise((resolve, reject) => {
      // Recursive CTE to find all descendants
      db.all(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM groups WHERE parent_id = ? AND user_id = ?
           UNION ALL
           SELECT g.id FROM groups g INNER JOIN descendants d ON g.parent_id = d.id
         )
         SELECT id FROM descendants`,
        [id, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []).map(r => r.id));
        }
      );
    });
  }

  // Move children to a new parent (or root) before deleting
  static reparentChildren(id, userId, newParentId = null) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE groups SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ? AND user_id = ?',
        [newParentId, id, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  static updateSortOrder(userId, groupOrders) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        const stmt = db.prepare('UPDATE groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?');
        for (const { id, sort_order } of groupOrders) {
          stmt.run(sort_order, id, userId);
        }
        stmt.finalize((err) => {
          if (err) reject(err);
          else resolve({ success: true });
        });
      });
    });
  }
}

export default GroupModel;
