import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class AgentModel {
  static createOrUpdate(id, agent, userId) {
    return new Promise((resolve, reject) => {
      const {
        name,
        description,
        status,
        icon,
        creditLimit = 1000, // Default credit limit
        creditsUsed = 0, // Default credits used
        lastActive,
        successRate,
        category,
        assignedTools = [],
        assignedWorkflows = [],
        provider,
        model,
      } = agent;
      const toolsJson = JSON.stringify(assignedTools);
      const workflowsJson = JSON.stringify(assignedWorkflows);
      db.run(
        `INSERT OR REPLACE INTO agents (id, name, description, status, icon, category, tools, workflows, provider, model, created_by, last_active, success_rate, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, name, description, status, icon, category, toolsJson, workflowsJson, provider, model, userId, lastActive, successRate],
        function (err) {
          if (err) {
            reject(err);
          } else {
            // Update agent_resources with proper defaults
            db.run(
              `INSERT OR REPLACE INTO agent_resources (agent_id, credit_limit, credits_used)
                   VALUES (?, ?, ?)`,
              [id, creditLimit, creditsUsed],
              (err) => {
                if (err) reject(err);
                else resolve({ changes: this.changes, lastID: this.lastID });
              }
            );
          }
        }
      );
    });
  }
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT a.*, ar.credit_limit, ar.credits_used,
         (SELECT COUNT(*) FROM agent_workflows WHERE agent_id = a.id) as workflow_count
         FROM agents a
         LEFT JOIN agent_resources ar ON a.id = ar.agent_id
         WHERE a.id = ?`,
        [id],
        (err, agent) => {
          if (err) reject(err);
          else if (agent) {
            // Parse tools and workflows JSON
            agent.assignedTools = agent.tools ? JSON.parse(agent.tools) : [];
            agent.assignedWorkflows = agent.workflows ? JSON.parse(agent.workflows) : [];
            resolve(agent);
          } else resolve(null);
        }
      );
    });
  }
  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT a.*, 
         (SELECT COUNT(*) FROM agent_workflows WHERE agent_id = a.id) as workflow_count
         FROM agents a
         WHERE a.created_by = ? 
         ORDER BY a.updated_at DESC`,
        [userId],
        (err, agents) => {
          if (err) reject(err);
          else {
            // Parse tools and workflows JSON for each agent
            agents.forEach((agent) => {
              agent.assignedTools = agent.tools ? JSON.parse(agent.tools) : [];
              agent.assignedWorkflows = agent.workflows ? JSON.parse(agent.workflows) : [];
            });
            console.log('Raw agents from database:', agents);
            resolve(agents);
          }
        }
      );
    });
  }
  static findResourcesForAgents(agentIds) {
    return new Promise((resolve, reject) => {
      const placeholders = agentIds.map(() => '?').join(',');
      db.all(`SELECT * FROM agent_resources WHERE agent_id IN (${placeholders})`, agentIds, (err, resources) => {
        if (err) reject(err);
        else resolve(resources);
      });
    });
  }
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM agents WHERE id = ? AND created_by = ?', [id, userId], function (err) {
        if (err) reject(err);
        else {
          // Delete associated resources
          db.run('DELETE FROM agent_resources WHERE agent_id = ?', [id], (err) => {
            if (err) reject(err);
            else resolve(this.changes);
          });
        }
      });
    });
  }
}

export default AgentModel;
