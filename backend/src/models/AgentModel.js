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
        systemPrompt = '',
        assignedSkills = [],
      } = agent;
      const toolsJson = JSON.stringify(assignedTools);
      const workflowsJson = JSON.stringify(assignedWorkflows);
      const skillsJson = JSON.stringify(assignedSkills);
      db.run(
        `INSERT OR REPLACE INTO agents (id, name, description, status, icon, category, tools, workflows, provider, model, created_by, last_active, success_rate, system_prompt, skills, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, name, description, status, icon, category, toolsJson, workflowsJson, provider, model, userId, lastActive, successRate, systemPrompt, skillsJson],
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
         WHERE a.id = ? AND a.deleted_at IS NULL`,
        [id],
        (err, agent) => {
          if (err) reject(err);
          else if (agent) {
            // Parse tools, workflows, and skills JSON
            agent.assignedTools = agent.tools ? JSON.parse(agent.tools) : [];
            agent.assignedWorkflows = agent.workflows ? JSON.parse(agent.workflows) : [];
            agent.systemPrompt = agent.system_prompt || '';
            agent.assignedSkills = agent.skills ? JSON.parse(agent.skills) : [];
            resolve(agent);
          } else resolve(null);
        }
      );
    });
  }
  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      // Single JOIN query to fetch agents WITH resources (eliminates N+1 pattern)
      db.all(
        `SELECT a.*, ar.credit_limit, ar.credits_used,
         (SELECT COUNT(*) FROM agent_workflows WHERE agent_id = a.id) as workflow_count
         FROM agents a
         LEFT JOIN agent_resources ar ON a.id = ar.agent_id
         WHERE a.created_by = ? AND a.deleted_at IS NULL AND a.id != 'orchestrator'
         ORDER BY a.updated_at DESC`,
        [userId],
        (err, agents) => {
          if (err) reject(err);
          else {
            // Parse tools, workflows, and skills JSON for each agent
            agents.forEach((agent) => {
              agent.assignedTools = agent.tools ? JSON.parse(agent.tools) : [];
              agent.assignedWorkflows = agent.workflows ? JSON.parse(agent.workflows) : [];
              agent.systemPrompt = agent.system_prompt || '';
              agent.assignedSkills = agent.skills ? JSON.parse(agent.skills) : [];
            });
            resolve(agents);
          }
        }
      );
    });
  }

  // Skinny variant for list views. Drops the three biggest per-row payload
  // contributors:
  //   - icon         — base64 data URLs are routinely 60-90 KB per agent
  //   - system_prompt — can be multiple KB of narrative text
  //   - tools/workflows/skills JSON blobs — replaced with json_array_length()
  //     counts so the UI can still show "5 tools" without parsing the array
  // Uses the same agent_resources LEFT JOIN as the fat version so the
  // resource fields the UI reads (credit_limit, credits_used) stay present.
  static findAllSummaryByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT a.id, a.name, a.description, a.status, a.category,
         a.provider, a.model, a.created_by, a.last_active, a.success_rate,
         a.created_at, a.updated_at, a.deleted_at, a.insight_version,
         ar.credit_limit, ar.credits_used,
         (SELECT COUNT(*) FROM agent_workflows WHERE agent_id = a.id) as workflow_count,
         CASE WHEN a.tools IS NULL OR a.tools = '' THEN 0
              ELSE json_array_length(a.tools) END as tool_count,
         CASE WHEN a.skills IS NULL OR a.skills = '' THEN 0
              ELSE json_array_length(a.skills) END as skill_count
         FROM agents a
         LEFT JOIN agent_resources ar ON a.id = ar.agent_id
         WHERE a.created_by = ? AND a.deleted_at IS NULL AND a.id != 'orchestrator'
         ORDER BY a.updated_at DESC`,
        [userId],
        (err, agents) => {
          if (err) reject(err);
          else resolve(agents);
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
    // Soft-delete: preserves FK-referenced history (agent_executions, tasks, etc.)
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agents SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by = ? AND deleted_at IS NULL',
        [id, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default AgentModel;
