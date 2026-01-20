import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class TaskModel {
  static create(goalId, title, description, requiredTools = [], dependencies = [], orderIndex = 0, parentTaskId = null) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO tasks (id, goal_id, parent_task_id, title, description, required_tools, dependencies, order_index, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, goalId, parentTaskId, title, description, JSON.stringify(requiredTools), JSON.stringify(dependencies), orderIndex, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT t.*, a.name as agent_name 
         FROM tasks t
         LEFT JOIN agents a ON t.agent_id = a.id
         WHERE t.goal_id = ?
         ORDER BY t.order_index, t.created_at`,
        [goalId],
        (err, tasks) => {
          if (err) reject(err);
          else {
            tasks.forEach((task) => {
              task.required_tools = JSON.parse(task.required_tools || '[]');
              task.dependencies = JSON.parse(task.dependencies || '[]');
            });
            resolve(tasks);
          }
        }
      );
    });
  }

  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT t.*, a.name as agent_name, w.workflow_data
         FROM tasks t
         LEFT JOIN agents a ON t.agent_id = a.id
         LEFT JOIN workflows w ON t.workflow_id = w.id
         WHERE t.id = ?`,
        [id],
        (err, task) => {
          if (err) reject(err);
          else if (task) {
            task.required_tools = JSON.parse(task.required_tools || '[]');
            task.dependencies = JSON.parse(task.dependencies || '[]');
            if (task.workflow_data) {
              task.workflow = JSON.parse(task.workflow_data);
            }
            resolve(task);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  static assignAgent(taskId, agentId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE tasks SET agent_id = ?, status = 'assigned' WHERE id = ?`, [agentId, taskId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static assignWorkflow(taskId, workflowId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE tasks SET workflow_id = ? WHERE id = ?`, [workflowId, taskId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static updateStatus(taskId, status, progress = null, startedAt = null, completedAt = null, input = null, output = null, error = null) {
    return new Promise((resolve, reject) => {
      const updatedAt = new Date().toISOString();
      let query = `UPDATE tasks SET status = ?, updated_at = ?`;
      let params = [status, updatedAt];

      if (progress !== null) {
        query += `, progress = ?`;
        params.push(progress);
      }
      if (startedAt) {
        query += `, started_at = ?`;
        params.push(startedAt);
      } else if (status === 'executing' || status === 'running') {
        // Auto-set started_at if not provided and status is executing/running
        query += `, started_at = ?`;
        params.push(updatedAt);
      }
      if (completedAt) {
        query += `, completed_at = ?`;
        params.push(completedAt);
      } else if (status === 'completed') {
        // Auto-set completed_at if not provided and status is completed
        query += `, completed_at = ?`;
        params.push(updatedAt);
      }
      if (input !== null) {
        query += `, input = ?`;
        params.push(JSON.stringify(input));
      }
      if (output !== null) {
        query += `, output = ?`;
        params.push(JSON.stringify(output));
      }
      if (error !== null) {
        query += `, error = ?`;
        params.push(error);
      }

      query += ` WHERE id = ?`;
      params.push(taskId);

      db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static findPendingTasks() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT t.*, g.user_id 
         FROM tasks t
         JOIN goals g ON t.goal_id = g.id
         WHERE t.status = 'pending' AND g.status = 'executing'
         ORDER BY t.order_index`,
        [],
        (err, tasks) => {
          if (err) reject(err);
          else {
            tasks.forEach((task) => {
              task.required_tools = JSON.parse(task.required_tools || '[]');
              task.dependencies = JSON.parse(task.dependencies || '[]');
            });
            resolve(tasks);
          }
        }
      );
    });
  }

  static canExecuteTask(taskId) {
    return new Promise((resolve, reject) => {
      // Check if all dependencies are completed
      db.get(
        `SELECT t.dependencies, 
         (SELECT COUNT(*) FROM tasks dep WHERE dep.id IN (
           SELECT json_each.value FROM json_each(t.dependencies)
         ) AND dep.status != 'completed') as incomplete_deps
         FROM tasks t WHERE t.id = ?`,
        [taskId],
        (err, result) => {
          if (err) reject(err);
          else resolve(result.incomplete_deps === 0);
        }
      );
    });
  }
}

export default TaskModel;
