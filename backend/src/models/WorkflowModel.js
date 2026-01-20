import db from './database/index.js';

class WorkflowModel {
  static async createOrUpdate(id, workflowData, userId, isShareable) {
    try {
      // First, see if a row already exists
      const existingRow = await this.findOne(id);

      if (!existingRow) {
        // Insert a brand-new row, do NOT set a status here
        return new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO workflows 
            (id, workflow_data, user_id, is_shareable, updated_at) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [id, workflowData, userId, isShareable ? 1 : 0],
            function (err) {
              if (err) reject(err);
              else resolve({ changes: this.changes });
            }
          );
        });
      } else {
        // Row exists; update workflow_data, user_id, etc., but do NOT touch status
        return new Promise((resolve, reject) => {
          db.run(
            `UPDATE workflows
              SET workflow_data = ?, 
                  user_id       = ?, 
                  is_shareable  = ?, 
                  updated_at    = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [workflowData, userId, isShareable ? 1 : 0, id],
            function (err) {
              if (err) reject(err);
              else resolve({ changes: this.changes });
            }
          );
        });
      }
    } catch (error) {
      throw error;
    }
  }
  static update(id, workflowData, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE workflows SET workflow_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [workflowData, id, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM workflows WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
  static create(id, workflowData, userId) {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [id, workflowData, userId], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }
  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM workflows WHERE user_id = ?', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM workflows WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
  static updateStatus(id, status) {
    return new Promise((resolve, reject) => {
      db.run('UPDATE workflows SET status = ? WHERE id = ?', [status, id], function (err) {
        if (err) {
          console.error(`Error updating workflow status: ${err.message}`);
          reject(err);
        } else {
          console.log(`Workflow ${id} status updated to ${status}`);
          resolve(this.changes);
        }
      });
    });
  }
  static findByStatus(statuses) {
    return new Promise((resolve, reject) => {
      const placeholders = statuses.map(() => '?').join(',');
      db.all(`SELECT * FROM workflows WHERE status IN (${placeholders})`, statuses, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
  static async findByStatusBatch(statuses, limit, offset) {
    return new Promise((resolve, reject) => {
      const placeholders = statuses.map(() => '?').join(',');
      const query = `
        SELECT id, user_id, workflow_data, status
        FROM workflows
        WHERE status IN (${placeholders})
        LIMIT ? OFFSET ?
      `;
      db.all(query, [...statuses, limit, offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

export default WorkflowModel;
