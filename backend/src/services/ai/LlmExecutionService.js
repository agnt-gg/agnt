import { createLlmClient } from './LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { executeTool } from '../orchestrator/tools.js';
import { manageContext } from '../../utils/contextManager.js';
import crypto from 'crypto';

/**
 * Core LLM execution service that handles tool calling and streaming
 * Used by both OrchestratorService and TaskOrchestrator to avoid duplication
 *
 * Features:
 * - Token usage tracking
 * - Performance metrics
 * - Response caching
 * - Automatic context management
 */
class LlmExecutionService {
  constructor() {
    // Performance metrics storage
    this.metrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      averageResponseTime: 0,
      callsByProvider: {},
      callsByModel: {},
    };

    // Simple in-memory cache (can be replaced with Redis in production)
    this.cache = new Map();
    this.cacheEnabled = true;
    this.cacheTTL = 3600000; // 1 hour in milliseconds
    this.maxCacheSize = 1000; // Maximum number of cached responses
  }
  _generateCacheKey(config) {
    const { provider, model, messages, toolSchemas } = config;
    const cacheData = {
      provider,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: toolSchemas.map((t) => t.function.name).sort(),
    };
    return crypto.createHash('sha256').update(JSON.stringify(cacheData)).digest('hex');
  }
  _getCachedResponse(cacheKey) {
    if (!this.cacheEnabled) return null;

    const cached = this.cache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(cacheKey);
      return null;
    }

    console.log(`[LlmExecutionService] Cache hit for key: ${cacheKey.substring(0, 16)}...`);
    return cached.response;
  }
  _setCachedResponse(cacheKey, response) {
    if (!this.cacheEnabled) return;

    // Implement simple LRU by removing oldest entries if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(cacheKey, {
      response: JSON.parse(JSON.stringify(response)), // Deep clone
      timestamp: Date.now(),
    });
  }
  _updateMetrics(provider, model, executionTime, tokenCount, toolCallCount) {
    this.metrics.totalCalls++;
    this.metrics.totalTokens += tokenCount || 0;
    this.metrics.totalToolCalls += toolCallCount || 0;

    // Update average response time
    const prevAvg = this.metrics.averageResponseTime;
    const totalCalls = this.metrics.totalCalls;
    this.metrics.averageResponseTime = (prevAvg * (totalCalls - 1) + executionTime) / totalCalls;

    // Track by provider
    if (!this.metrics.callsByProvider[provider]) {
      this.metrics.callsByProvider[provider] = { count: 0, tokens: 0 };
    }
    this.metrics.callsByProvider[provider].count++;
    this.metrics.callsByProvider[provider].tokens += tokenCount || 0;

    // Track by model
    if (!this.metrics.callsByModel[model]) {
      this.metrics.callsByModel[model] = { count: 0, tokens: 0 };
    }
    this.metrics.callsByModel[model].count++;
    this.metrics.callsByModel[model].tokens += tokenCount || 0;
  }
  getMetrics() {
    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      cacheHitRate:
        this.metrics.totalCalls > 0 ? (((this.metrics.totalCalls - this.cache.size) / this.metrics.totalCalls) * 100).toFixed(2) + '%' : '0%',
    };
  }
  clearCache() {
    this.cache.clear();
    console.log('[LlmExecutionService] Cache cleared');
  }
  resetMetrics() {
    this.metrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      averageResponseTime: 0,
      callsByProvider: {},
      callsByModel: {},
    };
    console.log('[LlmExecutionService] Metrics reset');
  }
  /**
   * Execute LLM with tools (non-streaming)
   * @param {Object} config - Execution configuration
   * @param {string} config.provider - LLM provider (e.g., 'Anthropic', 'openai')
   * @param {string} config.model - Model name
   * @param {string} config.userId - User ID for authentication
   * @param {Array} config.messages - Message history
   * @param {Array} config.toolSchemas - Available tool schemas
   * @param {string} config.systemPrompt - System prompt (optional, will be prepended)
   * @param {Object} config.context - Additional context for tool execution
   * @param {number} config.maxToolRounds - Maximum tool execution rounds (default: 10)
   * @returns {Promise<Object>} { responseMessage, toolExecutions, messages }
   */
  async executeWithTools(config) {
    const startTime = Date.now();
    const { provider, model, userId, messages: inputMessages, toolSchemas = [], systemPrompt = null, context = {}, maxToolRounds = 10 } = config;

    // Check cache first (only for non-tool calls to avoid stale data)
    const cacheKey = this._generateCacheKey(config);
    const cachedResponse = this._getCachedResponse(cacheKey);
    if (cachedResponse && toolSchemas.length === 0) {
      console.log('[LlmExecutionService] Returning cached response');
      return cachedResponse;
    }

    // Create LLM client and adapter
    const client = await createLlmClient(provider, userId);
    const adapter = await createLlmAdapter(provider, client, model);

    // Prepare messages
    let messages = JSON.parse(JSON.stringify(inputMessages));

    // Add or update system message if provided
    if (systemPrompt) {
      const systemMessageIndex = messages.findIndex((m) => m.role === 'system');
      if (systemMessageIndex !== -1) {
        messages[systemMessageIndex].content = `${systemPrompt}\n\n${messages[systemMessageIndex].content}`;
      } else {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    }

    // Deduplicate tools by name
    const uniqueToolMap = new Map();
    for (const tool of toolSchemas) {
      if (!uniqueToolMap.has(tool.function.name)) {
        uniqueToolMap.set(tool.function.name, tool);
      }
    }
    const finalToolSchemas = Array.from(uniqueToolMap.values());

    // Apply context management
    const contextResult = manageContext(messages, model, finalToolSchemas);
    messages = contextResult.messages;

    // Store client in context for tool execution
    const executionContext = {
      ...context,
      llmClient: client,
      userId,
      provider,
      model,
    };

    // Initial LLM call
    let { responseMessage, toolCalls } = await adapter.call(messages, finalToolSchemas);
    messages.push(responseMessage);

    // Tool execution loop
    let currentRound = 0;
    const allToolExecutions = [];

    while (toolCalls && toolCalls.length > 0 && currentRound < maxToolRounds) {
      currentRound++;

      const toolPromises = toolCalls.map(async (toolCall) => {
        const functionName = toolCall.function.name;
        let functionArgs;

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error(`Tool argument parsing failed for ${functionName}:`, parseError);
          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify({
              success: false,
              error: `Failed to parse tool arguments: ${parseError.message}`,
            }),
          };
        }

        console.log(`[LlmExecutionService] Executing tool: ${functionName}`, functionArgs);

        try {
          const functionResponse = await executeTool(functionName, functionArgs, null, executionContext);

          // Store execution details
          allToolExecutions.push({
            name: functionName,
            arguments: functionArgs,
            response: functionResponse,
          });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: functionResponse,
          };
        } catch (error) {
          console.error(`Tool execution error for ${functionName}:`, error);

          const errorResponse = JSON.stringify({
            success: false,
            error: `Tool execution failed: ${error.message}`,
          });

          allToolExecutions.push({
            name: functionName,
            arguments: functionArgs,
            response: errorResponse,
            error: error.message,
          });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: errorResponse,
          };
        }
      });

      const toolResponses = await Promise.all(toolPromises);
      const formattedToolResponses = adapter.formatToolResults(toolResponses);
      messages.push(...formattedToolResponses);

      // Apply context management before next LLM call
      const loopContextResult = manageContext(messages, model, finalToolSchemas);
      messages = loopContextResult.messages;

      // Get next response
      const nextResponse = await adapter.call(messages, finalToolSchemas);
      responseMessage = nextResponse.responseMessage;
      toolCalls = nextResponse.toolCalls;

      messages.push(responseMessage);
    }

    if (currentRound >= maxToolRounds) {
      console.warn(`[LlmExecutionService] Maximum tool rounds (${maxToolRounds}) reached`);
    }

    // Extract final content
    let finalContent;
    if (provider.toLowerCase() === 'anthropic') {
      const textBlock = responseMessage.content.find((c) => c.type === 'text');
      finalContent = textBlock ? textBlock.text : '';
    } else {
      finalContent = responseMessage.content;
    }

    // Calculate execution time and update metrics
    const executionTime = Date.now() - startTime;
    const estimatedTokens = contextResult.managedTokens || 0;
    this._updateMetrics(provider, model, executionTime, estimatedTokens, allToolExecutions.length);

    const result = {
      responseMessage,
      content: finalContent,
      toolExecutions: allToolExecutions,
      messages,
      metrics: {
        executionTime,
        estimatedTokens,
        toolCallCount: allToolExecutions.length,
      },
    };

    // Cache the result if no tools were used
    if (toolSchemas.length === 0) {
      this._setCachedResponse(cacheKey, result);
    }

    return result;
  }

  /**
   * Execute LLM with tools (streaming version)
   * @param {Object} config - Same as executeWithTools
   * @param {Function} onChunk - Callback for streaming chunks: (chunk) => void
   * @returns {Promise<Object>} { responseMessage, toolExecutions, messages }
   */
  async executeWithToolsStreaming(config, onChunk) {
    const { provider, model, userId, messages: inputMessages, toolSchemas = [], systemPrompt = null, context = {}, maxToolRounds = 10 } = config;

    // Create LLM client and adapter
    const client = await createLlmClient(provider, userId);
    const adapter = await createLlmAdapter(provider, client, model);

    // Prepare messages
    let messages = JSON.parse(JSON.stringify(inputMessages));

    // Add or update system message if provided
    if (systemPrompt) {
      const systemMessageIndex = messages.findIndex((m) => m.role === 'system');
      if (systemMessageIndex !== -1) {
        messages[systemMessageIndex].content = `${systemPrompt}\n\n${messages[systemMessageIndex].content}`;
      } else {
        messages.unshift({ role: 'system', content: systemPrompt });
      }
    }

    // Deduplicate tools by name
    const uniqueToolMap = new Map();
    for (const tool of toolSchemas) {
      if (!uniqueToolMap.has(tool.function.name)) {
        uniqueToolMap.set(tool.function.name, tool);
      }
    }
    const finalToolSchemas = Array.from(uniqueToolMap.values());

    // Apply context management
    const contextResult = manageContext(messages, model, finalToolSchemas);
    messages = contextResult.messages;

    // Store client in context for tool execution
    const executionContext = {
      ...context,
      llmClient: client,
      userId,
      provider,
      model,
    };

    // Initial LLM call with streaming
    let { responseMessage, toolCalls } = await adapter.callStream(messages, finalToolSchemas, onChunk);
    messages.push(responseMessage);

    // Tool execution loop
    let currentRound = 0;
    const allToolExecutions = [];

    while (toolCalls && toolCalls.length > 0 && currentRound < maxToolRounds) {
      currentRound++;

      const toolPromises = toolCalls.map(async (toolCall) => {
        const functionName = toolCall.function.name;
        let functionArgs;

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error(`Tool argument parsing failed for ${functionName}:`, parseError);
          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify({
              success: false,
              error: `Failed to parse tool arguments: ${parseError.message}`,
            }),
          };
        }

        console.log(`[LlmExecutionService] Executing tool: ${functionName}`, functionArgs);

        try {
          const functionResponse = await executeTool(functionName, functionArgs, null, executionContext);

          // Store execution details
          allToolExecutions.push({
            name: functionName,
            arguments: functionArgs,
            response: functionResponse,
          });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: functionResponse,
          };
        } catch (error) {
          console.error(`Tool execution error for ${functionName}:`, error);

          const errorResponse = JSON.stringify({
            success: false,
            error: `Tool execution failed: ${error.message}`,
          });

          allToolExecutions.push({
            name: functionName,
            arguments: functionArgs,
            response: errorResponse,
            error: error.message,
          });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: errorResponse,
          };
        }
      });

      const toolResponses = await Promise.all(toolPromises);
      const formattedToolResponses = adapter.formatToolResults(toolResponses);
      messages.push(...formattedToolResponses);

      // Apply context management before next LLM call
      const loopContextResult = manageContext(messages, model, finalToolSchemas);
      messages = loopContextResult.messages;

      // Get next response with streaming
      const nextResponse = await adapter.callStream(messages, finalToolSchemas, onChunk);
      responseMessage = nextResponse.responseMessage;
      toolCalls = nextResponse.toolCalls;

      messages.push(responseMessage);
    }

    if (currentRound >= maxToolRounds) {
      console.warn(`[LlmExecutionService] Maximum tool rounds (${maxToolRounds}) reached`);
    }

    // Extract final content
    let finalContent;
    if (provider.toLowerCase() === 'anthropic') {
      const textBlock = responseMessage.content.find((c) => c.type === 'text');
      finalContent = textBlock ? textBlock.text : '';
    } else {
      finalContent = responseMessage.content;
    }

    return {
      responseMessage,
      content: finalContent,
      toolExecutions: allToolExecutions,
      messages,
    };
  }

  /**
   * Build a system prompt for agent task execution
   * @param {Object} agent - Agent configuration
   * @param {Array} toolSchemas - Available tool schemas
   * @returns {string} System prompt
   */
  buildAgentSystemPrompt(agent, toolSchemas) {
    const currentDate = new Date().toString();

    return `Current date and time: ${currentDate}

You are an AI assistant named '${agent.name}'.
${agent.description}

You are executing a task as part of a larger goal. Use your assigned tools to complete the task effectively.

AVAILABLE TOOLS:
${toolSchemas.map((tool) => `- ${tool.function.name}: ${tool.function.description}`).join('\n')}

IMPORTANT:
- Focus on completing the specific task assigned to you
- Use your tools strategically to gather information and produce results
- Provide clear, structured output that can be used by subsequent tasks
- If you need to save data for later use, use the file_operations tool`;
  }
}

export default new LlmExecutionService();
