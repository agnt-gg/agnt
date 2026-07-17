import CustomToolExecutor from '../../workflow/CustomToolExecutor.js';
import ParameterResolver from '../../workflow/ParameterResolver.js';

/**
 * Shared runner for user-authored Tool Forge tools (rows in the `tools` table,
 * or inline tool definitions from the Tool Forge preview pane).
 *
 * Tool Forge tools are normally executed as nodes inside a running workflow via
 * WorkflowEngine -> CustomToolExecutor, which needs a live workflow engine for
 * template resolution. This module reuses that exact proven executor but backs
 * it with a minimal, stateless engine so a custom tool can be run directly from
 * the orchestrator tool-execution chokepoint (executeTool) and from the
 * `run_tool` Tool Forge action — outside of any workflow.
 *
 * This is the same pattern the registry/plugin tool path already uses in
 * orchestrator/tools.js (a `mockWorkflowEngine` + ParameterResolver).
 */

/**
 * Build a minimal workflow-engine-like context so CustomToolExecutor and
 * ParameterResolver work outside a real workflow run. Plain parameter values
 * (no `{{...}}` templates) never touch these fields, but they must exist so
 * template resolution and the code/AI leaf executors don't throw.
 */
function makeMinimalEngine(userId) {
  const engine = {
    workflowId: null,
    userId: userId || null,
    outputs: {},
    errors: {},
    DB: {},
    isSubWorkflow: false,
    parentInputData: {},
    currentTriggerData: {},
    nodeNameToId: new Map(),
    nodeIdSet: new Set(),
  };
  engine.parameterResolver = new ParameterResolver(engine);
  return engine;
}

/**
 * Map a stored/inline Tool Forge tool record into the node shape that
 * CustomToolExecutor.execute() expects. Tool Forge stores its base as
 * 'CODE_JS' | 'CODE_PYTHON' | 'AI', while the orchestrator save path may store
 * friendly labels like 'JavaScript' | 'Python'. Normalize both.
 *
 * Caller-supplied flat args (e.g. { message: 'hi' }) become the node's
 * parameter values; CustomToolExecutor resolves them (plain strings pass
 * through untouched) and injects them as `params` for code tools.
 */
function toExecutableNode(tool, args) {
  const rawBase = tool.base || tool.config?.base || 'AI';
  const baseMap = {
    javascript: 'CODE_JS',
    js: 'CODE_JS',
    code_js: 'CODE_JS',
    python: 'CODE_PYTHON',
    py: 'CODE_PYTHON',
    code_python: 'CODE_PYTHON',
    ai: 'AI',
  };
  const code = tool.code || tool.config?.code || null;
  const base = baseMap[String(rawBase).toLowerCase()] || (code ? 'CODE_JS' : 'AI');

  return {
    id: tool.id || null,
    type: tool.type || null,
    base,
    code,
    parameters: { ...(args || {}) },
  };
}

/**
 * Execute a Tool Forge tool and return its raw output.
 *
 * @param {object} tool  Stored tool row (CustomToolModel.findOne shape) or an
 *                       inline tool definition { base, code, ... }.
 * @param {object} args  Flat runtime parameters for this invocation.
 * @param {string} userId
 * @returns {Promise<object>} The executor output. For code tools this is
 *          { success, result, error, outputs }; for AI tools it is the model
 *          result or { error }.
 */
export async function runCustomTool(tool, args, userId) {
  const node = toExecutableNode(tool, args);
  const engine = makeMinimalEngine(userId);
  const executor = new CustomToolExecutor(engine);
  return await executor.execute(node, {});
}

/**
 * Convert a stored custom tool (CustomToolModel.findOne/findAllByUserId row)
 * into an OpenAI function-tool schema so it is discoverable by the LLM and can
 * be argument-validated by validateToolArguments. Parameters are taken from the
 * tool's declared `parameters` map when present, else from Tool Forge `config.fields`.
 */
export function toToolSchema(tool) {
  const name = tool.type || tool.title || tool.id;
  const description = tool.description || `Custom Tool Forge tool: ${name}`;
  const properties = {};
  const required = [];

  // Preferred shape: parameters = { message: { type:'string', required:true, description } }
  if (tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters)) {
    for (const [key, def] of Object.entries(tool.parameters)) {
      if (def && typeof def === 'object' && !Array.isArray(def)) {
        properties[key] = {
          type: def.type || 'string',
          description: def.description || def.placeholder || key,
        };
        if (def.required) required.push(key);
      } else {
        properties[key] = { type: 'string', description: key };
      }
    }
  }

  // Fallback: Tool Forge config.fields = [{ name, type:'text'|'textarea'|..., required }]
  if (Object.keys(properties).length === 0 && Array.isArray(tool.config?.fields)) {
    const typeMap = { text: 'string', textarea: 'string', select: 'string', number: 'number', checkbox: 'boolean', password: 'string' };
    for (const f of tool.config.fields) {
      if (!f || !f.name) continue;
      properties[f.name] = { type: typeMap[f.type] || 'string', description: f.description || f.name };
      if (f.required) required.push(f.name);
    }
  }

  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
      },
    },
  };
}

/**
 * True when an executor output represents success. Code tools return an
 * explicit `success` flag plus an `error` field (undefined on success); AI
 * tools return `{ error }` only on failure.
 */
export function isCustomToolSuccess(output) {
  if (!output || typeof output !== 'object') return output !== undefined && output !== null;
  // Outer executor envelope.
  if (output.success === false) return false;
  if (output.error) return false;
  // Nested tool result: code tools wrap the user result under `.result`, and a
  // tool that runs but reports a business failure (e.g. { success: false } or
  // an error string) must not be presented as success.
  const inner = output.result;
  if (inner && typeof inner === 'object') {
    if (inner.success === false) return false;
    if (inner.error) return false;
  }
  return true;
}
