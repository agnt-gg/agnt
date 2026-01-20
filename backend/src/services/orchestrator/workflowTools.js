// Note: API_CONFIG would normally be imported, but for backend we'll use environment variables
// import { API_CONFIG } from '../../../frontend/src/tt.config.js';
import log from '../../utils/logger.js';
import StreamEngine from '../../stream/StreamEngine.js';

export const TOOLS = {
  modify_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'modify_workflow',
        description: 'Modify the current workflow by regenerating the DAG with LLM assistance',
        parameters: {
          type: 'object',
          properties: {
            modificationRequest: {
              type: 'string',
              description: 'A description of the modification to make to the workflow',
            },
          },
          required: ['modificationRequest'],
        },
      },
    },
    execute: async ({ modificationRequest }, authToken, context) => {
      try {
        const { workflowState, llmClient, provider, model } = context;

        if (!workflowState) {
          return JSON.stringify({
            success: false,
            error: 'No workflow state available in context',
          });
        }

        if (!llmClient) {
          return JSON.stringify({
            success: false,
            error: 'No LLM client available in context',
          });
        }

        // Create a copy of the workflow state to modify
        const currentWorkflow = JSON.parse(JSON.stringify(workflowState));

        // Extract user ID from auth token
        let userId = null;
        if (authToken && authToken.startsWith('Bearer ')) {
          try {
            const token = authToken.split(' ')[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id || null;
          } catch (e) {
            console.error('Could not decode token for workflow modification:', e);
          }
        }

        // Get available node types to provide context to the LLM
        const availableNodeTypes = await TOOLS.get_available_tool_node_types.execute({}, authToken, context);

        // Format the available tools as a string
        const availableToolsString = JSON.stringify(JSON.parse(availableNodeTypes).nodeTypes, null, 2);

        // Create a StreamEngine instance with the userId
        const streamEngine = new StreamEngine(userId);

        // Prepare the workflow elements for the generateWorkflow function
        const workflowElements = {
          overview: modificationRequest,
          availableTools: availableToolsString,
          customTools: currentWorkflow.customTools || [],
          currentWorkflow: JSON.stringify(currentWorkflow, null, 2),
        };

        // Call the generateWorkflow function
        const generatedWorkflowResult = await streamEngine.generateWorkflow(workflowElements, provider, model);

        // Extract the workflow from the result
        let generatedWorkflow;
        if (typeof generatedWorkflowResult === 'string') {
          // If it's a string, parse it as JSON
          generatedWorkflow = JSON.parse(generatedWorkflowResult);
        } else if (generatedWorkflowResult.workflow) {
          // If it's an object with a workflow property, parse that
          generatedWorkflow = JSON.parse(generatedWorkflowResult.workflow);
        } else {
          // If it's already an object, use it directly
          generatedWorkflow = generatedWorkflowResult;
        }

        // Ensure the modified workflow has the required structure
        if (!generatedWorkflow.nodes || !generatedWorkflow.edges) {
          return JSON.stringify({
            success: false,
            error: 'LLM response does not contain valid workflow structure',
            details: 'Workflow must have nodes and edges arrays',
          });
        }

        // CRITICAL: Always preserve the original workflow ID
        const workflowForFrontend = {
          ...generatedWorkflow,
          id: currentWorkflow.id || `workflow_${Date.now()}`, // Always use current workflow ID
          name: generatedWorkflow.name || currentWorkflow.name || 'My Workflow',
          zoomLevel: generatedWorkflow.zoomLevel || currentWorkflow.zoomLevel || 1,
          canvasOffsetX: generatedWorkflow.canvasOffsetX || currentWorkflow.canvasOffsetX || 0,
          canvasOffsetY: generatedWorkflow.canvasOffsetY || currentWorkflow.canvasOffsetY || 0,
          isTinyNodeMode: generatedWorkflow.isTinyNodeMode !== undefined ? generatedWorkflow.isTinyNodeMode : currentWorkflow.isTinyNodeMode || false,
          isShareable: generatedWorkflow.isShareable !== undefined ? generatedWorkflow.isShareable : currentWorkflow.isShareable || false,
          customTools: generatedWorkflow.customTools || currentWorkflow.customTools || [],
        };

        return JSON.stringify({
          success: true,
          message: 'Successfully modified workflow using LLM regeneration.',
          updatedWorkflow: workflowForFrontend,
          suggestion: 'The workflow has been modified according to your request. Please review the changes.',
        });
      } catch (error) {
        console.error('Error in modify_workflow:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to modify workflow',
        });
      }
    },
  },
  // save_workflow: {
  //   schema: {
  //     type: 'function',
  //     function: {
  //       name: 'save_workflow',
  //       description: 'Save the current workflow with optional name change',
  //       parameters: {
  //         type: 'object',
  //         properties: {
  //           name: {
  //             type: 'string',
  //             description: 'New name for the workflow (optional)',
  //           },
  //           silent: {
  //             type: 'boolean',
  //             description: 'Whether to save silently without user prompts',
  //             default: true,
  //           },
  //         },
  //       },
  //     },
  //   },
  //   execute: async ({ name, silent = true }, authToken, context) => {
  //     try {
  //       const { workflowState, workflowId } = context;

  //       if (!workflowState) {
  //         return JSON.stringify({
  //           success: false,
  //           error: 'No workflow state available in context',
  //         });
  //       }

  //       // CRITICAL: Always use the workflowId from context, NOT from workflowState
  //       const originalWorkflowId = workflowId || workflowState.id;

  //       // Use the exact workflow state from context - no LLM regeneration
  //       const state = {
  //         ...workflowState,
  //         name: name || workflowState.name || 'My Workflow',
  //         id: originalWorkflowId, // Force use of original ID
  //       };

  //       // Make API call to save the workflow
  //       const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3333}`;
  //       const response = await fetch(`${baseUrl}/api/workflows/save`, {
  //         method: 'POST',
  //         headers: {
  //           'Content-Type': 'application/json',
  //           Authorization: authToken,
  //         },
  //         body: JSON.stringify({ workflow: state }),
  //       });

  //       if (!response.ok) {
  //         const errorData = await response.json().catch(() => ({}));
  //         throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  //       }

  //       const data = await response.json();

  //       // Return the exact state that was provided
  //       return JSON.stringify({
  //         success: true,
  //         message: `Workflow saved${name ? ` with name "${name}"` : ''}.`,
  //         name: state.name,
  //         silent,
  //         updatedWorkflow: state,
  //         suggestion: `The workflow has been saved${name ? ` with the new name "${name}"` : ''}.`,
  //       });
  //     } catch (error) {
  //       return JSON.stringify({
  //         success: false,
  //         error: error.message,
  //         message: 'Failed to save workflow',
  //       });
  //     }
  //   },
  // },
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

        // Return with a special flag to indicate workflow was started
        return JSON.stringify({
          success: true,
          workflowId,
          message: `Workflow started successfully. Status: ${data.status || 'listening'}`,
          result: data,
          workflowStarted: true, // Special flag to trigger UI updates
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

        // Return with a special flag to indicate workflow was stopped
        return JSON.stringify({
          success: true,
          workflowId,
          message: `Workflow stopped successfully. Status: ${data.status || 'stopped'}`,
          result: data,
          workflowStopped: true, // Special flag to trigger UI updates
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
  rename_workflow: {
    schema: {
      type: 'function',
      function: {
        name: 'rename_workflow',
        description: 'Rename a workflow',
        parameters: {
          type: 'object',
          properties: {
            workflowId: {
              type: 'string',
              description: 'The ID of the workflow to rename',
            },
            newName: {
              type: 'string',
              description: 'The new name for the workflow',
            },
          },
          required: ['workflowId', 'newName'],
        },
      },
    },
    execute: async ({ workflowId, newName }, authToken, context) => {
      try {
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3333}`;

        const response = await fetch(`${baseUrl}/api/workflows/${workflowId}/name`, {
          method: 'PUT',
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: newName }),
        });

        if (!response.ok) {
          throw new Error(`Failed to rename workflow: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return JSON.stringify({
          success: true,
          workflowId,
          newName,
          message: `Workflow renamed to "${newName}" successfully`,
          result: data,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to rename workflow',
        });
      }
    },
  },
  list_all_workflows: {
    schema: {
      type: 'function',
      function: {
        name: 'list_all_workflows',
        description: 'Get a list of all workflows for the current user',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['all', 'running', 'stopped', 'listening', 'error'],
              description: 'Filter workflows by status (optional)',
            },
          },
        },
      },
    },
    execute: async ({ status }, authToken, context) => {
      try {
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3333}`;

        let url = `${baseUrl}/api/workflows`;
        if (status && status !== 'all') {
          url += `?status=${status}`;
        }

        const response = await fetch(url, {
          headers: {
            Authorization: authToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to list workflows: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const workflows = data.workflows || [];

        // Provide summary information
        const summary = {
          total: workflows.length,
          byStatus: workflows.reduce((acc, wf) => {
            acc[wf.status] = (acc[wf.status] || 0) + 1;
            return acc;
          }, {}),
        };

        return JSON.stringify({
          success: true,
          workflows: workflows.map((wf) => ({
            id: wf.id,
            name: wf.name,
            status: wf.status,
            created_at: wf.created_at,
            updated_at: wf.updated_at,
            nodeCount: wf.nodes?.length || 0,
          })),
          summary,
          message: `Found ${workflows.length} workflows${status && status !== 'all' ? ` with status: ${status}` : ''}`,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to list workflows',
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
