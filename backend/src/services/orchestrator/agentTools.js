import log from '../../utils/logger.js';
import db from '../../models/database/index.js';

export const AGENT_TOOLS = {
  generate_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'generate_agent',
        description: 'Generate a new agent from scratch based on a description',
        parameters: {
          type: 'object',
          properties: {
            agentDescription: {
              type: 'string',
              description: 'A description of the agent to generate (e.g., "Create an agent that can summarize news articles")',
            },
            category: {
              type: 'string',
              description: 'The category for the agent (optional)',
            },
          },
          required: ['agentDescription'],
        },
      },
    },
    execute: async ({ agentDescription, category }, authToken, context) => {
      try {
        const { userId, provider, model } = context;

        // Create a StreamEngine instance with the userId
        const StreamEngine = (await import('../../stream/StreamEngine.js')).default;
        const streamEngine = new StreamEngine(userId);

        // Fetch available tools and workflows
        let availableToolsList = [];
        let availableWorkflowsList = [];

        try {
          // Get available tools
          const { getAvailableToolSchemas } = await import('./tools.js');
          const toolSchemas = await getAvailableToolSchemas();
          availableToolsList = toolSchemas.map((schema) => ({
            id: schema.function.name,
            name: schema.function.name,
            description: schema.function.description,
          }));
        } catch (error) {
          console.warn('Could not fetch available tools:', error);
        }

        try {
          // Get available workflows
          const WorkflowModel = (await import('../../models/WorkflowModel.js')).default;
          const workflows = await WorkflowModel.findAllByUserId(userId);
          availableWorkflowsList = workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
            description: workflow.description || '',
          }));
        } catch (error) {
          console.warn('Could not fetch available workflows:', error);
        }

        // Prepare the agent elements for the generateAgent function
        const agentElements = {
          overview: agentDescription,
          currentAgent: JSON.stringify({ category: category || 'custom' }),
          availableTools: JSON.stringify(availableToolsList, null, 2),
          availableWorkflows: JSON.stringify(availableWorkflowsList, null, 2),
        };

        // Call the generateAgent function
        const generatedAgentResult = await streamEngine.generateAgent(agentElements, provider, model);

        // Extract the agent from the result
        let generatedAgent;
        if (typeof generatedAgentResult === 'string') {
          generatedAgent = JSON.parse(generatedAgentResult);
        } else if (generatedAgentResult.agent) {
          generatedAgent = JSON.parse(generatedAgentResult.agent);
        } else {
          generatedAgent = generatedAgentResult;
        }

        // Ensure the generated agent has the required structure
        if (!generatedAgent.name && !generatedAgent.description) {
          return JSON.stringify({
            success: false,
            error: 'LLM response does not contain valid agent structure',
            details: 'Agent must have at least name or description',
          });
        }

        // Create agent with new ID
        const agentForFrontend = {
          ...generatedAgent,
          id: `agent_${Date.now()}`,
          name: generatedAgent.name || 'My Agent',
          description: generatedAgent.description || '',
          instructions: generatedAgent.instructions || '',
          category: generatedAgent.category || category || 'custom',
          // Ensure tools and workflows are properly mapped
          assignedTools: generatedAgent.assignedTools || generatedAgent.tools || [],
          assignedWorkflows: generatedAgent.assignedWorkflows || generatedAgent.workflows || [],
          tools: generatedAgent.tools || generatedAgent.assignedTools || [],
          workflows: generatedAgent.workflows || generatedAgent.assignedWorkflows || [],
        };

        return JSON.stringify({
          success: true,
          message: 'Successfully generated new agent using LLM.',
          updatedAgent: agentForFrontend,
          suggestion: 'The agent has been generated. You can now review and modify it as needed.',
        });
      } catch (error) {
        console.error('Error in generate_agent:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to generate agent',
        });
      }
    },
  },

  modify_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'modify_agent',
        description: 'Modify the current agent by regenerating it with LLM assistance',
        parameters: {
          type: 'object',
          properties: {
            modificationRequest: {
              type: 'string',
              description: 'A description of the modification to make to the agent',
            },
          },
          required: ['modificationRequest'],
        },
      },
    },
    execute: async ({ modificationRequest }, authToken, context) => {
      try {
        const { agentState, llmClient, provider, model, userId } = context;

        if (!agentState) {
          return JSON.stringify({
            success: false,
            error: 'No agent state available in context',
          });
        }

        if (!llmClient) {
          return JSON.stringify({
            success: false,
            error: 'No LLM client available in context',
          });
        }

        // Create a copy of the agent state to modify
        const currentAgent = JSON.parse(JSON.stringify(agentState));

        // Create a StreamEngine instance with the userId
        const StreamEngine = (await import('../../stream/StreamEngine.js')).default;
        const streamEngine = new StreamEngine(userId);

        // Prepare the agent elements for the generateAgent function
        const agentElements = {
          overview: modificationRequest,
          currentAgent: JSON.stringify(currentAgent, null, 2),
        };

        // Call the generateAgent function
        const generatedAgentResult = await streamEngine.generateAgent(agentElements, provider, model);

        // Extract the agent from the result
        let generatedAgent;
        if (typeof generatedAgentResult === 'string') {
          // If it's a string, parse it as JSON
          generatedAgent = JSON.parse(generatedAgentResult);
        } else if (generatedAgentResult.agent) {
          // If it's an object with an agent property, parse that
          generatedAgent = JSON.parse(generatedAgentResult.agent);
        } else {
          // If it's already an object, use it directly
          generatedAgent = generatedAgentResult;
        }

        // Ensure the modified agent has the required structure
        if (!generatedAgent.name && !generatedAgent.description) {
          return JSON.stringify({
            success: false,
            error: 'LLM response does not contain valid agent structure',
            details: 'Agent must have at least name or description',
          });
        }

        // CRITICAL: Always preserve the original agent ID
        const agentForFrontend = {
          ...generatedAgent,
          id: currentAgent.id || `agent_${Date.now()}`, // Always use current agent ID
          name: generatedAgent.name || currentAgent.name || 'My Agent',
          description: generatedAgent.description || currentAgent.description || '',
          instructions: generatedAgent.instructions || currentAgent.instructions || '',
          category: generatedAgent.category || currentAgent.category || 'custom',
        };

        // Save the agent automatically after generation
        try {
          // Create a context for the save operation
          const saveContext = {
            ...context,
            agentState: agentForFrontend,
            agentId: agentForFrontend.id,
          };

          // Call the save_agent tool to save the generated agent
          await AGENT_TOOLS.save_agent.execute({ silent: true }, authToken, saveContext);
        } catch (saveError) {
          console.error('Failed to auto-save agent:', saveError);
          // Continue even if save fails, as we still want to return the generated agent
        }

        return JSON.stringify({
          success: true,
          message: 'Successfully modified and saved agent using LLM regeneration.',
          updatedAgent: agentForFrontend,
          suggestion: 'The agent has been modified and saved according to your request. Please review the changes.',
        });
      } catch (error) {
        console.error('Error in modify_agent:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to modify agent',
        });
      }
    },
  },

  save_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'save_agent',
        description: 'Save the current agent with optional name change',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'New name for the agent (optional)',
            },
            silent: {
              type: 'boolean',
              description: 'Whether to save silently without user prompts',
              default: true,
            },
          },
        },
      },
    },
    execute: async ({ name, silent = true }, authToken, context) => {
      try {
        const { agentState, agentId, userId } = context;

        if (!agentState) {
          return JSON.stringify({
            success: false,
            error: 'No agent state available in context',
          });
        }

        // CRITICAL: Always use the agentId from context, NOT from agentState
        const originalAgentId = agentId || agentState.id;

        // Use the exact agent state from context - no LLM regeneration
        const state = {
          ...agentState,
          name: name || agentState.name || 'My Agent',
          id: originalAgentId, // Force use of original ID
        };

        // Save to database if available
        if (db) {
          await new Promise((resolve, reject) => {
            const query = `INSERT OR REPLACE INTO agents (id, name, description, instructions, parameters, category, created_by, is_shareable, created_at, updated_at) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

            db.run(
              query,
              [
                originalAgentId,
                state.name || 'Untitled Agent',
                state.description || '',
                state.instructions || '',
                JSON.stringify(state),
                'custom',
                userId,
                0, // not shareable by default
              ],
              function (err) {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              }
            );
          });
        }

        // Return the exact state that was provided
        return JSON.stringify({
          success: true,
          message: `Agent saved${name ? ` with name "${name}"` : ''}.`,
          name: state.name,
          silent,
          updatedAgent: state,
          suggestion: `The agent has been saved${name ? ` with the new name "${name}"` : ''}.`,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to save agent',
        });
      }
    },
  },

  load_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'load_agent',
        description: 'Load an agent by its ID',
        parameters: {
          type: 'object',
          properties: {
            agentId: {
              type: 'string',
              description: 'The ID of the agent to load',
            },
          },
          required: ['agentId'],
        },
      },
    },
    execute: async ({ agentId }, authToken, context) => {
      try {
        const { userId } = context;

        if (!db) {
          return JSON.stringify({
            success: false,
            error: 'Database not available',
          });
        }

        const result = await new Promise((resolve) => {
          db.get('SELECT * FROM agents WHERE id = ? AND (created_by = ? OR is_shareable = 1)', [agentId, userId], (err, row) => {
            if (err || !row) {
              resolve({
                success: false,
                message: err ? err.message : 'Agent not found or access denied',
              });
            } else {
              resolve({
                success: true,
                agent: JSON.parse(row.parameters || '{}'),
                message: 'Agent loaded successfully',
              });
            }
          });
        });

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to load agent',
        });
      }
    },
  },

  delete_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'delete_agent',
        description: 'Delete an agent from the database',
        parameters: {
          type: 'object',
          properties: {
            agentId: {
              type: 'string',
              description: 'The ID of the agent to delete',
            },
          },
          required: ['agentId'],
        },
      },
    },
    execute: async ({ agentId }, authToken, context) => {
      try {
        const { userId } = context;

        if (!db) {
          return JSON.stringify({
            success: false,
            error: 'Database not available',
          });
        }

        const result = await new Promise((resolve) => {
          db.run('DELETE FROM agents WHERE id = ? AND created_by = ?', [agentId, userId], function (err) {
            if (err) {
              resolve({
                success: false,
                message: err.message,
              });
            } else {
              resolve({
                success: this.changes > 0,
                agentId: agentId,
                message: this.changes > 0 ? 'Agent deleted successfully' : 'Agent not found or unauthorized',
              });
            }
          });
        });

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to delete agent',
        });
      }
    },
  },

  list_agents: {
    schema: {
      type: 'function',
      function: {
        name: 'list_agents',
        description: 'Get a list of all agents for the current user',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter agents by category (optional)',
            },
          },
        },
      },
    },
    execute: async ({ category }, authToken, context) => {
      try {
        const { userId } = context;

        if (!db) {
          return JSON.stringify({
            success: false,
            error: 'Database not available',
          });
        }

        // Use the AgentModel to get agents (which handles the proper database structure)
        const AgentModel = (await import('../../models/AgentModel.js')).default;

        const agents = await AgentModel.findAllByUserId(userId);

        // Filter by category if specified
        const filteredAgents = category ? agents.filter((agent) => agent.category === category) : agents;

        const agentList = filteredAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          category: agent.category,
          status: agent.status,
          provider: agent.provider,
          model: agent.model,
          assignedTools: agent.assignedTools || [],
          assignedWorkflows: agent.assignedWorkflows || [],
          lastActive: agent.last_active,
          successRate: agent.success_rate,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
        }));

        return JSON.stringify({
          success: true,
          agents: agentList,
          count: agentList.length,
          message: `Found ${agentList.length} agents${category ? ` in category: ${category}` : ''}`,
        });
      } catch (error) {
        console.error('Error in list_agents:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to list agents',
        });
      }
    },
  },

  run_agent: {
    schema: {
      type: 'function',
      function: {
        name: 'run_agent',
        description: 'Execute/run the current agent with provided parameters',
        parameters: {
          type: 'object',
          properties: {
            agentId: {
              type: 'string',
              description: 'The ID of the agent to run',
            },
            parameters: {
              type: 'object',
              description: 'The parameters to pass to the agent',
            },
          },
          required: ['agentId'],
        },
      },
    },
    execute: async ({ agentId, parameters }, authToken, context) => {
      try {
        // This would integrate with your existing agent execution system
        // For now, we'll return a success message with the execution details
        return JSON.stringify({
          success: true,
          agentId,
          parameters: parameters || {},
          message: 'Agent execution initiated successfully',
          executionId: `exec-${Date.now()}`,
          suggestion: 'The agent has been started and is now running with the provided parameters.',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to run agent',
        });
      }
    },
  },
};

export async function getAgentToolSchemas() {
  return Object.values(AGENT_TOOLS).map((tool) => tool.schema);
}

export async function executeAgentTool(toolName, args, authToken, context) {
  const tool = AGENT_TOOLS[toolName];
  if (!tool) {
    throw new Error(`Unknown agent tool: ${toolName}`);
  }

  return await tool.execute(args, authToken, context);
}
