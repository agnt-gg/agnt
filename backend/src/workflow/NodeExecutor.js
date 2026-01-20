import ToolConfig from '../tools/ToolConfig.js';
import AuthManager from '../services/auth/AuthManager.js';
import ExecutionModel from '../models/ExecutionModel.js';
import CustomToolExecutor from './CustomToolExecutor.js';
import PluginManager from '../plugins/PluginManager.js';

class NodeExecutor {
  constructor(workflowEngine) {
    this.workflowEngine = workflowEngine;
    this.nonChargingNodes = ['delay'];
    this.customToolExecutor = new CustomToolExecutor(workflowEngine);
  }
  async executeNode(node, inputData) {
    const startTime = new Date();
    console.log(`Executing node: ${node.id} ${node.type} (${node.text})`);

    // Set the current node ID in the workflow engine
    this.workflowEngine.currentNodeId = node.id;

    await ExecutionModel.createNodeExecution(this.workflowEngine.currentExecutionId, node.id, inputData);
    let output;

    try {
      // IF AUTH REQUIRED DO AUTH
      if (node.requiresOAuth) {
        const accessToken = await AuthManager.getValidAccessToken(this.workflowEngine.userId, node.oauthProvider);
        if (!accessToken) {
          throw new Error(`OAuth tokens not found for provider: ${node.oauthProvider}`);
        }

        // Add the access token to the resolved parameters
        resolvedParams.accessToken = accessToken;
      }

      console.log('CREDITS CHECKED');

      // IF TRIGGER - TRY FILE-BASED FIRST, THEN FALL BACK TO TOOL CONFIG
      if (node.category === 'trigger') {
        let triggerProcessed = false;

        // Try to load trigger from file first (new approach - from triggers subdirectory)
        try {
          const triggerModule = await import(`../tools/library/triggers/${node.type}.js`);
          const trigger = triggerModule.default;

          if (trigger && typeof trigger.process === 'function') {
            console.log(`Using file-based trigger for ${node.type}`);
            output = await trigger.process(inputData, this.workflowEngine);
            triggerProcessed = true;
          }
        } catch (importError) {
          // File doesn't exist or has errors - will fall back to ToolConfig
          console.log(`File-based trigger not found for ${node.type}, falling back to ToolConfig`);
        }

        // Fall back to ToolConfig if file-based trigger not found (backward compatibility)
        if (!triggerProcessed) {
          const triggerConfig = ToolConfig.triggers[node.type];
          if (triggerConfig && triggerConfig.process) {
            console.log(`Using ToolConfig trigger for ${node.type}`);
            output = await triggerConfig.process(inputData, this.workflowEngine);
          } else {
            throw new Error(`Invalid trigger type: ${node.type}`);
          }
        }
      }
      // IF CUSTOM TOOL USE CUSTOM TOOL
      else if (node.category === 'custom') {
        // Load the full tool definition from database to get base and code properties
        // First try to find by ID (if node has an id property), otherwise fall back to type
        const CustomToolModel = (await import('../models/CustomToolModel.js')).default;

        // Try to find the tool - first by matching type field in database
        let fullToolDef = null;

        // Query all tools and find the one with matching type
        const allTools = await CustomToolModel.findAllByUserId(this.workflowEngine.userId);
        fullToolDef = allTools.find((tool) => tool.type === node.type);

        if (!fullToolDef) {
          console.warn(`Could not find tool definition for type: ${node.type}`);
        }

        // Merge the full tool definition with the node data
        const enrichedNode = {
          ...node,
          base: fullToolDef?.base || node.base || 'AI',
          code: fullToolDef?.code || node.code,
        };

        console.log('Enriched node with base:', enrichedNode.base, 'and code:', enrichedNode.code ? 'present' : 'missing');

        output = await this.customToolExecutor.execute(enrichedNode, inputData);
      }
      // IF STOP WORKFLOW NODE
      else if (node.type === 'stop-workflow') {
        const params = this.workflowEngine.parameterResolver.resolveParameters(node.parameters);
        const reason = params.reason || 'Workflow stopped by Stop Workflow node';

        this.workflowEngine.stopRequested = true;
        this.workflowEngine.stopReason = reason;

        output = {
          stopped: true,
          reason: reason,
        };
      }
      // ELSE USE TOOLS IN TOOL LIBRARY
      else {
        // Try to load from category subdirectories
        const categories = ['actions', 'utilities', 'widgets', 'controls', 'custom', 'mcp'];
        let toolModule = null;
        let loadedFrom = null;
        let lastError = null;

        // Try each category subdirectory
        for (const category of categories) {
          try {
            toolModule = await import(`../tools/library/${category}/${node.type}.js`);
            loadedFrom = category;
            console.log(`✓ Loaded ${node.type} from ${category}/`);
            break;
          } catch (error) {
            lastError = error;
            // Continue to next category
            continue;
          }
        }

        // If not found in built-in library, try plugin system
        if (!toolModule) {
          try {
            console.log(`[NodeExecutor] Trying plugin system for ${node.type}`);
            toolModule = await PluginManager.loadTool(node.type);
            loadedFrom = 'plugin';
            console.log(`✓ Loaded ${node.type} from plugin`);
          } catch (pluginError) {
            console.error(`[NodeExecutor] Plugin load failed for ${node.type}:`, pluginError.message);
            lastError = pluginError;
          }
        }

        // If not found anywhere, throw error with details
        if (!toolModule) {
          console.error(`Failed to load tool ${node.type}. Last error:`, lastError?.message);
          throw new Error(`Tool not found: ${node.type}. Searched in: ${categories.join(', ')}, plugins`);
        }

        const action = toolModule.default;

        if (!action || typeof action.execute !== 'function') {
          throw new Error(`Invalid action for node type: ${node.type}`);
        }

        const resolvedParams = this.workflowEngine.parameterResolver.resolveParameters(node.parameters);

        // Runtime parameter validation happens in BaseAction.execute()
        output = await action.execute(resolvedParams, inputData, this.workflowEngine);
      }

      if (output.error) {
        throw new Error(output.error);
      }

      const endTime = new Date();
      const executionDuration = endTime - startTime;

      this.workflowEngine.outputs[node.id] = output;
      console.log(`Node ${node.id} output:`, output);

      // Skip credit deduction for non-charging nodes
      const shouldCharge = !this.nonChargingNodes.includes(node.type);
      await ExecutionModel.updateNodeExecution(
        this.workflowEngine.currentExecutionId,
        node.id,
        'completed',
        output,
        null,
        shouldCharge ? executionDuration : 0
      );
      return { ...output, error: null };
    } catch (error) {
      console.error(`Error executing node ${node.id}:`, error);
      // UPDATE NODE EXECUTION WITH ERROR
      const endTime = new Date();
      const executionDuration = endTime - startTime;

      if (executionDuration > 0 && !error.message.includes('Insufficient credits')) {
        await ExecutionModel.updateNodeExecution(this.workflowEngine.currentExecutionId, node.id, 'error', null, error.message, executionDuration);
      }

      this.workflowEngine.outputs[node.id] = {
        generatedText: null,
        tokenCount: null,
        error: error.message,
      };
      this.workflowEngine.errors[node.id] = error.message;
      // await ExecutionModel.updateNodeExecution(this.workflowEngine.currentExecutionId, node.id, 'error', null, error.message);

      this.workflowEngine.emit('workflowError', {
        nodeId: node.id,
        error: error.message,
      });

      return {
        generatedText: null,
        tokenCount: null,
        error: error.message,
      };
    }
  }
  getTriggerConfig(triggerType) {
    return ToolConfig.triggers[triggerType];
  }
}

export default NodeExecutor;
