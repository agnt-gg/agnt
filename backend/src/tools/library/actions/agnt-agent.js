import BaseAction from '../BaseAction.js';
import AgentModel from '../../../models/AgentModel.js';
import { createLlmClient } from '../../../services/ai/LlmService.js';
import { createLlmAdapter } from '../../../services/orchestrator/llmAdapters.js';
import { getAvailableToolSchemas, executeTool } from '../../../services/orchestrator/tools.js';
import { randomUUID } from 'crypto';

class AgentTool extends BaseAction {
  static schema = {
    title: 'Agent Chat',
    category: 'action',
    type: 'agnt-agent',
    icon: 'agent',
    description: 'Chat with an AI agent from your agent library. Select an agent and send messages to interact with it within your workflow.',
    parameters: {
      agentId: {
        type: 'string',
        inputType: 'agent-select',
        description: 'Select the agent to chat with',
      },
      message: {
        type: 'string',
        inputType: 'textarea',
        description: 'The message to send to the agent',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the chat was successful',
      },
      response: {
        type: 'string',
        description: "The agent's response",
      },
      agentId: {
        type: 'string',
        description: 'The ID of the agent that responded',
      },
      conversationId: {
        type: 'string',
        description: 'The conversation ID for tracking',
      },
      toolExecutions: {
        type: 'array',
        description: 'Array of tools executed by the agent with their inputs and outputs',
      },
      toolsUsed: {
        type: 'number',
        description: 'Number of tools used by the agent',
      },
      conversationHistory: {
        type: 'array',
        description: 'Updated conversation history',
      },
      error: {
        type: 'string',
        description: 'Error message if the chat failed',
      },
    },
  };

  constructor() {
    super('agnt-agent');
  }

