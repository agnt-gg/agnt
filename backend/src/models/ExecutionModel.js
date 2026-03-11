import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class ExecutionModel {
  static create(workflowId, userId, workflowName) {
    const id = generateUUID();
    const startTime = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time) VALUES (?, ?, ?, ?, ?, ?)',
        [id, workflowId, userId, workflowName, 'started', startTime],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }
  static update(id, status, log, creditsUsed) {
    return new Promise((resolve, reject) => {
      const safeStatus = status || 'stopped';

      db.run(
        'UPDATE workflow_executions SET status = ?, log = ?, end_time = ?, credits_used = ? WHERE id = ?',
        [safeStatus, log, new Date().toISOString(), creditsUsed, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
  static createNodeExecution(executionId, nodeId, input) {
    const id = generateUUID();
    const startTime = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO node_executions (id, execution_id, node_id, status, input, start_time) VALUES (?, ?, ?, ?, ?, ?)',
        [id, executionId, nodeId, 'started', JSON.stringify(input), startTime],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }
  static async updateNodeExecution(executionId, nodeId, status, output, error, executionDuration) {
    const endTime = new Date().toISOString();
    try {
      const nodeExecution = await this.getNodeExecution(executionId, nodeId);
      const durationInSeconds = executionDuration / 1000;
      // const creditsUsed = executionDuration === 0 ? 0 : durationInSeconds / 100; // 1 credit per 100 seconds, 0 if duration is 0
      const creditsUsed = executionDuration === 0 ? 0 : durationInSeconds; // 1 credit per 1 second, 0 if duration is 0

      // SEND CREDITS USED TO REMOTE SERVER FOR USAGE TRACKING

      return new Promise((resolve, reject) => {
        db.run(
          'UPDATE node_executions SET status = ?, output = ?, error = ?, end_time = ?, credits_used = ? WHERE execution_id = ? AND node_id = ?',
          [status, JSON.stringify(output), error, endTime, creditsUsed, executionId, nodeId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
    } catch (error) {
      console.error('Error updating node execution:', error);
      throw error;
    }
  }
  static getExecutions(userId, { startDate, endDate } = {}) {
    const dateFilter = startDate
      ? `AND we.start_time >= ? AND we.start_time <= ?`
      : `AND we.start_time >= datetime('now', '-7 days')`;
    const params = startDate ? [userId, startDate, endDate] : [userId];

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT we.id, we.workflow_id, we.workflow_name, we.start_time, we.end_time, we.status, we.credits_used,
                (SELECT COUNT(*) FROM node_executions ne WHERE ne.execution_id = we.id) as node_count
         FROM workflow_executions we
         WHERE we.user_id = ? ${dateFilter}
         ORDER BY we.start_time DESC
         LIMIT 10000`,
        params,
        (err, rows) => {
          if (err) reject(err);
          else {
            const executions = rows.map((row) => ({
              id: row.id,
              workflowId: row.workflow_id,
              workflowName: row.workflow_name || 'Unknown Workflow',
              startTime: row.start_time,
              endTime: row.end_time,
              status: row.status,
              creditsUsed: row.credits_used || 0,
              nodeCount: row.node_count || 0,
            }));
            resolve(executions);
          }
        }
      );
    });
  }
  static getNodeExecution(executionId, nodeId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT ne.*, we.user_id 
         FROM node_executions ne
         JOIN workflow_executions we ON ne.execution_id = we.id
         WHERE ne.execution_id = ? AND ne.node_id = ?`,
        [executionId, nodeId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }
  static async getExecutionDetails(executionId) {
    const execQuery = new Promise((resolve, reject) => {
      db.get(
        `SELECT we.id, we.workflow_id, we.workflow_name, we.start_time, we.end_time, we.status, we.log
         FROM workflow_executions we
         WHERE we.id = ?`,
        [executionId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    const nodesQuery = new Promise((resolve, reject) => {
      db.all(
        `SELECT id, node_id, start_time, end_time, status, input, output, error, credits_used
         FROM node_executions
         WHERE execution_id = ?
         ORDER BY start_time`,
        [executionId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    const [execution, nodeExecutions] = await Promise.all([execQuery, nodesQuery]);
    if (!execution) return null;

    const safeParse = (str) => { try { return JSON.parse(str); } catch { return str; } };
    const totalCreditsUsed = nodeExecutions.reduce((sum, ne) => sum + (ne.credits_used || 0), 0);

    return {
      id: execution.id,
      workflowId: execution.workflow_id,
      workflowName: execution.workflow_name || 'Unknown Workflow',
      startTime: execution.start_time,
      endTime: execution.end_time,
      status: execution.status,
      log: execution.log,
      creditsUsed: totalCreditsUsed,
      nodeExecutions: nodeExecutions.map((ne) => ({
        ...ne,
        input: safeParse(ne.input),
        output: safeParse(ne.output),
      })),
    };
  }
  static getAgentActivityData(userId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          DATE(start_time) as date, 
          SUM(credits_used) as credits_used
        FROM workflow_executions
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
  static async getTotalCreditsUsed(executionId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT SUM(credits_used) as total_credits FROM node_executions WHERE execution_id = ?', [executionId], (err, row) => {
        if (err) reject(err);
        else resolve(row.total_credits || 0);
      });
    });
  }
}

export default ExecutionModel;
