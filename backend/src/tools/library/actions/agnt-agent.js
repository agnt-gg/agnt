import BaseAction from '../BaseAction.js';
import AgentService from '../../../services/AgentService.js';
import { createLlmClient } from '../../../services/ai/LlmService.js';
import { createLlmAdapter } from '../../../services/orchestrator/llmAdapters.js';
import { executeTool } from '../../../services/orchestrator/tools.js';
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

      // Use AgentService to get the full agent context (system prompt, skills, tools)
      // This is the same path used by the orchestrator agent chat
      const { agentContext, provider: agentProvider, model: agentModel, error, status } = await AgentService._getAgentContext(params.agentId, userId);
      if (error) {
        return { success: false, error };
      }

      // Resolve provider/model: agent config → user defaults
      let provider = agentProvider;
      let model = agentModel;

      if (!provider || !model) {
        const UserModel = (await import('../../../models/UserModel.js')).default;
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

      const agentToolSchemas = agentContext.availableTools || [];

      // Prepare messages with system prompt and conversation history
      const messages = [
        { role: 'system', content: agentContext.systemPrompt },
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
      if (Array.isArray(responseMessage.content)) {
        // Anthropic-style responses (anthropic, claude-code) return content blocks
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
