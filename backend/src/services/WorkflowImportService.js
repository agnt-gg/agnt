/**
 * PRD-057: Workflow import/export service.
 *
 * Used by:
 *   - WorkflowRoutes export/import endpoints
 *   - PluginAssetLoader (multi-asset bundle install)
 *
 * Canonical envelope:
 *   { _format: "agnt-workflow", _version: "1.0", payload: { ... } }
 *
 * On import:
 *   - validates that node tool-types resolve in the local registry
 *   - re-templates webhook URLs to the local host
 *   - mints a fresh workflow UUID
 *   - stamps source_plugin if invoked from a plugin install
 */

import db from '../models/database/index.js';
import WorkflowModel from '../models/WorkflowModel.js';
import generateUUID from '../utils/generateUUID.js';
import PluginManager from '../plugins/PluginManager.js';
import { parseSlugRef } from '../utils/pluginSlugResolver.js';

const FORMAT = 'agnt-workflow';
const FORMAT_VERSION = '1.0';

/**
 * Build canonical envelope from a workflow row.
 * @param {object} workflow  full workflow_data parsed JSON
 */
export function buildWorkflowEnvelope(workflow) {
  return {
    _format: FORMAT,
    _version: FORMAT_VERSION,
    payload: {
      name: workflow.name || '',
      description: workflow.description || '',
      category: workflow.category || '',
      nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
      edges: Array.isArray(workflow.edges) ? workflow.edges : [],
      zoomLevel: workflow.zoomLevel ?? 1,
      canvasOffsetX: workflow.canvasOffsetX ?? 0,
      canvasOffsetY: workflow.canvasOffsetY ?? 0,
      isTinyNodeMode: workflow.isTinyNodeMode ?? false,
      isShareable: workflow.isShareable ?? false,
      customTools: workflow.customTools || [],
    },
    exported_at: new Date().toISOString(),
  };
}

export function parseWorkflowEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Workflow envelope must be an object');
  }
  if (envelope._format !== FORMAT) {
    throw new Error(`Expected _format "${FORMAT}", got "${envelope._format}"`);
  }
  if (!envelope.payload || typeof envelope.payload !== 'object') {
    throw new Error('Workflow envelope missing payload');
  }
  return envelope.payload;
}

/**
 * Validate that all node types in the workflow resolve in the local tool registry.
 * Returns array of missing tool types (empty array = all good).
 *
 * Looks at:
 *   - PluginManager (installed plugin tools)
 *   - The toolLibrary.json manifest is consumed by NodeExecutor; missing
 *     types just produce a soft warning during import — install proceeds
 *     because workflows can legitimately reference custom/local tools that
 *     PluginManager doesn't know about. We surface the list to the caller
 *     for UI display.
 */
export async function validateWorkflowToolTypes(payload) {
  const missing = [];
  const seen = new Set();
  for (const node of payload.nodes || []) {
    const t = node?.type;
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (!PluginManager.hasPluginTool(t)) {
      // Could still be a built-in tool — built-in tool registry is checked at runtime.
      // We only flag it as "potentially missing"; caller decides.
      missing.push(t);
    }
  }
  return missing;
}

/**
 * Re-template webhook URLs in workflow payload to use the local host.
 * Workflows produced on another instance contain `{{WEBHOOK_URL}}/webhook/{{WORKFLOWID}}`
 * placeholders that the original WorkflowRoutes engine substitutes at activation
 * time. We just need to make sure the placeholder pattern is present (i.e. that
 * the workflow doesn't contain a hardcoded host from another machine).
 *
 * Mutates payload in place. Returns the new workflow ID it generated.
 */
function applyImportRewrites(payload, newWorkflowId) {
  // Placeholder restore: find any node with a webhook URL parameter that
  // hardcodes a host:port pattern and replace it with the templated form.
  const HARDCODED_RE = /https?:\/\/[^/]+\/webhook\/[A-Za-z0-9-]+/g;
  for (const node of payload.nodes || []) {
    if (!node || typeof node !== 'object') continue;
    if (node.parameters && typeof node.parameters === 'object') {
      for (const [k, v] of Object.entries(node.parameters)) {
        if (typeof v === 'string' && HARDCODED_RE.test(v)) {
          node.parameters[k] = `{{WEBHOOK_URL}}/webhook/{{WORKFLOWID}}`;
        }
      }
    }
  }
  return newWorkflowId;
}

/**
 * Import a workflow payload into the local DB.
 *
 * @param {object} payload     parsed workflow payload
 * @param {string} userId      importing user ID
 * @param {object} [options]
 * @param {string} [options.sourcePlugin]
 * @returns {Promise<{ id: string, missingToolTypes: string[] }>}
 */
export async function importWorkflow(payload, userId, options = {}) {
  if (!userId) throw new Error('importWorkflow requires a userId');

  // Strip any plugin-namespaced node types for the bare name. Inside a bundle
  // the plugin-author may write `finance-pack/stock-quote` — but the running
  // tool registry only has the bare type (the plugin name is metadata). If a
  // node carries a prefixed type, drop the prefix.
  for (const node of payload.nodes || []) {
    if (typeof node?.type === 'string' && parseSlugRef(node.type)) {
      node.type = parseSlugRef(node.type).slug;
    }
  }

  const newId = generateUUID();
  applyImportRewrites(payload, newId);

  const missingToolTypes = await validateWorkflowToolTypes(payload);

  const workflowJson = {
    id: newId,
    name: payload.name || 'Imported Workflow',
    description: payload.description || '',
    category: payload.category || '',
    nodes: payload.nodes || [],
    edges: payload.edges || [],
    zoomLevel: payload.zoomLevel ?? 1,
    canvasOffsetX: payload.canvasOffsetX ?? 0,
    canvasOffsetY: payload.canvasOffsetY ?? 0,
    isTinyNodeMode: payload.isTinyNodeMode ?? false,
    isShareable: payload.isShareable ?? false,
    customTools: payload.customTools || [],
  };

  await WorkflowModel.createOrUpdate(newId, JSON.stringify(workflowJson), userId, !!payload.isShareable);

  if (options.sourcePlugin) {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE workflows SET source_plugin = ?, is_user_modified = 0 WHERE id = ?`,
        [options.sourcePlugin, newId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  return { id: newId, missingToolTypes };
}
