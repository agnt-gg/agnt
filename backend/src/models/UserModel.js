import db from './database/index.js';

class UserModel {
  static getUserStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
          (SELECT COUNT(*) FROM workflows WHERE user_id = ?) as totalWorkflows,
          (SELECT COUNT(*) FROM workflow_executions WHERE user_id = ?) as totalExecutions,
          (SELECT COUNT(*) FROM tools WHERE created_by = ?) as totalCustomTools,
          (SELECT COUNT(*) FROM workflow_executions WHERE user_id = ? AND status = 'completed') as successfulExecutions,
          (SELECT COUNT(*) FROM workflow_executions WHERE user_id = ? AND status = 'error') as failedExecutions,
          (SELECT COUNT(*) FROM workflow_executions WHERE user_id = ? AND status = 'started') as startedExecutions,
          (SELECT COUNT(*) FROM node_executions ne
           JOIN workflow_executions e ON ne.execution_id = e.id
           WHERE e.user_id = ?) as totalNodeExecutions,
          (SELECT COUNT(*) FROM node_executions ne
           JOIN workflow_executions e ON ne.execution_id = e.id
           WHERE e.user_id = ? AND ne.status = 'completed') as successfulNodeExecutions,
          (SELECT COUNT(*) FROM node_executions ne
           JOIN workflow_executions e ON ne.execution_id = e.id
           WHERE e.user_id = ? AND ne.status = 'error') as failedNodeExecutions,
          (SELECT COUNT(*) FROM agents WHERE created_by = ?) as totalAgents
        `,
        [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId],
        (err, row) => {
          if (err) reject(err);
          else {
            row.workflowStatuses = {
              complete: row.successfulExecutions,
              error: row.failedExecutions,
              started: row.startedExecutions,
            };
            resolve(row);
          }
        }
      );
    });
  }

  static getUserSettings(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT default_provider as selectedProvider, default_model as selectedModel 
         FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve({
              selectedProvider: row.selectedProvider || 'Anthropic',
              selectedModel: row.selectedModel || 'claude-3-5-sonnet-20240620',
            });
          } else {
            // User not found, return defaults
            resolve({
              selectedProvider: 'Anthropic',
              selectedModel: 'claude-3-5-sonnet-20240620',
            });
          }
        }
      );
    });
  }

  static updateUserSettings(userId, settings) {
    return new Promise((resolve, reject) => {
      const { selectedProvider, selectedModel } = settings;

      db.run(
        `UPDATE users SET 
         default_provider = COALESCE(?, default_provider),
         default_model = COALESCE(?, default_model),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [selectedProvider, selectedModel, userId],
        function (err) {
          if (err) {
            reject(err);
          } else if (this.changes === 0) {
            // User doesn't exist, create with settings
            db.run(
              `INSERT INTO users (id, default_provider, default_model, created_at) 
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
              [userId, selectedProvider || 'Anthropic', selectedModel || 'claude-3-5-sonnet-20240620'],
              function (insertErr) {
                if (insertErr) {
                  reject(insertErr);
                } else {
                  resolve({ changes: this.changes, created: true });
                }
              }
            );
          } else {
            resolve({ changes: this.changes, updated: true });
          }
        }
      );
    });
  }
}

export default UserModel;
