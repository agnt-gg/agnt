import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';
import { parseFallbackChain, serializeFallbackChain } from '../services/orchestrator/fallbackChain.js';
import { normalizeScopeRoutingMode } from '../services/orchestrator/routingMode.js';

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
        toolAccessMode,
        fallbackProviders,
        fallbackEnabled,
        routingMode,
      } = agent;
      const fallbackProvidersJson = serializeFallbackChain(fallbackProviders);
      const fallbackEnabledInt = fallbackEnabled ? 1 : 0;
      // NULL = this agent has no opinion and inherits the account setting.
      // Normalised so an unrecognised value can never turn routing on.
      const routingModeValue = normalizeScopeRoutingMode(routingMode);
      const toolsJson = JSON.stringify(assignedTools);
      const workflowsJson = JSON.stringify(assignedWorkflows);
      const skillsJson = JSON.stringify(assignedSkills);
      // Only 'open' and 'restricted' are valid; anything else falls back to
      // the safe default so a malformed payload can't widen tool access.
      const accessMode = toolAccessMode === 'open' ? 'open' : 'restricted';
      /**
       * UPSERT, not INSERT OR REPLACE.
       *
       * `INSERT OR REPLACE` resolves a conflict by DELETING the existing row and
       * inserting a new one, so every column the statement does not name reverts
       * to its schema DEFAULT. This statement names the columns a caller supplies;
       * the five it does not are the row's provenance, which no payload carries:
       * created_at, deleted_at, insight_version, source_plugin, is_user_modified.
       * Editing an agent silently reset its creation date, orphaned it from the
       * plugin that installed it, zeroed the evolution counter, and undeleted it.
       *
       * Two features were disabled outright by that, each defeated by the save
       * that was supposed to precede them:
       *   - AgentService's `UPDATE ... SET is_user_modified = 1 WHERE id = ? AND
       *     source_plugin IS NOT NULL` matched nothing, because source_plugin had
       *     just been nulled.
       *   - AgentApplicator's `insight_version = COALESCE(insight_version,0) + 1`
       *     always produced 1, because the save had just zeroed it.
       *
       * Naming the missing five would fix today and rot tomorrow: `agents` has
       * gained columns by migration repeatedly, and each new one silently joins
       * the forgotten set. ON CONFLICT DO UPDATE touches ONLY the columns listed
       * below, so an unnamed column is preserved by construction.
       *
       * created_by is deliberately absent from the SET list: an edit must not
       * transfer ownership. AgentService already forks to a new id when the editor
       * is not the owner, and importAgent always mints a fresh UUID, so no caller
       * needs it to change on update.
       *
       * Guarded by AgentModel.provenance.test.js, whose last test enumerates the
       * live schema and fails when a new column is neither written nor preserved.
       */
      db.run(
        `INSERT INTO agents (id, name, description, status, icon, category, tools, workflows, provider, model, created_by, last_active, success_rate, system_prompt, skills, tool_access_mode, fallback_providers, fallback_enabled, routing_mode, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             status = excluded.status,
             icon = excluded.icon,
             category = excluded.category,
             tools = excluded.tools,
             workflows = excluded.workflows,
             provider = excluded.provider,
             model = excluded.model,
             last_active = excluded.last_active,
             success_rate = excluded.success_rate,
             system_prompt = excluded.system_prompt,
             skills = excluded.skills,
             tool_access_mode = excluded.tool_access_mode,
             fallback_providers = excluded.fallback_providers,
             fallback_enabled = excluded.fallback_enabled,
             routing_mode = excluded.routing_mode,
             updated_at = CURRENT_TIMESTAMP`,
        [id, name, description, status, icon, category, toolsJson, workflowsJson, provider, model, userId, lastActive, successRate, systemPrompt, skillsJson, accessMode, fallbackProvidersJson, fallbackEnabledInt, routingModeValue],
        function (err) {
          if (err) {
            reject(err);
          } else {
            // Same reasoning as above: reset_period and last_reset live on this
            // row and are not part of the payload, so the write must not clear
            // them just because it has nothing to say about them.
            db.run(
              `INSERT INTO agent_resources (agent_id, credit_limit, credits_used)
                   VALUES (?, ?, ?)
               ON CONFLICT(agent_id) DO UPDATE SET
                   credit_limit = excluded.credit_limit,
                   credits_used = excluded.credits_used`,
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
            agent.toolAccessMode = agent.tool_access_mode === 'open' ? 'open' : 'restricted';
            agent.fallbackProviders = parseFallbackChain(agent.fallback_providers);
            agent.fallbackEnabled = agent.fallback_enabled === null || agent.fallback_enabled === undefined
              ? false : Boolean(agent.fallback_enabled);
            agent.routingMode = normalizeScopeRoutingMode(agent.routing_mode);
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
              agent.toolAccessMode = agent.tool_access_mode === 'open' ? 'open' : 'restricted';
              agent.fallbackProviders = parseFallbackChain(agent.fallback_providers);
              agent.fallbackEnabled = agent.fallback_enabled === null || agent.fallback_enabled === undefined
                ? false : Boolean(agent.fallback_enabled);
              agent.routingMode = normalizeScopeRoutingMode(agent.routing_mode);
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
