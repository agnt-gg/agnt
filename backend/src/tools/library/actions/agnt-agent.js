import BaseAction from '../BaseAction.js';
import AgentService from '../../../services/AgentService.js';
import { createLlmClient } from '../../../services/ai/LlmService.js';
import { createLlmAdapter } from '../../../services/orchestrator/llmAdapters.js';
import { executeTool } from '../../../services/orchestrator/tools.js';
import { buildAgentRuntime } from '../../../services/orchestrator/agentRuntime.js';
import { randomUUID } from 'crypto';

/**
 * Normalize a conversationHistory parameter into a message array.
 *
 * ParameterResolver.resolveTemplate() runs every string param through
 * String.replace(), and JSON.stringify()s any object/array it resolves. So a
 * wired `{{Worker.conversationHistory}}` arrives here as JSON TEXT, not an
 * array. Spreading that string into `messages` would expand it one character
 * per element and poison the request. Anything that isn't a well-formed array
 * of {role, content} turns is discarded rather than silently corrupting the
 * conversation.
 */
export function normalizeConversationHistory(raw) {
  if (!raw) return [];

  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      console.warn('[agnt-agent] conversationHistory was a non-JSON string; ignoring it.');
      return [];
    }
  }

  if (!Array.isArray(value)) {
    console.warn(`[agnt-agent] conversationHistory resolved to ${typeof value}, expected array; ignoring it.`);
    return [];
  }

  return value.filter(
    (turn) => turn && typeof turn === 'object' && !Array.isArray(turn) && typeof turn.role === 'string' && turn.content !== undefined
  );
}

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
      conversationHistory: {
        type: 'array',
        inputType: 'text',
        description:
          "Optional prior turns to prepend, as [{role, content}]. Wire this node's own conversationHistory output back in (e.g. {{Worker.conversationHistory}}) to make the agent RESIDENT — it keeps context across loop iterations and stays cache-warm. Leave empty for an EPHEMERAL agent that starts from a clean context every call.",
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

      // Ownership gate + the agent's own provider/model. The runtime itself
      // (prompt, tools, skills, memory) is assembled by buildAgentRuntime
      // below — see the note there.
      const { provider: agentProvider, model: agentModel, error } = await AgentService._getAgentContext(params.agentId, userId);
      if (error) {
        return { success: false, error };
      }

      // Resolve provider/model: agent config → user settings. Never fall back
      // to a hardcoded model name — that silently breaks Codex users (whose
      // OAuth client can't serve a non-Responses-API model) and any non-default
      // provider setup. If neither the agent record nor user settings have a
      // model, surface the misconfig rather than guess.
      let provider = agentProvider;
      let model = agentModel;

      if (!provider || !model) {
        const UserModel = (await import('../../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);
        provider = provider || userSettings?.selectedProvider;
        model = model || userSettings?.selectedModel;
        if (!provider || !model) {
          return {
            success: false,
            error: 'No provider/model configured for this agent and no selected provider/model in user settings. Configure defaults in settings or set them on the agent record.',
          };
        }
        console.log(`Using global provider/model for agent: ${provider}/${model}`);
      }

      // FULL RUNTIME, NOT A PERSONA STRING.
      //
      // This used to be `agentContext.availableTools` plus a bare
      // `agentContext.systemPrompt`, which gave the agent its persona and
      // nothing else — no skills catalog, no memory, no platform guidance,
      // and (before the userId fix in AgentService) no custom tools. The
      // agent chat surface assembles all of that; a workflow-run agent is
      // the SAME agent and must get the same thing. See agentRuntime.js.
      const { systemPrompt, toolSchemas: agentToolSchemas } = await buildAgentRuntime({
        agentId: params.agentId,
        userId,
        latestUserMessage: params.message,
        provider,
      });

      // Prepare messages with system prompt and conversation history
      const priorHistory = normalizeConversationHistory(params.conversationHistory);

      const messages = [
        { role: 'system', content: systemPrompt },
        ...priorHistory,
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
          ...priorHistory,
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