  async execute(params, inputData, workflowEngine) {
    try {
      // Validate required parameters
      if (!params.agentId) {
        return {
          success: false,
          error: 'Agent ID is required',
        };
      }

      if (!params.message) {
        return {
          success: false,
          error: 'Message is required',
        };
      }

      const userId = workflowEngine.userId;

      // Get agent from database
      const agent = await AgentModel.findOne(params.agentId);

      if (!agent) {
        return {
          success: false,
          error: 'Agent not found',
        };
      }

      if (agent.created_by !== userId) {
        return {
          success: false,
          error: 'You do not have permission to use this agent',
        };
      }

      // Use agent's provider/model if set, otherwise fall back to user's global settings
      let provider = agent.provider;
      let model = agent.model;

      if (!provider || !model) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        try {
          const userSettings = await UserModel.getUserSettings(userId);
          provider = provider || userSettings.selectedProvider || 'Anthropic';
          model = model || userSettings.selectedModel || 'claude-3-5-sonnet-20240620';
          console.log(`Using global provider/model for agent: ${provider}/${model}`);
        } catch (settingsError) {
          console.warn('Could not fetch user settings, using defaults:', settingsError);
          provider = provider || 'Anthropic';
          model = model || 'claude-3-5-sonnet-20240620';
        }
      }

      // Get agent's assigned tools
      const assignedTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : [];
      const allAvailableTools = await getAvailableToolSchemas();

      // Filter to only tools assigned to this agent
      const toolSchemaMap = new Map();
      allAvailableTools.forEach((toolSchema) => {
        toolSchemaMap.set(toolSchema.function.name, toolSchema);
      });

      const agentToolSchemas = [];
      for (const toolName of assignedTools) {
        if (toolSchemaMap.has(toolName)) {
          agentToolSchemas.push(toolSchemaMap.get(toolName));
        }
      }

      // Build system prompt
      const currentDate = new Date().toString();
      const availableToolsList =
        agentToolSchemas.length > 0
          ? agentToolSchemas
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

AVAILABLE TOOLS:
${availableToolsList}

CRITICAL TOOL USAGE INSTRUCTIONS:
- When using execute_javascript or execute_javascript_code: ALWAYS use RETURN statements to get output, NOT console.log()
- Example CORRECT: "let x = 5 * 5; x;" or "return 5 * 5;"
- Example WRONG: "console.log(5 * 5);" (this will not capture the result)
- The last expression in your code will be returned as the result
- For calculations, end with the variable name or expression to return it

RESPONSE FORMATTING (VERY IMPORTANT):
- If returning advanced math, LaTeX, or chemical notation, ALWAYS USE MATHJAX WITH DOUBLE DOLLAR SIGNS.
- If returning programming code, enclose it within <pre><code>...</code></pre> tags.
- Always structure your helpful answer in valid, well-formed markdown (e.g., using #, ##, -, *).
- DO NOT INCLUDE the outermost "\`\`\`markdown" or final "\`\`\`" in your result.

Remember: You are ${agent.name} with specialized expertise. Use your assigned tools strategically to provide exceptional assistance while maintaining your unique personality and focus area.`;

      // Prepare messages with system prompt and conversation history
      const messages = [
        { role: 'system', content: systemPrompt },
        ...(params.conversationHistory || []),
        {
          role: 'user',
          content: params.message,
        },
      ];

      // Create LLM client and adapter
      const client = await createLlmClient(provider, userId);
      const adapter = await createLlmAdapter(provider, client, model);

      // Call LLM with agent's tools
      let { responseMessage, toolCalls } = await adapter.call(messages, agentToolSchemas);

      messages.push(responseMessage);

      // Handle tool calls and track executions
      let maxToolCallRounds = 10;
      let currentRound = 0;
      const toolExecutions = [];

      while (toolCalls && toolCalls.length > 0 && currentRound < maxToolCallRounds) {
        currentRound++;

        const toolPromises = toolCalls.map(async (toolCall) => {
          const functionName = toolCall.function.name;
          let functionArgs;

          try {
            functionArgs = JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            const errorResult = {
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: JSON.stringify({
                success: false,
                error: `Failed to parse tool arguments: ${parseError.message}`,
              }),
            };

            // Track failed tool execution
            toolExecutions.push({
              name: functionName,
              arguments: toolCall.function.arguments,
              result: null,
              error: `Failed to parse tool arguments: ${parseError.message}`,
            });

            return errorResult;
          }

          try {
            const toolContext = {
              userId,
              workflowEngine,
            };

            // Don't pass workflowEngine.token - tools use AuthManager.getValidAccessToken(userId, provider) instead
            // Pass null for authToken since tools will get tokens via AuthManager using userId
            const functionResponse = await executeTool(functionName, functionArgs, null, toolContext);

            // Store both raw and parsed response
            let parsedResult = null;
            try {
              parsedResult = JSON.parse(functionResponse);
            } catch (e) {
              console.warn(`Failed to parse tool response for ${functionName}:`, e);
              parsedResult = {};
            }

            // Track tool execution with complete data
            toolExecutions.push({
              name: functionName,
              arguments: functionArgs,
              rawResponse: functionResponse, // Keep raw response
              ...parsedResult, // Spread all parsed fields (success, result, error, outputs, etc.)
            });

            return {
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: functionResponse,
            };
          } catch (executionError) {
            const errorContent = JSON.stringify({
              success: false,
              error: `Tool execution failed: ${executionError.message}`,
            });

            // Track failed tool execution
            toolExecutions.push({
              name: functionName,
              arguments: functionArgs,
              result: null,
              error: `Tool execution failed: ${executionError.message}`,
            });

            return {
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: errorContent,
            };
          }
        });

        const toolResponses = await Promise.all(toolPromises);
        const formattedToolResponses = adapter.formatToolResults(toolResponses);
        messages.push(...formattedToolResponses);

        const nextResponse = await adapter.call(messages, agentToolSchemas);
        responseMessage = nextResponse.responseMessage;
        toolCalls = nextResponse.toolCalls;

        messages.push(responseMessage);
      }

      // Extract final content
      let finalResponse;
      if (provider.toLowerCase() === 'anthropic') {
        const textBlock = responseMessage.content.find((c) => c.type === 'text');
        finalResponse = textBlock ? textBlock.text : '';
      } else {
        finalResponse = responseMessage.content;
      }

      // Return the agent's response with tool execution details
      return {
        success: true,
        response: finalResponse,
        agentId: params.agentId,
        conversationId: randomUUID(),
        toolExecutions: toolExecutions,
        toolsUsed: toolExecutions.length,
        conversationHistory: [
          ...(params.conversationHistory || []),
          {
            role: 'user',
            content: params.message,
          },
          {
            role: 'assistant',
            content: finalResponse,
          },
        ],
      };
    } catch (error) {
      console.error('Error executing agent tool:', error);
      return {
        success: false,
        error: error.message || 'Failed to communicate with agent',
      };
    }
  }
}

export default new AgentTool();
