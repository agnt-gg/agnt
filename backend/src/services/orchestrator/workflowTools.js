import log from '../../utils/logger.js';
import WorkflowModel from '../../models/WorkflowModel.js';
import WorkflowVersionService from '../WorkflowVersionService.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';
import {
  calculateAutoLayout,
  validateNodeType,
  validateNodeConnections,
  cleanupOrphanedEdges,
  generateNodeId,
  generateEdgeId,
  findNodeByIdentifier,
  buildNodeReferenceMap,
} from '../WorkflowManipulationService.js';

/**
 * Save workflow to database and broadcast update
 */
async function saveWorkflow(workflowId, workflowState, userId) {
  try {
    await WorkflowModel.createOrUpdate(workflowId, JSON.stringify(workflowState), userId, workflowState.isShareable || false);

    // Broadcast update to frontend
    if (userId) {
      broadcastToUser(userId, RealtimeEvents.WORKFLOW_UPDATED, {
        id: workflowId,
        name: workflowState.name,
        userId: userId,
        timestamp: new Date().toISOString(),
        workflowState: workflowState, // Include full state for real-time update
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[WorkflowTools] Error saving workflow:', error);
    throw error;
  }
}

/**
 * Extract user ID from auth token
 */
function getUserIdFromToken(authToken) {
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authToken.split(' ')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.id || null;
  } catch (e) {
    console.error('[WorkflowTools] Could not decode token:', e);
    return null;
  }
}

export const TOOLS = {
  // ============================================================================
  // CORE WORKFLOW MODIFICATION TOOL - SINGLE LLM, FULL CONTEXT
  // ============================================================================

  update_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'update_workflow',
        description: 'Update the entire workflow by providing a complete workflow JSON. Use this to create, modify, or rebuild workflows. You have full context and generate the complete workflow directly.',
        parameters: {
          type: 'object',
          properties: {
            workflow: {
              type: 'object',
              description: 'Complete workflow object with nodes array, edges array, and all required properties. MUST include ALL nodes (existing + new) and ALL edges.',
              properties: {
                nodes: {
                  type: 'array',
                  description: 'Array of all workflow nodes (existing + new)',
                },
                edges: {
                  type: 'array',
                  description: 'Array of all workflow edges (existing + new)',
                },
                name: {
                  type: 'string',
                  description: 'Workflow name',
                },
              },
              required: ['nodes', 'edges'],
            },
            summary: {
              type: 'string',
              description: 'Brief summary of what changed (e.g., "Added timer trigger and HTTP request node")',
            },
          },
          required: ['workflow'],
        },
      },
    },
    execute: async ({ workflow, summary }, authToken, context) => {
      try {
        const { workflowState, workflowId } = context;

        if (!workflowState) {
          return JSON.stringify({ success: false, error: 'No workflow state available' });
        }

        // Validate workflow structure
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
          return JSON.stringify({ success: false, error: 'Workflow must have a nodes array' });
        }

        if (!workflow.edges || !Array.isArray(workflow.edges)) {
          return JSON.stringify({ success: false, error: 'Workflow must have an edges array' });
        }

        // Validate all nodes have required fields
        for (const node of workflow.nodes) {
          if (!node.id) {
            return JSON.stringify({ success: false, error: 'All nodes must have an id' });
          }
          if (!node.type) {
            return JSON.stringify({ success: false, error: `Node ${node.id} must have a type` });
          }
          if (!node.text) {
            return JSON.stringify({ success: false, error: `Node ${node.id} must have a text label` });
          }
          if (node.x === undefined || node.y === undefined) {
            return JSON.stringify({ success: false, error: `Node ${node.id} must have x and y coordinates` });
          }
        }

        // Validate all edges have required fields
        for (const edge of workflow.edges) {
          if (!edge.id) {
            return JSON.stringify({ success: false, error: 'All edges must have an id' });
          }
          if (!edge.start || !edge.start.id) {
            return JSON.stringify({ success: false, error: `Edge ${edge.id} must have start.id` });
          }
          if (!edge.end || !edge.end.id) {
            return JSON.stringify({ success: false, error: `Edge ${edge.id} must have end.id` });
          }
        }

        // Merge with existing workflow state (preserve properties not in the update)
        const updatedWorkflow = {
          ...workflowState,
          ...workflow,
          id: workflowState.id, // ALWAYS preserve original workflow ID
          zoomLevel: workflow.zoomLevel || workflowState.zoomLevel || 1,
          canvasOffsetX: workflow.canvasOffsetX !== undefined ? workflow.canvasOffsetX : workflowState.canvasOffsetX || 0,
          canvasOffsetY: workflow.canvasOffsetY !== undefined ? workflow.canvasOffsetY : workflowState.canvasOffsetY || 0,
          isTinyNodeMode: workflow.isTinyNodeMode !== undefined ? workflow.isTinyNodeMode : workflowState.isTinyNodeMode || false,
          isShareable: workflow.isShareable !== undefined ? workflow.isShareable : workflowState.isShareable || false,
          customTools: workflow.customTools || workflowState.customTools || [],
        };

        // Update context with new workflow state
        context.workflowState = updatedWorkflow;

        // Broadcast update to frontend (NO DATABASE SAVE - just real-time UI update)
        const userId = getUserIdFromToken(authToken);
        if (userId) {
          broadcastToUser(userId, RealtimeEvents.WORKFLOW_UPDATED, {
            id: workflowId,
            name: updatedWorkflow.name,
            userId: userId,
            timestamp: new Date().toISOString(),
            workflowState: updatedWorkflow,
          });
        }

        const nodeCount = workflow.nodes.length;
        const edgeCount = workflow.edges.length;

        return JSON.stringify({
          success: true,
          message: summary || `Updated workflow with ${nodeCount} node(s) and ${edgeCount} edge(s)`,
          nodeCount,
          edgeCount,
        });
      } catch (error) {
        console.error('[WorkflowTools] Error in update_workflow:', error);
        return JSON.stringify({ success: false, error: error.message });
      }
    },
  },

  // ============================================================================
  // VERSION CONTROL TOOLS
  // ============================================================================

  revert_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'revert_workflow',
        description: 'Revert workflow to a previous version. Use when user says "undo" or "go back".',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'number',
              description: 'How many versions to go back (default: 1)',
            },
            versionNumber: {
              type: 'number',
              description: 'Specific version number to revert to',
            },
          },
        },
      },
    },
    execute: async ({ steps = 1, versionNumber }, authToken, context) => {
      try {
        const { workflowId } = context;

        if (!workflowId) {
          return JSON.stringify({ success: false, error: 'No workflow ID available' });
        }

        let targetVersion;

        if (versionNumber) {
          targetVersion = await WorkflowVersionService.getVersion(workflowId, versionNumber);
        } else {
          // Go back N steps
          const history = await WorkflowVersionService.getVersionHistory(workflowId, { limit: steps + 1 });
          if (history.length <= steps) {
            return JSON.stringify({ success: false, error: `Cannot go back ${steps} versions (only ${history.length - 1} available)` });
          }
          targetVersion = history[steps];
        }

        if (!targetVersion) {
          return JSON.stringify({ success: false, error: 'Version not found' });
        }

        const result = await WorkflowVersionService.revertToVersion(workflowId, targetVersion.id);

        // Update context for subsequent operations
        context.workflowState = result.workflowState;

        // Save reverted workflow
        const userId = getUserIdFromToken(authToken);
        await saveWorkflow(workflowId, result.workflowState, userId);

        return JSON.stringify({
          success: true,
          message: `Reverted to version ${result.revertedToVersion}`,
          newVersion: result.newVersion.versionNumber,
        });
      } catch (error) {
        console.error('[WorkflowTools] Error in revert_workflow:', error);
        return JSON.stringify({ success: false, error: error.message });
      }
    },
  },

  list_workflow_versions: {
    schema: {
      type: 'function',
      function: {
        name: 'list_workflow_versions',
        description: 'Show version history. Use when user asks "show history" or "what changed".',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max versions to return (default: 10)',
            },
            checkpointsOnly: {
              type: 'boolean',
              description: 'Show only checkpoints',
            },
          },
        },
      },
    },
    execute: async ({ limit = 10, checkpointsOnly = false }, authToken, context) => {
      try {
        const { workflowId } = context;

        if (!workflowId) {
          return JSON.stringify({ success: false, error: 'No workflow ID available' });
        }

        const versions = await WorkflowVersionService.getVersionHistory(workflowId, {
          limit,
          checkpointsOnly,
        });

        const formatted = versions.map((v) => ({
          version: v.version_number,
          date: new Date(v.created_at).toLocaleString(),
          type: v.change_type,
          summary: v.change_summary,
          checkpoint: v.is_checkpoint === 1,
        }));

        return JSON.stringify({
          success: true,
          versions: formatted,
          message: `Found ${versions.length} version(s)${checkpointsOnly ? ' (checkpoints only)' : ''}`,
        });
      } catch (error) {
        console.error('[WorkflowTools] Error in list_workflow_versions:', error);
        return JSON.stringify({ success: false, error: error.message });
      }
    },
  },

  create_checkpoint: {
    schema: {
      type: 'function',
      function: {
        name: 'create_checkpoint',
        description: 'Create a named checkpoint. Use when user says "save this version" or "checkpoint".',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Checkpoint name/description',
            },
          },
          required: ['name'],
        },
      },
    },
    execute: async ({ name }, authToken, context) => {
      try {
        const { workflowId, workflowState } = context;

        if (!workflowId || !workflowState) {
          return JSON.stringify({ success: false, error: 'No workflow context available' });
        }

        const result = await WorkflowVersionService.createCheckpoint(workflowId, name, workflowState);

        return JSON.stringify({
          success: true,
          message: `Created checkpoint "${name}" (version ${result.versionNumber})`,
          versionId: result.versionId,
          versionNumber: result.versionNumber,
        });
      } catch (error) {
        console.error('[WorkflowTools] Error in create_checkpoint:', error);
        return JSON.stringify({ success: false, error: error.message });
      }
    },
  },

  // ============================================================================
  // EXISTING WORKFLOW TOOLS (UNCHANGED)
  // ============================================================================

  get_available_tool_node_types: {
    schema: {
      type: 'function',
      function: {
        name: 'get_available_tool_node_types',
        description: 'Get a list of all available node types that can be added to workflows',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    execute: async ({}, authToken, context) => {
      try {
        // Load from toolLibrary.json
        const fs = await import('fs/promises');
        const path = await import('path');
        const { fileURLToPath } = await import('url');

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const toolLibraryPath = path.join(__dirname, '../../tools/toolLibrary.json');

        const rawToolLibrary = await fs.readFile(toolLibraryPath, 'utf-8');
        const toolLibraryData = JSON.parse(rawToolLibrary);

        // Transform the toolLibrary data into the expected format
        const nodeTypes = {};

        // Process triggers
        if (toolLibraryData.triggers) {
          nodeTypes['Triggers'] = toolLibraryData.triggers.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'trigger',
          }));
        }

        // Process actions
        if (toolLibraryData.actions) {
          nodeTypes['Actions'] = toolLibraryData.actions.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'action',
          }));
        }

        // Process utilities
        if (toolLibraryData.utilities) {
          nodeTypes['Utilities'] = toolLibraryData.utilities.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'utility',
          }));
        }

        // Process widgets
        if (toolLibraryData.widgets) {
          nodeTypes['Widgets'] = toolLibraryData.widgets.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'widgets',
          }));
        }

        // Process controls
        if (toolLibraryData.controls) {
          nodeTypes['Controls'] = toolLibraryData.controls.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'control',
          }));
        }

        // Process custom
        if (toolLibraryData.custom) {
          nodeTypes['Custom'] = toolLibraryData.custom.map((tool) => ({
            type: tool.type,
            title: tool.title,
            description: tool.description,
            icon: tool.icon,
            category: 'custom',
          }));
        }

        return JSON.stringify({
          success: true,
          nodeTypes,
          message: 'Retrieved all available node types from toolLibrary.json',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to get available node types from toolLibrary.json',
        });
      }
    },
  },

  start_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'start_workflow',
        description: 'Start/activate a workflow to begin listening for triggers',
        parameters: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'The ID of the workflow to start',
            },
          },
          required: ['workflowId'],
        },
      },
    },
    execute: async ({ workflowId }, authToken, context) => {
      try {
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3333}`;

        const response = await fetch(`${baseUrl}/api/workflows/${workflowId}/start`, {
          method: 'POST',
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to start workflow: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return JSON.stringify({
          success: true,
          workflowId,
          message: `Workflow started successfully. Status: ${data.status || 'listening'}`,
          result: data,
          workflowStarted: true,
          status: data.status || 'listening',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to start workflow',
        });
      }
    },
  },

  stop_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'stop_workflow',
        description: 'Stop/deactivate a workflow',
        parameters: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'The ID of the workflow to stop',
            },
          },
          required: ['workflowId'],
        },
      },
    },
    execute: async ({ workflowId }, authToken, context) => {
      try {
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3333}`;

        const response = await fetch(`${baseUrl}/api/workflows/${workflowId}/stop`, {
          method: 'POST',
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to stop workflow: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return JSON.stringify({
          success: true,
          workflowId,
          message: `Workflow stopped successfully. Status: ${data.status || 'stopped'}`,
          result: data,
          workflowStopped: true,
          status: data.status || 'stopped',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to stop workflow',
        });
      }
    },
  },

};

export async function getWorkflowToolSchemas() {
  return Object.values(TOOLS).map((tool) => tool.schema);
}

export async function executeWorkflowTool(toolName, args, authToken, context) {
  const tool = TOOLS[toolName];
  if (!tool) {
    throw new Error(`Unknown workflow tool: ${toolName}`);
  }

  return await tool.execute(args, authToken, context);
}
