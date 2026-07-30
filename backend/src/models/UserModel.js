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

  // Parse the raw fallback_providers TEXT column (a JSON array of
  // { provider, model }) into a clean array. Tolerates NULL, empty, and
  // malformed JSON — all collapse to []. Non-array JSON → [].
  static _parseFallbackProviders(raw) {
    if (raw === null || raw === undefined || raw === '') return [];
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === 'object' && typeof e.provider === 'string' && e.provider.trim())
      .map((e) => ({
        provider: e.provider.trim(),
        model: typeof e.model === 'string' && e.model.trim() ? e.model.trim() : null,
      }))
      .slice(0, 3);
  }

  // Serialize a fallback list for storage. Accepts an array or a pre-stringified
  // JSON string; anything invalid becomes '[]'.
  static _serializeFallbackProviders(value) {
    if (typeof value === 'string') {
      // Validate it round-trips as an array; otherwise store '[]'.
      try { return JSON.stringify(UserModel._parseFallbackProviders(value)); }
      catch { return '[]'; }
    }
    return JSON.stringify(UserModel._parseFallbackProviders(value));
  }

  static getUserSettings(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT default_provider as selectedProvider, default_model as selectedModel, custom_instructions as customInstructions, async_tools_enabled as asyncToolsEnabled, tool_output_cap as toolOutputCap, max_tool_rounds as maxToolRounds, fallback_providers as fallbackProviders, fallback_enabled as fallbackEnabled
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
              // Stored as INTEGER (0/1) in SQLite. Coerce to boolean for the
              // API layer. NULL (legacy rows that pre-date the column) is
              // treated as the documented default — false (off) — since
              // async tool execution is an experimental opt-in capability.
              asyncToolsEnabled: row.asyncToolsEnabled === null || row.asyncToolsEnabled === undefined
                ? false
                : Boolean(row.asyncToolsEnabled),
              // Legacy rows that pre-date the column come back as null —
              // fall back to the documented default (100k chars).
              toolOutputCap: Number.isFinite(row.toolOutputCap) ? row.toolOutputCap : 100000,
              // Legacy rows return null — fall back to the documented default (100).
              maxToolRounds: Number.isFinite(row.maxToolRounds) ? row.maxToolRounds : 100,
              // Cross-provider failover chain. Stored as a JSON array of
              // { provider, model } tiers (TEXT). Legacy/NULL rows → [].
              // Malformed JSON is tolerated and treated as no fallbacks.
              fallbackProviders: UserModel._parseFallbackProviders(row.fallbackProviders),
              // Stored as INTEGER (0/1). NULL (legacy) → false (feature off).
              fallbackEnabled: row.fallbackEnabled === null || row.fallbackEnabled === undefined
                ? false
                : Boolean(row.fallbackEnabled),
            });
          } else {
            // User not found, return defaults
            resolve({
              selectedProvider: 'Anthropic',
              selectedModel: 'claude-3-5-sonnet-20240620',
              customInstructions: '',
              asyncToolsEnabled: false,
              toolOutputCap: 100000,
              maxToolRounds: 100,
              fallbackProviders: [],
              fallbackEnabled: false,
            });
          }
        }
      );
    });
  }

  static updateUserSettings(userId, settings) {
    return new Promise((resolve, reject) => {
      const { selectedProvider, selectedModel, customInstructions, asyncToolsEnabled, toolOutputCap, maxToolRounds, fallbackProviders, fallbackEnabled } = settings;

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

      if (asyncToolsEnabled !== undefined) {
        fields.push('async_tools_enabled = ?');
        params.push(asyncToolsEnabled ? 1 : 0);
      }

      if (toolOutputCap !== undefined) {
        fields.push('tool_output_cap = ?');
        params.push(toolOutputCap);
      }

      if (maxToolRounds !== undefined) {
        fields.push('max_tool_rounds = ?');
        params.push(maxToolRounds);
      }

      if (fallbackProviders !== undefined) {
        // Persist as a JSON string; accept either an array or a pre-stringified
        // value. Invalid input collapses to an empty array so we never write junk.
        fields.push('fallback_providers = ?');
        params.push(UserModel._serializeFallbackProviders(fallbackProviders));
      }

      if (fallbackEnabled !== undefined) {
        fields.push('fallback_enabled = ?');
        params.push(fallbackEnabled ? 1 : 0);
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
              `INSERT INTO users (id, default_provider, default_model, custom_instructions, async_tools_enabled, tool_output_cap, max_tool_rounds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                userId,
                selectedProvider || 'Anthropic',
                selectedModel || 'claude-3-5-sonnet-20240620',
                customInstructions ? String(customInstructions).trim() : null,
                // New rows default to async OFF (experimental opt-in).
                asyncToolsEnabled === undefined ? 0 : (asyncToolsEnabled ? 1 : 0),
                toolOutputCap === undefined ? 100000 : toolOutputCap,
                maxToolRounds === undefined ? 100 : maxToolRounds,
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
