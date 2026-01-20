import AgentModel from '../models/AgentModel.js';
import UserModel from '../models/UserModel.js';
import generateUUID from '../utils/generateUUID.js';
import openai from '../services/ai/providers/OpenAI.js';
import universalChatHandler from './OrchestratorService.js';
import {
  CRITICAL_IMAGE_HANDLING,
  CRITICAL_IMAGE_GENERATION,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  IMAGE_ANALYSIS_CAPABILITIES,
  IMAGE_GENERATION_CAPABILITIES,
  RESPONSE_FORMATTING,
  CRITICAL_IMAGE_REFERENCE_FORMATTING,
  IMPORTANT_GUIDELINES,
  MERMAID_CHART_CHEATSHEET,
  MCP_TOOL_USE_RULES,
  CRITICAL_TOOL_RESPONSE_RULES,
} from './orchestrator/system-prompts/orchestrator-chat.js';

class AgentService {
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }
  async saveOrUpdateAgent(req, res) {
    try {
      const { agent } = req.body;
      const userId = req.user.userId;

      console.log('Received agent data:', agent);

      // Ensure assignedTools and assignedWorkflows are arrays
      agent.assignedTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : [];
      agent.assignedWorkflows = Array.isArray(agent.assignedWorkflows) ? agent.assignedWorkflows : [];

      const existingAgent = agent.id ? await AgentModel.findOne(agent.id) : null;
      let isNewAgent = !existingAgent;

      if (isNewAgent) {
        agent.id = generateUUID();

        // Set default provider and model from user settings if not provided
        if (!agent.provider || !agent.model) {
          try {
            const userSettings = await UserModel.getUserSettings(userId);
            if (!agent.provider) {
              agent.provider = userSettings.selectedProvider || 'Anthropic';
            }
            if (!agent.model) {
              agent.model = userSettings.selectedModel || 'claude-3-5-sonnet-20240620';
            }
            console.log(`Set default provider/model for new agent: ${agent.provider}/${agent.model}`);
          } catch (settingsError) {
            console.warn('Could not fetch user settings for agent defaults:', settingsError);
            // Use hardcoded defaults if user settings fetch fails
            agent.provider = agent.provider || 'Anthropic';
            agent.model = agent.model || 'claude-3-5-sonnet-20240620';
          }
        }
      } else if (existingAgent.created_by !== userId) {
        agent.id = generateUUID();
        isNewAgent = true;

        // Set default provider and model from user settings for cloned agent
        if (!agent.provider || !agent.model) {
          try {
            const userSettings = await UserModel.getUserSettings(userId);
            if (!agent.provider) {
              agent.provider = userSettings.selectedProvider || 'openai';
            }
            if (!agent.model) {
              agent.model = userSettings.selectedModel || 'gpt-4o-mini';
            }
            console.log(`Set default provider/model for cloned agent: ${agent.provider}/${agent.model}`);
          } catch (settingsError) {
            console.warn('Could not fetch user settings for cloned agent defaults:', settingsError);
            // Use hardcoded defaults if user settings fetch fails
            agent.provider = agent.provider || 'Anthropic';
            agent.model = agent.model || 'claude-3-5-sonnet-20240620';
          }
        }
      }

      const result = await AgentModel.createOrUpdate(agent.id, agent, userId);
      res.status(200).json({
        message: isNewAgent ? 'New agent created' : 'Agent updated',
        agentId: agent.id,
      });
    } catch (error) {
      console.error('Error saving/updating agent:', error);
      res.status(500).json({ error: 'Failed to save/update agent', details: error.message });
    }
  }
  async getAllAgents(req, res) {
    try {
      const userId = req.user.userId;
      const agents = await AgentModel.findAllByUserId(userId);
      console.log('Agents fetched from database:', agents);

      // Fetch resources for all agents
      const resources = await AgentModel.findResourcesForAgents(agents.map((a) => a.id));

      const formattedAgents = agents.map((agent) => {
        const resource = resources.find((r) => r.agent_id === agent.id) || {};
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          icon: agent.icon,
          category: agent.category,
          provider: agent.provider,
          model: agent.model,
          assignedTools: agent.assignedTools || [],
          assignedWorkflows: agent.assignedWorkflows || [],
          resourceId: resource.id,
          creditsUsed: resource.credits_used || 0,
          creditLimit: resource.credit_limit || 0,
          workflows: agent.workflow_count,
          lastActive: agent.last_active,
          successRate: agent.success_rate,
        };
      });

      res.json({ agents: formattedAgents });
    } catch (error) {
      console.error('Error retrieving agents:', error);
      res.status(500).json({ error: 'Error retrieving agents' });
    }
  }
  async getAgent(req, res) {
    try {
      const { id } = req.params;
      const agent = await AgentModel.findOne(id);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (agent.created_by === req.user.userId) {
        // Always include assignedTools and assignedWorkflows as arrays
        agent.assignedTools = agent.assignedTools || [];
        agent.assignedWorkflows = agent.assignedWorkflows || [];
        // Include provider and model fields
        agent.provider = agent.provider || '';
        agent.model = agent.model || '';
        res.json(agent);
      } else {
        res.status(403).json({ error: 'You do not have permission to view this agent' });
      }
    } catch (error) {
      console.error('Error retrieving agent:', error);
      res.status(500).json({ error: 'Error retrieving agent' });
    }
  }
  async deleteAgent(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const result = await AgentModel.delete(id, userId);
      if (result === 0) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      res.json({ message: `Agent ${id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting agent:', error);
      res.status(500).json({ error: 'Failed to delete agent', details: error.message });
    }
  }
  async _getAgentContext(agentId, userId) {
    const agent = await AgentModel.findOne(agentId);
    if (!agent) {
      return { error: 'Agent not found', status: 404 };
    }
    if (agent.created_by !== userId) {
      return { error: 'You do not have permission to use this agent', status: 403 };
    }

    const assignedTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : [];

    // Get ALL available tools (same as orchestrator)
    const { getAvailableToolSchemas } = await import('./orchestrator/tools.js');
    const allAvailableTools = await getAvailableToolSchemas();

    // Filter to only tools assigned to this agent
    const availableTools = [];
    const toolExecutorMap = {};

    // Create a map of tool names to schemas for quick lookup
    const toolSchemaMap = new Map();
    allAvailableTools.forEach((toolSchema) => {
      toolSchemaMap.set(toolSchema.function.name, toolSchema);
    });

    for (const toolName of assignedTools) {
      // Check if tool exists in the full orchestrator tool suite
      if (toolSchemaMap.has(toolName)) {
        availableTools.push(toolSchemaMap.get(toolName));
      } else {
        console.warn(`Tool "${toolName}" assigned to agent ${agent.id} but not found in orchestrator tool suite.`);
      }
    }

    // Create dynamic system prompt with current date/time and rich tool information
    const currentDate = new Date().toString();

    // Build detailed tool descriptions like the orchestrator
    const availableToolsList =
      availableTools.length > 0
        ? availableTools
            .map((tool) => {
              const schema = tool.function;
              return `- ${schema.name}: ${schema.description}`;
            })
            .join('\n')
        : '- No tools assigned to this agent';

    const systemPrompt = `Current date and time: ${currentDate}

You are an AI assistant named '${agent.name}'.
Your primary function and persona are defined as follows: ${agent.description}.
You must strictly adhere to this persona and fulfill your designated role while leveraging the operational capabilities described below.

${CRITICAL_IMAGE_HANDLING}

${CRITICAL_IMAGE_GENERATION}

${CRITICAL_TOOL_CALL_REQUIREMENTS}

AVAILABLE TOOLS:
${availableToolsList}

${IMAGE_ANALYSIS_CAPABILITIES}

${IMAGE_GENERATION_CAPABILITIES}

${RESPONSE_FORMATTING}

${CRITICAL_IMAGE_REFERENCE_FORMATTING}

${IMPORTANT_GUIDELINES}

${MERMAID_CHART_CHEATSHEET}

${MCP_TOOL_USE_RULES}

${CRITICAL_TOOL_RESPONSE_RULES}

Remember: You are ${agent.name} with specialized expertise. Use your assigned tools strategically to provide exceptional assistance while maintaining your unique personality and focus area.`;

    return {
      agentContext: {
        systemPrompt,
        availableTools,
        toolExecutorMap,
      },
      provider: agent.provider,
      model: agent.model,
    };
  }
  chatWithAgent = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    const { agentContext, provider, model, error, status } = await this._getAgentContext(id, userId);
    if (error) {
      return res.status(status).json({ error });
    }

    // Use agent-specific provider/model if available, otherwise use request body values
    if (provider) req.body.provider = provider;
    if (model) req.body.model = model;

    // Add agent context and ID to request body for universal handler
    req.body.agentId = id;
    req.body.agentContext = agentContext.agentContext;
    req.body.agentState = agentContext.agentState;

    return universalChatHandler(req, res, { type: 'agent' });
  };
  streamChatWithAgent = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    const { agentContext, provider, model, error, status } = await this._getAgentContext(id, userId);
    if (error) {
      return res.status(status).json({ error });
    }

    // Use agent-specific provider/model if available, otherwise use request body values
    if (provider) req.body.provider = provider;
    if (model) req.body.model = model;

    // Add agent context and ID to request body for universal handler
    req.body.agentId = id;
    req.body.agentContext = agentContext.agentContext;
    req.body.agentState = agentContext.agentState;

    return universalChatHandler(req, res, { type: 'agent' });
  };
  getAgentSuggestions = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    const { agentContext, provider, model, error, status } = await this._getAgentContext(id, userId);
    if (error) {
      return res.status(status).json({ error });
    }

    // Use agent-specific provider/model if available, otherwise use request body values
    if (provider) req.body.provider = provider;
    if (model) req.body.model = model;

    // Add agent context for suggestions
    req.body.agentContext = agentContext.agentContext;

    return universalChatHandler(req, res, { type: 'suggestions' });
  };
}

console.log(`Agent Service Started...`);

export default new AgentService();
