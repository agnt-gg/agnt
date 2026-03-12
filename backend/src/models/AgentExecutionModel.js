import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

// Helper function to retry database operations on SQLITE_BUSY
const retryOnBusy = (operation, maxRetries = 3, delay = 100) => {
  return new Promise((resolve, reject) => {
    const attempt = (retriesLeft) => {
      operation()
        .then(resolve)
        .catch((err) => {
          if (err.code === 'SQLITE_BUSY' && retriesLeft > 0) {
            console.log(`[AgentExecution] Database busy, retrying in ${delay}ms... (${retriesLeft} retries left)`);
            setTimeout(() => attempt(retriesLeft - 1), delay);
          } else {
            reject(err);
          }
        });
    };
    attempt(maxRetries);
  });
};

class AgentExecutionModel {
  /**
   * Create a new agent execution record
   */
  static create(userId, agentId, agentName, conversationId, initialPrompt, provider, model, status = 'running') {
    const id = generateUUID();
    const startTime = new Date().toISOString();

    const operation = () =>
      new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO agent_executions
           (id, agent_id, agent_name, user_id, conversation_id, status, start_time, initial_prompt, provider, model)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, agentId, agentName, userId, conversationId, status, startTime, initialPrompt, provider, model],
          function (err) {
            if (err) reject(err);
            else resolve(id);
          }
        );
      });

    return retryOnBusy(operation);
  }

  /**
   * Update an agent execution record
   * @param {object} [tokenUsage] - Optional token usage { inputTokens, outputTokens, totalTokens, estimatedCost }
   */
  static update(id, status, finalResponse, creditsUsed, toolCallsCount, error = null, tokenUsage = null) {
    return new Promise((resolve, reject) => {
      const safeStatus = status || 'stopped';
      const endTime = ['completed', 'failed', 'stopped', 'error'].includes(safeStatus)
        ? new Date().toISOString()
        : null;

      if (tokenUsage) {
        db.run(
          `UPDATE agent_executions
           SET status = ?, final_response = ?, end_time = ?, credits_used = ?, tool_calls_count = ?, error = ?,
               input_tokens = ?, output_tokens = ?, total_tokens = ?, estimated_cost = ?
           WHERE id = ?`,
          [safeStatus, finalResponse, endTime, creditsUsed, toolCallsCount, error,
           tokenUsage.inputTokens || 0, tokenUsage.outputTokens || 0, tokenUsage.totalTokens || 0, tokenUsage.estimatedCost || 0, id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      } else {
        db.run(
          `UPDATE agent_executions
           SET status = ?, final_response = ?, end_time = ?, credits_used = ?, tool_calls_count = ?, error = ?
           WHERE id = ?`,
          [safeStatus, finalResponse, endTime, creditsUsed, toolCallsCount, error, id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      }
    });
  }

  /**
   * Update just the status of an execution
   */
  static updateStatus(id, status) {
    return new Promise((resolve, reject) => {
      const updateFields = { status };
      if (['completed', 'failed', 'stopped', 'error'].includes(status)) {
        db.run(
          'UPDATE agent_executions SET status = ?, end_time = ? WHERE id = ?',
          [status, new Date().toISOString(), id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      } else {
        db.run(
          'UPDATE agent_executions SET status = ? WHERE id = ?',
          [status, id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      }
    });
  }

  /**
   * Create a new tool execution record within an agent execution
   */
  static createToolExecution(executionId, toolName, toolCallId, input) {
    const id = generateUUID();
    const startTime = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO agent_tool_executions
         (id, execution_id, tool_name, tool_call_id, status, input, start_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, executionId, toolName, toolCallId, 'started', JSON.stringify(input), startTime],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Update a tool execution record
   * @param {object} [tokenUsage] - Optional { inputTokens, outputTokens }
   */
  static updateToolExecution(id, status, output, error, creditsUsed = 0, tokenUsage = null) {
    const endTime = new Date().toISOString();
    return new Promise((resolve, reject) => {
      if (tokenUsage) {
        db.run(
          `UPDATE agent_tool_executions
           SET status = ?, output = ?, error = ?, end_time = ?, credits_used = ?,
               input_tokens = ?, output_tokens = ?
           WHERE id = ?`,
          [status, JSON.stringify(output), error, endTime, creditsUsed,
           tokenUsage.inputTokens || 0, tokenUsage.outputTokens || 0, id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      } else {
        db.run(
          `UPDATE agent_tool_executions
           SET status = ?, output = ?, error = ?, end_time = ?, credits_used = ?
           WHERE id = ?`,
          [status, JSON.stringify(output), error, endTime, creditsUsed, id],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      }
    });
  }

  /**
   * Get all agent executions for a user (summary only for list view)
   */
  static getExecutions(userId, { startDate, endDate } = {}) {
    const dateFilter = startDate
      ? `AND ae.start_time >= ? AND ae.start_time <= ?`
      : `AND ae.start_time >= datetime('now', '-7 days')`;
    const params = startDate ? [userId, startDate, endDate] : [userId];

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT ae.id, ae.agent_id, ae.agent_name, ae.start_time, ae.end_time, ae.status,
                ae.credits_used, ae.tool_calls_count, ae.provider, ae.model,
                ae.input_tokens, ae.output_tokens, ae.total_tokens, ae.estimated_cost
         FROM agent_executions ae
         WHERE ae.user_id = ? ${dateFilter}
         ORDER BY ae.start_time DESC
         LIMIT 10000`,
        params,
        (err, rows) => {
          if (err) reject(err);
          else {
            const executions = rows.map((row) => ({
              id: row.id,
              agentId: row.agent_id,
              agentName: row.agent_name || 'Orchestrator',
              startTime: row.start_time,
              endTime: row.end_time,
              status: row.status,
              creditsUsed: row.credits_used || 0,
              toolCallsCount: row.tool_calls_count || 0,
              provider: row.provider,
              model: row.model,
              inputTokens: row.input_tokens || 0,
              outputTokens: row.output_tokens || 0,
              totalTokens: row.total_tokens || 0,
              estimatedCost: row.estimated_cost || 0,
              type: 'agent', // Mark as agent execution for frontend
            }));
            resolve(executions);
          }
        }
      );
    });
  }

  /**
   * Get detailed agent execution with tool executions
   */
  static async getExecutionDetails(executionId) {
    const execQuery = new Promise((resolve, reject) => {
      db.get(
        `SELECT ae.id, ae.agent_id, ae.agent_name, ae.user_id, ae.conversation_id,
                ae.start_time, ae.end_time, ae.status, ae.credits_used, ae.tool_calls_count,
                ae.initial_prompt, ae.final_response, ae.error, ae.provider, ae.model,
                ae.input_tokens, ae.output_tokens, ae.total_tokens, ae.estimated_cost
         FROM agent_executions ae
         WHERE ae.id = ?`,
        [executionId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    const toolsQuery = new Promise((resolve, reject) => {
      db.all(
        `SELECT id, tool_name, tool_call_id, start_time, end_time, status, input, output, error, credits_used,
                input_tokens, output_tokens
         FROM agent_tool_executions
         WHERE execution_id = ?
         ORDER BY start_time`,
        [executionId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    const [execution, toolExecutions] = await Promise.all([execQuery, toolsQuery]);
    if (!execution) return null;

    const safeParse = (str) => { try { return JSON.parse(str); } catch { return str; } };
    const totalCreditsUsed = toolExecutions.reduce((sum, te) => sum + (te.credits_used || 0), 0);

    return {
      id: execution.id,
      agentId: execution.agent_id,
      agentName: execution.agent_name || 'Orchestrator',
      conversationId: execution.conversation_id,
      startTime: execution.start_time,
      endTime: execution.end_time,
      status: execution.status,
      creditsUsed: totalCreditsUsed || execution.credits_used || 0,
      toolCallsCount: execution.tool_calls_count,
      initialPrompt: execution.initial_prompt,
      finalResponse: execution.final_response,
      error: execution.error,
      provider: execution.provider,
      model: execution.model,
      inputTokens: execution.input_tokens || 0,
      outputTokens: execution.output_tokens || 0,
      totalTokens: execution.total_tokens || 0,
      estimatedCost: execution.estimated_cost || 0,
      type: 'agent',
      toolExecutions: toolExecutions.map((te) => ({
        id: te.id,
        toolName: te.tool_name,
        toolCallId: te.tool_call_id,
        startTime: te.start_time,
        endTime: te.end_time,
        status: te.status,
        input: te.input ? safeParse(te.input) : null,
        output: te.output ? safeParse(te.output) : null,
        error: te.error,
        creditsUsed: te.credits_used || 0,
        inputTokens: te.input_tokens || 0,
        outputTokens: te.output_tokens || 0,
      })),
    };
  }

  /**
   * Get tool execution by tool_call_id (for updating during execution)
   */
  static getToolExecutionByCallId(executionId, toolCallId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM agent_tool_executions WHERE execution_id = ? AND tool_call_id = ?`,
        [executionId, toolCallId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  /**
   * Delete an agent execution and its tool executions
   */
  static delete(executionId, userId) {
    return new Promise((resolve, reject) => {
      // First verify ownership
      db.get(
        'SELECT id FROM agent_executions WHERE id = ? AND user_id = ?',
        [executionId, userId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          if (!row) {
            resolve(0); // Not found or not owned
            return;
          }

          // Delete tool executions first (foreign key constraint)
          db.run(
            'DELETE FROM agent_tool_executions WHERE execution_id = ?',
            [executionId],
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Then delete the agent execution
              db.run(
                'DELETE FROM agent_executions WHERE id = ?',
                [executionId],
                function (err) {
                  if (err) reject(err);
                  else resolve(this.changes);
                }
              );
            }
          );
        }
      );
    });
  }

  /**
   * Clear all completed agent executions for a user
   */
  static clearCompleted(userId) {
    return new Promise((resolve, reject) => {
      // Get IDs of completed executions
      db.all(
        `SELECT id FROM agent_executions WHERE user_id = ? AND status IN ('completed', 'stopped')`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const executionIds = rows.map((r) => r.id);
          if (executionIds.length === 0) {
            resolve(0);
            return;
          }

          const placeholders = executionIds.map(() => '?').join(',');

          // Delete tool executions first
          db.run(
            `DELETE FROM agent_tool_executions WHERE execution_id IN (${placeholders})`,
            executionIds,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Then delete agent executions
              db.run(
                `DELETE FROM agent_executions WHERE id IN (${placeholders})`,
                executionIds,
                function (err) {
                  if (err) reject(err);
                  else resolve(this.changes);
                }
              );
            }
          );
        }
      );
    });
  }

  /**
   * Get agent activity data for analytics
   */
  static getAgentActivityData(userId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT
          DATE(start_time) as date,
          SUM(credits_used) as credits_used,
          COUNT(*) as execution_count
        FROM agent_executions
        WHERE user_id = ? AND start_time BETWEEN ? AND ?
        GROUP BY DATE(start_time)
        ORDER BY date
      `;

      db.all(query, [userId, startDate, endDate], (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Increment tool calls count for an execution
   */
  static incrementToolCallsCount(executionId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agent_executions SET tool_calls_count = tool_calls_count + 1 WHERE id = ?',
        [executionId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Add credits to an execution
   */
  static addCredits(executionId, credits) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agent_executions SET credits_used = credits_used + ? WHERE id = ?',
        [credits, executionId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Accumulate token usage for an execution
   */
  static addTokenUsage(executionId, inputTokens, outputTokens) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE agent_executions
         SET input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             total_tokens = total_tokens + ?
         WHERE id = ?`,
        [inputTokens || 0, outputTokens || 0, (inputTokens || 0) + (outputTokens || 0), executionId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default AgentExecutionModel;
