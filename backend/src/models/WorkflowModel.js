import db from './database/index.js';

class WorkflowModel {
  /**
   * Extract denormalized summary fields from workflow_data JSON string.
   * These are stored in separate columns for fast list/summary queries.
   */
  static _extractSummaryFields(workflowDataStr) {
    try {
      const data = JSON.parse(workflowDataStr);
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const nodeSummary = JSON.stringify(nodes.map(n => ({
        type: n.type || '',
        icon: n.icon || n.data?.icon || 'custom',
        label: n.text || n.data?.label || n.type || 'Unknown Tool',
      })));
      return {
        name: data.name || '',
        description: data.description || '',
        category: data.category || '',
        nodeSummary,
      };
    } catch {
      return { name: '', description: '', category: '', nodeSummary: '[]' };
    }
  }

  static async createOrUpdate(id, workflowData, userId, isShareable) {
    try {
      const existingRow = await this.findOne(id);
      const { name, description, category, nodeSummary } = this._extractSummaryFields(workflowData);

      if (!existingRow) {
        return new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO workflows
            (id, workflow_data, user_id, is_shareable, name, description, category, node_summary, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [id, workflowData, userId, isShareable ? 1 : 0, name, description, category, nodeSummary],
            function (err) {
              if (err) reject(err);
              else resolve({ changes: this.changes });
            }
          );
        });
      } else {
        return new Promise((resolve, reject) => {
          db.run(
            `UPDATE workflows
              SET workflow_data = ?,
                  user_id       = ?,
                  is_shareable  = ?,
                  name          = ?,
                  description   = ?,
                  category      = ?,
                  node_summary  = ?,
                  updated_at    = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [workflowData, userId, isShareable ? 1 : 0, name, description, category, nodeSummary, id],
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
    const { name, description, category, nodeSummary } = this._extractSummaryFields(workflowData);
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE workflows
         SET workflow_data = ?, name = ?, description = ?, category = ?, node_summary = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [workflowData, name, description, category, nodeSummary, id, userId],
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
  /**
   * Lightweight summary query — returns only denormalized metadata columns.
   * Skips workflow_data entirely for fast list/summary views.
   */
  static findAllSummaryByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, user_id, name, description, category, node_summary, status, is_shareable, created_at, updated_at
         FROM workflows WHERE user_id = ?`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }
  /**
   * Find workflows by user and status filter.
   * Uses lightweight columns (no workflow_data) for list views.
   */
  static findByUserIdAndStatus(userId, statuses) {
    return new Promise((resolve, reject) => {
      const placeholders = statuses.map(() => '?').join(',');
      const query = `SELECT id, user_id, name, description, category, node_summary, status, is_shareable, created_at, updated_at
                     FROM workflows WHERE user_id = ? AND status IN (${placeholders})`;
      db.all(query, [userId, ...statuses], (err, rows) => {
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
