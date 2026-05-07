/**
 * PRD-057: Agent import/export service.
 *
 * Used by:
 *   - AgentRoutes export/import endpoints (single-asset round-trip)
 *   - PluginAssetLoader (multi-asset bundle install)
 *
 * Canonical envelope:
 *   { _format: "agnt-agent", _version: "1.0", payload: { ... } }
 *
 * Strips instance-specific fields on export (id, created_by, agent_memory,
 * agent_resources). Mints fresh UUID + binds to importing user on import.
 */

import db from '../models/database/index.js';
import AgentModel from '../models/AgentModel.js';
import generateUUID from '../utils/generateUUID.js';
import { resolveRefList } from '../utils/pluginSlugResolver.js';

const FORMAT = 'agnt-agent';
const FORMAT_VERSION = '1.0';

/**
 * Build a canonical export envelope for an agent.
 * The payload contains only portable fields. Cross-asset references
 * (assignedTools/Skills/Workflows) are emitted as bare names so the receiving
 * instance can match by name; if `pluginRefs` is set, references are emitted
 * as `<plugin>/<slug>` instead.
 *
 * @param {object} agent       row from AgentModel.findOne()
 * @param {object} [options]
 * @param {object} [options.pluginRefs]  optional { tools, skills, workflows } maps
 *                                       of localId -> slug for plugin-bundle export
 */
export function buildAgentEnvelope(agent, options = {}) {
  const pluginRefs = options.pluginRefs || {};

  // For plugin bundling we rewrite refs from local UUIDs to plugin/slug strings.
  // For standalone export we keep the bare names users typed in.
  const rewriteList = (list, kind) => {
    if (!Array.isArray(list)) return [];
    const map = pluginRefs[kind];
    if (!map) return list.slice();
    return list.map((entry) => map.get(entry) || entry);
  };

  return {
    _format: FORMAT,
    _version: FORMAT_VERSION,
    payload: {
      name: agent.name,
      description: agent.description || '',
      icon: agent.icon || null,
      provider: agent.provider || '',
      model: agent.model || '',
      systemPrompt: agent.system_prompt || agent.systemPrompt || '',
      category: agent.category || '',
      status: agent.status || 'ACTIVE',
      creditLimit: agent.credit_limit ?? agent.creditLimit ?? 1000,
      assignedTools: rewriteList(agent.assignedTools, 'tools'),
      assignedSkills: rewriteList(agent.assignedSkills, 'skills'),
      assignedWorkflows: rewriteList(agent.assignedWorkflows, 'workflows'),
    },
    exported_at: new Date().toISOString(),
  };
}

/**
 * Validate envelope shape. Throws on malformed.
 */
export function parseAgentEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Agent envelope must be an object');
  }
  if (envelope._format !== FORMAT) {
    throw new Error(`Expected _format "${FORMAT}", got "${envelope._format}"`);
  }
  if (!envelope.payload || typeof envelope.payload !== 'object') {
    throw new Error('Agent envelope missing payload');
  }
  if (!envelope.payload.name) {
    throw new Error('Agent payload missing name');
  }
  return envelope.payload;
}

/**
 * Import an agent payload into the local DB. Mints a fresh UUID, binds to the
 * importing user, resolves cross-asset references, stamps source_plugin if set.
 *
 * @param {object} payload         agent payload from parseAgentEnvelope
 * @param {string} userId          importing user ID
 * @param {object} [options]
 * @param {string} [options.sourcePlugin]  plugin name (for plugin-loader path)
 * @param {object} [options.resolveCtx]    bundleMap + lookupInstalled for slug refs
 * @returns {Promise<{ id: string, missingRefs: string[] }>}
 */
export async function importAgent(payload, userId, options = {}) {
  if (!userId) throw new Error('importAgent requires a userId');

  const ctx = options.resolveCtx || { bundleMap: new Map(), lookupInstalled: null };

  const tools = await resolveRefList(payload.assignedTools || [], 'tool', ctx);
  const skills = await resolveRefList(payload.assignedSkills || [], 'skill', ctx);
  const workflows = await resolveRefList(payload.assignedWorkflows || [], 'workflow', ctx);

  const id = generateUUID();
  const agentRow = {
    id,
    name: payload.name,
    description: payload.description || '',
    status: payload.status || 'ACTIVE',
    icon: payload.icon || null,
    category: payload.category || '',
    creditLimit: payload.creditLimit ?? 1000,
    creditsUsed: 0,
    assignedTools: tools.resolved,
    assignedWorkflows: workflows.resolved,
    assignedSkills: skills.resolved,
    provider: payload.provider || '',
    model: payload.model || '',
    systemPrompt: payload.systemPrompt || '',
  };

  await AgentModel.createOrUpdate(id, agentRow, userId);

  if (options.sourcePlugin) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE agents SET source_plugin = ?, is_user_modified = 0 WHERE id = ?`,
        [options.sourcePlugin, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  const missingRefs = [...tools.missing, ...skills.missing, ...workflows.missing];
  return { id, missingRefs };
}
