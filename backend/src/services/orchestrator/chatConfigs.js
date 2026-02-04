import { getAvailableToolSchemas } from './tools.js';
import { getAgentToolSchemas } from './agentTools.js';
import { getWorkflowToolSchemas } from './workflowTools.js';
import { getGoalToolSchemas } from './goalTools.js';
import { getOrchestratorSystemContent } from './system-prompts/orchestrator-chat.js';
import { getAgentSystemContent } from './system-prompts/agent-chat.js';
import { getWorkflowSystemContent } from './system-prompts/workflow-chat.js';

/**
 * Configuration for different chat types in the universal handler
 */
export const CHAT_CONFIGS = {
  orchestrator: {
    name: 'orchestrator',
    async getToolSchemas(context) {
      return await getAvailableToolSchemas();
    },
    buildSystemPrompt(currentDate, context) {
      const availableToolsList = context.toolSchemas.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join('\n');
      return getOrchestratorSystemContent(currentDate, availableToolsList);
    },
    maxToolRounds: 100,
    responseType: 'stream',
    contextKey: null, // Uses default orchestrator context
  },

  agent: {
    name: 'agent',
    async getToolSchemas(context) {
      // Check if this is agent management chat (AgentForge) or chatting WITH a specific agent
      // Agent management: agentId is 'agent-chat' (special ID for AgentForge)
      // Chatting with agent: agentId is an actual agent ID AND has agentContext.systemPrompt
      const isAgentManagement = context.agentId === 'agent-chat';

      if (isAgentManagement) {
        // This is agent management chat (AgentForge) - use AGENT_TOOLS for creating/modifying agents
        console.log('Agent management chat detected (AgentForge) - using AGENT_TOOLS');
        return await getAgentToolSchemas();
      }

      // This is chatting WITH a specific agent - use the agent's assigned tools
      console.log(`Chatting with agent ${context.agentId} - loading agent's assigned tools`);

      // If we have agent context with tools already loaded, use them
      if (context.agentContext && context.agentContext.availableTools) {
        console.log(`Using pre-loaded tools for agent ${context.agentId}`);
        return context.agentContext.availableTools;
      }

      // Otherwise, fetch agent's assigned tools from database
      if (context.agentId) {
        try {
          const AgentModel = (await import('../../models/AgentModel.js')).default;
          const agent = await AgentModel.findOne(context.agentId);

          if (agent && agent.assignedTools) {
            const { getAvailableToolSchemas } = await import('./tools.js');
            const allTools = await getAvailableToolSchemas();

            // Filter to only tools assigned to this agent
            const assignedToolNames = Array.isArray(agent.assignedTools) ? agent.assignedTools : [];
            const agentTools = allTools.filter((tool) => assignedToolNames.includes(tool.function.name));

            console.log(`Agent ${context.agentId} has ${agentTools.length} assigned tools:`, assignedToolNames);
            return agentTools;
          }
        } catch (error) {
          console.error('Error getting agent assigned tools:', error);
        }
      }

      // Fallback to empty tools if agent has no assigned tools
      console.warn('No assigned tools found for agent, returning empty tool set');
      return [];
    },
    buildSystemPrompt(currentDate, context) {
      const { agentId, agentContext, agentState, toolSchemas } = context;

      // Check if this is agent management chat (AgentForge)
      const isAgentManagement = agentId === 'agent-chat';

      if (isAgentManagement) {
        // Use the agent management system prompt (Annie for creating/managing agents)
        console.log('Using agent management system prompt for AgentForge');
        return getAgentSystemContent(currentDate, agentId, agentContext, agentState);
      }

      // This is chatting WITH a specific agent - use the agent's custom system prompt
      console.log(`Using custom system prompt for agent ${agentId}`);

      // If we have agent context from AgentService, use it
      if (agentContext && agentContext.systemPrompt) {
        return agentContext.systemPrompt;
      }

      // Otherwise build a basic system prompt with the agent's assigned tools
      const toolsList =
        toolSchemas && toolSchemas.length > 0
          ? toolSchemas.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join('\n')
          : '- No tools assigned to this agent';

      return `Current date and time: ${currentDate}

You are an AI agent with specific assigned tools. Use only the tools assigned to you.

AVAILABLE TOOLS:
${toolsList}

Use your assigned tools effectively to help the user accomplish their goals.`;
    },
    maxToolRounds: 10,
    responseType: 'stream',
    contextKey: 'agentContext',
  },

  workflow: {
    name: 'workflow',
    async getToolSchemas(context) {
      return await getWorkflowToolSchemas();
    },
    async buildSystemPrompt(currentDate, context) {
      const { workflowId, workflowContext, workflowState } = context;
      return await getWorkflowSystemContent(currentDate, workflowId, workflowContext, workflowState);
    },
    maxToolRounds: 25,
    responseType: 'stream',
    contextKey: 'workflowContext',
  },

  tool: {
    name: 'tool',
    async getToolSchemas(context) {
      // Tool chat uses a specific set of tool management functions
      return [
        {
          type: 'function',
          function: {
            name: 'generate_tool_update',
            description: 'Use AI to generate, create, or update a tool based on natural language instructions',
            parameters: {
              type: 'object',
              properties: {
                instruction: {
                  type: 'string',
                  description: 'Natural language instruction describing what to do with the tool',
                },
                currentToolState: {
                  type: 'object',
                  description: 'Current state/configuration of the tool being modified (optional)',
                },
                operationType: {
                  type: 'string',
                  enum: ['create', 'update', 'modify'],
                  description: 'Type of operation to perform',
                },
              },
              required: ['instruction'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'save_tool',
            description: 'Save the current tool to the database',
            parameters: {
              type: 'object',
              properties: {
                toolData: { type: 'object', description: 'The tool data to save' },
                isShareable: { type: 'boolean', description: 'Whether the tool should be shareable' },
              },
              required: ['toolData'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'load_tool',
            description: 'Load a tool by its ID',
            parameters: {
              type: 'object',
              properties: {
                toolId: { type: 'string', description: 'The ID of the tool to load' },
              },
              required: ['toolId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'delete_tool',
            description: 'Delete a tool from the database',
            parameters: {
              type: 'object',
              properties: {
                toolId: { type: 'string', description: 'The ID of the tool to delete' },
              },
              required: ['toolId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'list_tools',
            description: 'List all available tools',
            parameters: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Filter by category (optional)' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'run_tool',
            description: 'Execute/run the current tool with provided parameters',
            parameters: {
              type: 'object',
              properties: {
                toolData: { type: 'object', description: 'The tool configuration to run' },
                parameters: { type: 'object', description: 'The parameters to pass to the tool' },
              },
              required: ['toolData'],
            },
          },
        },
      ];
    },
    buildSystemPrompt(currentDate, context) {
      const { toolId, toolContext, toolState } = context;
      return `You are Annie, a helpful AI assistant specialized in creating and managing tools using AI-powered generation.
You have access to powerful functions that can create, modify, and manage tools through natural language instructions.
Current date: ${currentDate}
Tool ID: ${toolId}
Tool context: ${JSON.stringify(toolContext)}
Tool state: ${JSON.stringify(toolState)}

AVAILABLE FUNCTIONS:
1. **generate_tool_update** - Your primary function for all tool creation and modification tasks
2. **save_tool** - Save a tool configuration to the database
3. **load_tool** - Load an existing tool by ID
4. **delete_tool** - Remove a tool from the database
5. **list_tools** - Show all available tools
6. **run_tool** - Execute a tool with specific parameters

Always be helpful, creative, and guide users through the tool creation process step by step.`;
    },
    maxToolRounds: 10,
    responseType: 'stream',
    contextKey: 'toolContext',
  },

  goal: {
    name: 'goal',
    async getToolSchemas(context) {
      return await getGoalToolSchemas();
    },
    buildSystemPrompt(currentDate, context) {
      return `You are Annie, a helpful AI assistant specialized in goal management and task orchestration.
Current date: ${currentDate}

You have access to comprehensive goal management functions that allow you to:
- Create and break down goals into actionable tasks
- Execute and monitor goal progress
- Manage goal lifecycles (pause, resume, delete)
- Track goal status and completion

Always be proactive in helping users achieve their goals through structured task management.`;
    },
    maxToolRounds: 10,
    responseType: 'stream',
    contextKey: 'goalContext',
  },

  suggestions: {
    name: 'suggestions',
    async getToolSchemas(context) {
      // Suggestions don't need tools, they just generate contextual suggestions
      return [];
    },
    buildSystemPrompt(currentDate, context) {
      const { agentContext } = context;
      let availableToolsList = '';

      if (agentContext && agentContext.availableTools) {
        availableToolsList = agentContext.availableTools.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join('\n');
      }

      return `You are a helpful assistant that generates smart, contextual suggestions for the user based on their conversation history.
        
Your task is to analyze the conversation and generate 3 relevant suggestions that:
1. Build upon what was just discussed
2. Explore related topics or next logical steps
3. Showcase the available tools when appropriate

Available tools to reference in suggestions:
${availableToolsList}

Return ONLY a JSON array with exactly 3 suggestion objects, each with:
- text: The suggestion text (keep it concise, action-oriented)
- icon: An appropriate emoji or symbol

Make suggestions relevant to the conversation context.

IMPORTANT: Return ONLY the JSON array, no markdown formatting, no code blocks, no extra text.`;
    },
    maxToolRounds: 0, // Suggestions don't use tools
    responseType: 'json', // Suggestions return JSON, not stream
    contextKey: 'agentContext',
  },
};

/**
 * Detect chat type from request path and body
 */
export function detectChatType(req, context = {}) {
  const path = req.path || req.route?.path || '';

  // Check route path first
  if (path.includes('/agent-chat')) return 'agent';
  if (path.includes('/workflow-chat')) return 'workflow';
  if (path.includes('/tool-chat')) return 'tool';
  if (path.includes('/goal-chat')) return 'goal';
  if (path.includes('/suggestions')) return 'suggestions';

  // Check request body for context clues
  const body = req.body || {};
  if (body.agentId || body.agentContext || body.agentState) return 'agent';
  if (body.workflowId || body.workflowContext || body.workflowState) return 'workflow';
  if (body.toolId || body.toolContext || body.toolState) return 'tool';
  if (body.goalId || body.goalContext) return 'goal';

  // Check explicit context parameter
  if (context.type) return context.type;

  // Default to orchestrator
  return 'orchestrator';
}

/**
 * Get configuration for a specific chat type
 */
export function getChatConfig(chatType) {
  const config = CHAT_CONFIGS[chatType];
  if (!config) {
    console.warn(`Unknown chat type: ${chatType}, falling back to orchestrator`);
    return CHAT_CONFIGS.orchestrator;
  }
  return config;
}
