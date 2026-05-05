/**
 * Autonomous Message Service
 * Triggers AI to generate messages without user interaction
 * Used when async tools complete or have progress updates
 */

import { randomUUID } from 'crypto';
import conversationManager from './ConversationManager.js';
import { createLlmClient } from './ai/LlmService.js';
import { createLlmAdapter } from './orchestrator/llmAdapters.js';
import { executeTool } from './orchestrator/tools.js';
import { inspectAsyncResult } from './asyncResultInspector.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import log from '../utils/logger.js';
import ConversationLogModel from '../models/ConversationLogModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';

const MAX_AUTONOMOUS_TOOL_ROUNDS = 3;

function parseToolArgs(toolCall) {
  const rawArgs = toolCall.function?.arguments ?? toolCall.input ?? {};
  if (typeof rawArgs !== 'string') return rawArgs || {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function stripAsyncControlParams(args) {
  const clean = { ...(args || {}) };
  delete clean._executeAsync;
  delete clean._estimatedMinutes;
  delete clean._interval;
  delete clean._stopAfter;
  delete clean._duration;
  delete clean._delayFirst;
  return clean;
}

class AutonomousMessageService {
  constructor() {
    // Queue of pending autonomous messages to avoid overwhelming the user
    this.messageQueue = new Map(); // conversationId -> array of pending triggers
    this.processing = new Set(); // conversationIds currently being processed
    this.throttleMs = 2000; // Min 2 seconds between autonomous messages
  }

  /**
   * Trigger autonomous AI message for async tool progress
   * @param {string} conversationId - Conversation ID
   * @param {object} eventData - Event data (tool progress, completion, etc.)
   */
  async triggerToolProgress(conversationId, eventData) {
    const { toolCallId, functionName, progress, executionId } = eventData;

    log(`[AutonomousMessage] Triggering autonomous message for tool progress: ${functionName}`);

    const systemMessage = {
      role: 'user',
      content: `[System: Async tool progress update]

🔄 ASYNC TOOL PROGRESS UPDATE

Tool: ${functionName}
Execution ID: ${executionId}
Tool Call ID: ${toolCallId}

Progress Data:
${JSON.stringify(progress, null, 2)}

INSTRUCTIONS:
You should now inform the user about this progress update in a natural, concise way.
Format the progress data in a user-friendly manner.
Keep your response brief (1-2 sentences) since this is a progress update.`,
    };

    await this.triggerAutonomousMessage(conversationId, systemMessage);
  }

  /**
   * Trigger autonomous AI message for async tool completion
   * @param {string} conversationId - Conversation ID
   * @param {object} eventData - Event data (tool result, etc.)
   */
  async triggerToolCompletion(conversationId, eventData) {
    const { toolCallId, functionName, result, executionId, duration } = eventData;

    log(`[AutonomousMessage] Triggering autonomous message for tool completion: ${functionName}`);

    // Get conversation context to find user ID
    const context = conversationManager.get(conversationId);

    // Outer status reaching this handler is always "completed" (the queue
    // ran the tool to the end). The INNER payload may still report failure —
    // ENOENT, EPERM, validation errors raised by the tool, periodic
    // iterations that errored, etc. Inspect both layers so the directive
    // matches the actual outcome instead of always celebrating success.
    const inspection = inspectAsyncResult(result);
    const headline = inspection.ok
      ? '[System: Async tool completed]'
      : '[System: Async tool finished with errors]';
    const banner = inspection.ok
      ? '✅ ASYNC TOOL COMPLETED'
      : '⚠️ ASYNC TOOL FINISHED WITH ERROR';
    const instructions = inspection.ok
      ? `The async tool completed successfully. Inform the user about the final result.
Format the result in a user-friendly, natural way.
Be conversational and confirm the completion.`
      : `The async tool ran but the operation FAILED${inspection.errorSummary ? ` (${inspection.errorSummary})` : ''}.
Inform the user about the failure clearly and honestly using the error details in the result above.
Do NOT claim success. Suggest a sensible next step or fix if appropriate.`;

    const systemMessage = {
      role: 'user',
      content: `${headline}

${banner}

Tool: ${functionName}
Execution ID: ${executionId}
Tool Call ID: ${toolCallId}
Duration: ${Math.round(duration / 1000)} seconds

Result:
${JSON.stringify(result, null, 2)}

INSTRUCTIONS:
${instructions}`,
    };

    await this.triggerAutonomousMessage(conversationId, systemMessage);
  }

  /**
   * Trigger autonomous AI message for async tool failure
   * @param {string} conversationId - Conversation ID
   * @param {object} eventData - Event data (error, etc.)
   */
  async triggerToolFailure(conversationId, eventData) {
    const { toolCallId, functionName, error, executionId } = eventData;

    log(`[AutonomousMessage] Triggering autonomous message for tool failure: ${functionName}`);

    // Get conversation context to find user ID
    const context = conversationManager.get(conversationId);

    const systemMessage = {
      role: 'user',
      content: `[System: Async tool failed]

❌ ASYNC TOOL FAILED

Tool: ${functionName}
Execution ID: ${executionId}
Tool Call ID: ${toolCallId}

Error:
${error}

INSTRUCTIONS:
The async tool has failed. Inform the user about the error in a helpful way.
Be empathetic and suggest potential solutions or next steps if appropriate.`,
    };

    await this.triggerAutonomousMessage(conversationId, systemMessage);
  }

  /**
   * Core method to trigger autonomous AI message
   * @param {string} conversationId - Conversation ID
   * @param {object} systemMessage - System message to inject
   */
  async triggerAutonomousMessage(conversationId, systemMessage, retryCount = 0) {
    // Get conversation context
    let context = conversationManager.get(conversationId);

    // Retry if conversation not found yet (might still be storing)
    // New conversations take 3-10 seconds to be stored after tool execution
    if (!context && retryCount < 10) {
      log(`[AutonomousMessage] Conversation ${conversationId} not found yet, waiting... (attempt ${retryCount + 1}/10)`);
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 seconds between retries
      return this.triggerAutonomousMessage(conversationId, systemMessage, retryCount + 1);
    }

    if (!context) {
      // Conversation may have been closed or cleaned up - this is normal for long-running async tools
      log(`[AutonomousMessage] Skipping autonomous message - conversation ${conversationId} no longer active after 15 seconds`);
      return;
    }

    // Check if already processing for this conversation (throttle)
    if (this.processing.has(conversationId)) {
      log(`[AutonomousMessage] Queueing message for ${conversationId} (already processing)`);
      this.queueMessage(conversationId, systemMessage);
      return;
    }

    try {
      this.processing.add(conversationId);

      // Add system message to conversation history
      const updatedMessages = [...context.messages, systemMessage];

      // Generate truly unique assistant message ID (avoid duplicates from rapid callbacks)
      const assistantMessageId = `msg-auto-${Date.now()}-${randomUUID().substring(0, 8)}`;

      // Broadcast autonomous message start
      broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_MESSAGE_START, {
        conversationId,
        assistantMessageId,
        timestamp: Date.now(),
      });

      log(`[AutonomousMessage] Generating autonomous response for conversation ${conversationId}`);

      // Create LLM client and adapter
      const client = await createLlmClient(context.normalizedProvider, context.userId, {
        conversationId,
        authToken: context.authToken,
      });
      const adapter = await createLlmAdapter(context.normalizedProvider, client, context.model);

      const contentDeltaCb = (chunk) => {
        if (chunk.type === 'content') {
          broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_CONTENT_DELTA, {
            conversationId,
            assistantMessageId,
            delta: chunk.delta,
            accumulated: chunk.accumulated,
            timestamp: Date.now(),
          });
        }
      };

      const tools = Array.isArray(context.finalToolSchemas) ? context.finalToolSchemas : [];
      let loopMessages = updatedMessages;
      const newMessages = [];
      let responseMessage = { role: 'assistant', content: '' };
      let needsFinalResponse = false;

      for (let round = 0; round < MAX_AUTONOMOUS_TOOL_ROUNDS; round++) {
        const { responseMessage: roundResponse, toolCalls: rawToolCalls } = await adapter.callStream(
          loopMessages,
          tools,
          contentDeltaCb,
          context
        );

        responseMessage = roundResponse;
        newMessages.push(responseMessage);
        loopMessages = [...loopMessages, responseMessage];

        const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
        if (toolCalls.length === 0) {
          needsFinalResponse = false;
          break;
        }
        needsFinalResponse = true;

        log(`[AutonomousMessage] Tool follow-up round ${round + 1}: executing ${toolCalls.length} tool(s)`);

        const toolResults = [];
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function?.name || toolCall.name;
          const functionArgs = parseToolArgs(toolCall);
          const cleanArgs = stripAsyncControlParams(functionArgs);

          broadcastToUser(context.userId, RealtimeEvents.CHAT_TOOL_START, {
            conversationId,
            chatType: context.chatType,
            assistantMessageId,
            toolCall: { id: toolCall.id, name: functionName, args: cleanArgs },
            timestamp: Date.now(),
          });

          let resultRaw;
          let resultParsed;
          let toolError = null;
          try {
            resultRaw = await executeTool(functionName, cleanArgs, context.authToken, context);
            try {
              resultParsed = typeof resultRaw === 'string' ? JSON.parse(resultRaw) : resultRaw;
            } catch {
              resultParsed = resultRaw;
            }
          } catch (toolErr) {
            toolError = toolErr.message || String(toolErr);
            resultParsed = { success: false, error: toolError };
            resultRaw = JSON.stringify(resultParsed);
          }

          broadcastToUser(context.userId, RealtimeEvents.CHAT_TOOL_END, {
            conversationId,
            chatType: context.chatType,
            assistantMessageId,
            toolCall: { id: toolCall.id, name: functionName, result: resultParsed, error: toolError },
            timestamp: Date.now(),
          });

          toolResults.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: typeof resultRaw === 'string' ? resultRaw : JSON.stringify(resultRaw),
          });
        }

        const formattedToolResults = adapter.formatToolResults(toolResults);
        newMessages.push(...formattedToolResults);
        loopMessages = [...loopMessages, ...formattedToolResults];
      }

      if (needsFinalResponse) {
        log('[AutonomousMessage] Tool follow-up reached cap; forcing final text response');
        const { responseMessage: finalResponse } = await adapter.callStream(
          loopMessages,
          [],
          contentDeltaCb,
          context
        );

        responseMessage = finalResponse;
        newMessages.push(responseMessage);
      }

      // Extract content to check if message is empty
      let finalContent = '';
      if (context.normalizedProvider === 'anthropic') {
        const textBlock = responseMessage.content?.find((c) => c.type === 'text');
        finalContent = textBlock ? textBlock.text : '';
      } else {
        finalContent = responseMessage.content || '';
      }

      // Ensure finalContent is a string
      if (typeof finalContent !== 'string') {
        finalContent = JSON.stringify(finalContent);
      }

      const ranTools = newMessages.some((m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((c) => c?.type === 'tool_result')));
      if ((!finalContent || finalContent.trim() === '') && !ranTools) {
        log(`[AutonomousMessage] Skipping empty autonomous message for conversation ${conversationId}`);
        // Still broadcast end so frontend clears "thinking" indicator
        broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_MESSAGE_END, {
          conversationId,
          assistantMessageId,
          content: '',
          isEmpty: true, // Flag for frontend to not display
          timestamp: Date.now(),
        });
        return; // Don't save empty message
      }

      conversationManager.appendMessages(conversationId, newMessages);

      // Broadcast autonomous message end
      broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_MESSAGE_END, {
        conversationId,
        assistantMessageId,
        content: responseMessage.content,
        timestamp: Date.now(),
      });

      log(`[AutonomousMessage] Completed autonomous response for conversation ${conversationId}`);

      // Save autonomous message to database (conversation log)
      try {
        const updatedContext = conversationManager.get(conversationId);
        if (updatedContext && context.userId) {
          // Update conversation log with autonomous messages
          const logData = {
            conversationId,
            userId: context.userId,
            initial_prompt: null, // Autonomous messages don't have user prompts
            full_history: JSON.stringify(updatedContext.messages),
            final_response: finalContent,
            tool_calls: null, // Autonomous messages don't make tool calls (for now)
            errors: null,
          };

          await ConversationLogModel.update(logData).catch((logError) => {
            console.error('[AutonomousMessage] Failed to update conversation log:', logError);
          });

          log(`[AutonomousMessage] Saved autonomous message to conversation log`);

          // Link autonomous message to agent execution record
          if (context.agentExecutionId) {
            try {
              // Update execution with autonomous message activity
              // We don't update the final response, but we could track autonomous messages separately
              log(`[AutonomousMessage] Linked autonomous message to execution ${context.agentExecutionId}`);
            } catch (execError) {
              console.error('[AutonomousMessage] Failed to link to execution:', execError);
            }
          }
        }
      } catch (dbError) {
        console.error('[AutonomousMessage] Error saving to database:', dbError);
        // Don't fail the autonomous message if DB save fails
      }

      // Wait throttle period before processing next message
      await new Promise((resolve) => setTimeout(resolve, this.throttleMs));

      this.processing.delete(conversationId);

      // Process next queued message if any
      this.processNextQueuedMessage(conversationId);
    } catch (error) {
      console.error(`[AutonomousMessage] Error generating autonomous message:`, error);
      this.processing.delete(conversationId);

      // Broadcast error to user
      broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_MESSAGE_END, {
        conversationId,
        error: error.message || String(error),
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Queue a message for later processing
   */
  queueMessage(conversationId, systemMessage) {
    if (!this.messageQueue.has(conversationId)) {
      this.messageQueue.set(conversationId, []);
    }
    this.messageQueue.get(conversationId).push(systemMessage);
    log(`[AutonomousMessage] Queued message for ${conversationId} (queue size: ${this.messageQueue.get(conversationId).length})`);
  }

  /**
   * Process next queued message for conversation
   */
  async processNextQueuedMessage(conversationId) {
    const queue = this.messageQueue.get(conversationId);
    if (!queue || queue.length === 0) {
      return;
    }

    const nextMessage = queue.shift();
    log(`[AutonomousMessage] Processing queued message for ${conversationId}`);

    await this.triggerAutonomousMessage(conversationId, nextMessage);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      processing: this.processing.size,
      queued: Array.from(this.messageQueue.values()).reduce((sum, q) => sum + q.length, 0),
      queuedByConversation: Object.fromEntries(
        Array.from(this.messageQueue.entries()).map(([id, queue]) => [id, queue.length])
      ),
    };
  }
}

// Singleton instance
const autonomousMessageService = new AutonomousMessageService();
export default autonomousMessageService;
