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
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import log from '../utils/logger.js';
import ConversationLogModel from '../models/ConversationLogModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';

// Cap autonomous tool-loop iterations the same way the orchestrator caps
// its main loop. Prevents a runaway autonomous turn from looping forever
// on bad tool calls.
const MAX_AUTONOMOUS_ROUNDS = 10;

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

    // Broadcast tool result update to mark as completed
    if (context && context.userId && toolCallId) {
      log(`[AutonomousMessage] Broadcasting tool completion status update for ${toolCallId}`);
      broadcastToUser(context.userId, RealtimeEvents.ASYNC_TOOL_COMPLETED, {
        conversationId,
        toolCallId,
        executionId,
        assistantMessageId: context.assistantMessageId,
        result,
        duration,
        functionName,
      });
    }

    const systemMessage = {
      role: 'user',
      content: `[System: Async tool completed]

✅ ASYNC TOOL COMPLETED

Tool: ${functionName}
Execution ID: ${executionId}
Tool Call ID: ${toolCallId}
Duration: ${Math.round(duration / 1000)} seconds

Result:
${JSON.stringify(result, null, 2)}

INSTRUCTIONS:
The async tool has completed successfully. Inform the user about the final result.
Format the result in a user-friendly, natural way.
Be conversational and enthusiastic about the completion.`,
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

    // Broadcast tool result update to mark as failed
    if (context && context.userId && toolCallId) {
      log(`[AutonomousMessage] Broadcasting tool failure status update for ${toolCallId}`);
      broadcastToUser(context.userId, RealtimeEvents.ASYNC_TOOL_FAILED, {
        conversationId,
        toolCallId,
        executionId,
        assistantMessageId: context.assistantMessageId,
        error,
        functionName,
      });
    }

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

      // Pull the tool schemas the original turn had access to. If they
      // weren't stashed (older conversations stored before this fix), fall
      // back to no tools — the LLM still gets a chance to respond, just
      // without tool use.
      const tools = Array.isArray(context.finalToolSchemas) ? context.finalToolSchemas : [];

      // Multi-round tool loop — mirrors universalChatHandler so an async
      // tool finishing doesn't cut the agent off mid-task. Each round:
      //   1. LLM call with full tool list
      //   2. If it returns tool calls → execute each, append results, loop
      //   3. If no tool calls → final response, exit
      let loopMessages = [...updatedMessages];
      const newMessages = []; // Append to conversationManager at the end (excludes the bookkeeping systemMessage)
      let finalResponseMessage = null;

      for (let round = 0; round < MAX_AUTONOMOUS_ROUNDS; round++) {
        // Destructure toolCalls from the adapter's normalized return value —
        // NOT from responseMessage.tool_calls, since Anthropic returns tool
        // use blocks inside content[] rather than as a sibling field. The
        // adapter normalizes both shapes into `toolCalls` so we get the same
        // structure for OpenAI, Anthropic, and Gemini.
        const { responseMessage, toolCalls: rawToolCalls } = await adapter.callStream(
          loopMessages,
          tools,
          (chunk) => {
            if (chunk.type === 'content') {
              broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_CONTENT_DELTA, {
                conversationId,
                assistantMessageId,
                delta: chunk.delta,
                accumulated: chunk.accumulated,
                timestamp: Date.now(),
              });
            }
          },
          context
        );

        finalResponseMessage = responseMessage;
        loopMessages.push(responseMessage);
        newMessages.push(responseMessage);

        const toolCalls = Array.isArray(rawToolCalls) ? rawToolCalls : [];
        if (toolCalls.length === 0) {
          // No more tools — the agent is done.
          break;
        }

        log(`[AutonomousMessage] Round ${round + 1}: ${toolCalls.length} tool call(s) requested`);

        // Execute each tool call, broadcasting status so the UI can render them
        // on the same assistant message bubble as the streamed content.
        const toolResults = [];
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function?.name || toolCall.name;
          const rawArgs = toolCall.function?.arguments ?? toolCall.input ?? {};
          let functionArgs;
          try {
            functionArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          } catch {
            functionArgs = {};
          }

          broadcastToUser(context.userId, RealtimeEvents.CHAT_TOOL_START, {
            conversationId,
            chatType: context.chatType,
            assistantMessageId,
            toolCall: { id: toolCall.id, name: functionName, args: functionArgs },
            timestamp: Date.now(),
          });

          let resultParsed = null;
          let toolError = null;
          let resultRaw;
          try {
            resultRaw = await executeTool(functionName, functionArgs, context.authToken, context);
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

        const formattedToolResponses = adapter.formatToolResults(toolResults);
        loopMessages.push(...formattedToolResponses);
        newMessages.push(...formattedToolResponses);
      }

      const responseMessage = finalResponseMessage || { role: 'assistant', content: '' };

      // Extract content to check if final message is empty
      let finalContent = '';
      if (context.normalizedProvider === 'anthropic') {
        const textBlock = responseMessage.content?.find?.((c) => c.type === 'text');
        finalContent = textBlock ? textBlock.text : '';
      } else {
        finalContent = responseMessage.content || '';
      }

      // Ensure finalContent is a string
      if (typeof finalContent !== 'string') {
        finalContent = JSON.stringify(finalContent);
      }

      // Skip if the entire loop produced no visible content AND no tool calls
      // (a truly empty turn). If tools ran, we still want to persist them.
      const ranAnyTools = newMessages.some((m) => m.role === 'tool');
      if ((!finalContent || finalContent.trim() === '') && !ranAnyTools) {
        log(`[AutonomousMessage] Skipping empty autonomous message for conversation ${conversationId}`);
        broadcastToUser(context.userId, RealtimeEvents.AUTONOMOUS_MESSAGE_END, {
          conversationId,
          assistantMessageId,
          content: '',
          isEmpty: true,
          timestamp: Date.now(),
        });
        return;
      }

      // Append all assistant responses + tool results from this autonomous
      // turn — but NOT the bookkeeping systemMessage (that's a "react to
      // this tool result" injection, not real conversation history).
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
