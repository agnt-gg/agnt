import db from './database/index.js';

class UserModel {
  static getUserStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
          w.totalWorkflows,
          t.totalCustomTools,
          a.totalAgents,
          COALESCE(we.totalExecutions, 0) as totalExecutions,
          COALESCE(we.successfulExecutions, 0) as successfulExecutions,
          COALESCE(we.failedExecutions, 0) as failedExecutions,
          COALESCE(we.startedExecutions, 0) as startedExecutions,
          COALESCE(ne.totalNodeExecutions, 0) as totalNodeExecutions,
          COALESCE(ne.successfulNodeExecutions, 0) as successfulNodeExecutions,
          COALESCE(ne.failedNodeExecutions, 0) as failedNodeExecutions
        FROM
          (SELECT COUNT(*) as totalWorkflows FROM workflows WHERE user_id = ?) w,
          (SELECT COUNT(*) as totalCustomTools FROM tools WHERE created_by = ?) t,
          (SELECT COUNT(*) as totalAgents FROM agents WHERE created_by = ? AND id != 'orchestrator') a,
          (SELECT
            COUNT(*) as totalExecutions,
            SUM(status = 'completed') as successfulExecutions,
            SUM(status = 'error') as failedExecutions,
            SUM(status = 'started') as startedExecutions
          FROM workflow_executions WHERE user_id = ?) we,
          (SELECT
            COUNT(*) as totalNodeExecutions,
            SUM(ne.status = 'completed') as successfulNodeExecutions,
            SUM(ne.status = 'error') as failedNodeExecutions
          FROM node_executions ne
          JOIN workflow_executions e ON ne.execution_id = e.id
          WHERE e.user_id = ?) ne
        `,
        [userId, userId, userId, userId, userId],
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
        `SELECT default_provider as selectedProvider, default_model as selectedModel, custom_instructions as customInstructions
         FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve({
              selectedProvider: row.selectedProvider || 'Anthropic',
              selectedModel: row.selectedModel || 'claude-3-5-sonnet-20240620',
              customInstructions: row.customInstructions || '',
            });
          } else {
            // User not found, return defaults
            resolve({
              selectedProvider: 'Anthropic',
              selectedModel: 'claude-3-5-sonnet-20240620',
              customInstructions: '',
            });
          }
        }
      );
    });
  }

  static updateUserSettings(userId, settings) {
    return new Promise((resolve, reject) => {
      const { selectedProvider, selectedModel, customInstructions } = settings;

      const fields = [];
      const params = [];

      if (selectedProvider !== undefined) {
        // If provider is being changed, always update model too (even to null)
        // to prevent stale model from a different provider lingering in the DB.
        fields.push('default_provider = ?');
        params.push(selectedProvider);
        fields.push('default_model = ?');
        params.push(selectedModel ?? null);
      } else if (selectedModel !== undefined) {
        fields.push('default_model = COALESCE(?, default_model)');
        params.push(selectedModel);
      }

      if (customInstructions !== undefined) {
        fields.push('custom_instructions = ?');
        params.push(customInstructions ? String(customInstructions).trim() : null);
      }

      if (fields.length === 0) {
        return resolve({ changes: 0 });
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);

      const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

      db.run(query, params,
        function (err) {
          if (err) {
            reject(err);
          } else if (this.changes === 0) {
            // User doesn't exist, create with settings
            db.run(
              `INSERT INTO users (id, default_provider, default_model, custom_instructions, created_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                userId,
                selectedProvider || 'Anthropic',
                selectedModel || 'claude-3-5-sonnet-20240620',
                customInstructions ? String(customInstructions).trim() : null,
              ],
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
