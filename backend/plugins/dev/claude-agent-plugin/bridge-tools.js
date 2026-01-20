import { tool } from '@anthropic-ai/claude-agent-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Bridges AGNT tools to the Claude Agent SDK format.
 * Maps AGNT's JSON-based schema to Zod.
 */
export async function bridgeTools(workflowEngine, allowedTools = []) {
  console.log('[BridgeTools] Starting tool bridging...');

  try {
    // 1. Get the ToolRegistry
    const ToolRegistryModule = await import(`file://${path.join(APP_PATH, 'backend/src/tools/ToolRegistry.js').replace(/\\/g, '/')}`);
    const ToolRegistry = ToolRegistryModule.default.getInstance();

    // Check if registry is initialized - DO NOT re-initialize during workflow execution
    // as this can cause crashes. The registry should already be initialized by the time
    // a workflow runs.
    if (!ToolRegistry.initialized) {
      console.warn('[BridgeTools] ToolRegistry not initialized - this should not happen during workflow execution');
      console.warn('[BridgeTools] Returning empty tools array to prevent crash');
      return [];
    }

    const allSchemas = ToolRegistry.getAllSchemas();
    console.log('[BridgeTools] Got schemas, categories:', Object.keys(allSchemas));

    const sdkTools = [];

    // 2. Iterate through categories and tools
    const categories = ['actions', 'utilities', 'custom'];
    for (const category of categories) {
      const tools = allSchemas[category] || [];
      for (const schema of tools) {
        // CIRCUIT BREAKER: Never allow the Claude Agent to call itself
        if (schema.type === 'claude-agent') continue;

        // Skip if not in allowed list (if list is not empty)
        if (allowedTools.length > 0 && !allowedTools.includes(schema.type)) {
          continue;
        }

        try {
          const sdkTool = bridgeSchemaToSdkTool(schema, workflowEngine);
          // Only add non-null tools (null is returned for skipped tools like claude-agent)
          if (sdkTool !== null) {
            sdkTools.push(sdkTool);
          }
        } catch (error) {
          console.warn(`[BridgeTools] Failed to bridge tool ${schema.type}:`, error.message);
        }
      }
    }

    console.log(`[BridgeTools] Successfully bridged ${sdkTools.length} tools`);
    // Filter out any null/undefined tools as a safety measure
    return sdkTools.filter((tool) => tool != null);
  } catch (error) {
    console.error('[BridgeTools] Fatal error during tool bridging:', error);
    return [];
  }
}

/**
 * Creates a Claude SDK 'tool' from an AGNT schema.
 */
function bridgeSchemaToSdkTool(schema, workflowEngine) {
  // CIRCUIT BREAKER: Double-check to prevent claude-agent from calling itself
  if (schema.type === 'claude-agent') {
    console.warn('[BridgeTools] Skipping claude-agent tool to prevent circular recursion');
    return null;
  }

  // Map AGNT parameters to Zod schema
  const zodShape = {};
  for (const [key, param] of Object.entries(schema.parameters || {})) {
    let zodType;
    switch (param.type) {
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.any());
        break;
      case 'object':
        zodType = z.record(z.any());
        break;
      case 'string':
      default:
        zodType = z.string();
        break;
    }

    if (param.description) {
      zodType = zodType.describe(param.description);
    }

    zodShape[key] = param.required ? zodType : zodType.optional();
  }

  const toolSchema = z.object(zodShape);

  // Return the SDK tool
  return tool(schema.type, schema.description || schema.title, toolSchema, async (args) => {
    console.log(`[ClaudeAgent] Agent calling tool: ${schema.type}`, args);

    // CIRCUIT BREAKER: Check if workflow engine is still active
    if (workflowEngine.stopRequested) {
      return {
        content: [{ type: 'text', text: 'Tool execution aborted: Workflow is stopping.' }],
        isError: true,
      };
    }

    try {
      // USE EXISTING nodeExecutor instead of creating a new one
      const executor = workflowEngine.nodeExecutor;

      if (!executor) {
        throw new Error('Workflow engine nodeExecutor is not available.');
      }

      // Simulate a node for execution
      const node = {
        id: `agent-call-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        type: schema.type,
        category: schema.category,
        parameters: args,
      };

      // Execute the tool via the existing engine's executor
      const result = await executor.executeNode(node, workflowEngine.currentTriggerData);

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (error) {
      console.error(`[ClaudeAgent] Executor failed for ${schema.type}:`, error.message);
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${error.message}` }],
        isError: true,
      };
    }
  });
}
