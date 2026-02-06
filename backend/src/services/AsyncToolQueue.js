/**
 * Async Tool Execution Queue
 * Manages long-running tool executions that should not block the conversation
 */

import { randomUUID } from 'crypto';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import log from '../utils/logger.js';

class AsyncToolQueue {
  constructor() {
    // Map of active async tool executions
    // Key: toolExecutionId, Value: { toolCallId, conversationId, userId, status, etc. }
    this.executions = new Map();

    // Max concurrent async tools per conversation
    this.maxConcurrentPerConversation = 10;

    // Cleanup completed executions after 1 hour
    this.cleanupIntervalMs = 60 * 60 * 1000; // 1 hour
    this.startCleanupTimer();
  }

  /**
   * Enqueue an async tool for background execution
   * @param {string} toolCallId - Original tool call ID from LLM
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID for broadcasting updates
   * @param {string} functionName - Tool function name
   * @param {object} functionArgs - Tool arguments
   * @param {object} callbacks - { onProgress, onComplete, onError }
   * @param {function} executeFunction - Function to execute the tool
   * @returns {string} - Execution ID
   */
  enqueue(toolCallId, conversationId, userId, functionName, functionArgs, callbacks, executeFunction) {
    const executionId = randomUUID();

    const execution = {
      executionId,
      toolCallId,
      conversationId,
      userId,
      functionName,
      functionArgs,
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progressUpdates: [],
      callbacks,
    };

    this.executions.set(executionId, execution);

    log(`[AsyncToolQueue] Queued async tool: ${functionName} (execution: ${executionId}, conversation: ${conversationId})`);

    // Broadcast to user
    broadcastToUser(userId, RealtimeEvents.ASYNC_TOOL_QUEUED, {
      executionId,
      toolCallId,
      conversationId,
      functionName,
      functionArgs,
      timestamp: Date.now(),
    });

    // Start execution immediately (no actual queue for now, but we could add one)
    this.execute(executionId, executeFunction);

    return executionId;
  }

  /**
   * Execute an async tool in the background
   */
  async execute(executionId, executeFunction) {
    const execution = this.executions.get(executionId);
    if (!execution) {
      console.error(`[AsyncToolQueue] Execution ${executionId} not found`);
      return;
    }

    execution.status = 'running';
    execution.startedAt = Date.now();

    log(`[AsyncToolQueue] Started async tool: ${execution.functionName} (execution: ${executionId})`);

    // Broadcast started event
    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_STARTED, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      functionName: execution.functionName,
      timestamp: Date.now(),
    });

    try {
      // Create progress callback wrapper
      const progressCallback = (progressData) => {
        this.handleProgress(executionId, progressData);
      };

      // Execute the tool function
      const result = await executeFunction(execution.functionArgs, progressCallback);

      // Mark as completed
      execution.status = 'completed';
      execution.completedAt = Date.now();
      execution.result = result;

      log(`[AsyncToolQueue] Completed async tool: ${execution.functionName} (execution: ${executionId}, duration: ${execution.completedAt - execution.startedAt}ms)`);

      // Broadcast completed event
      broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_COMPLETED, {
        executionId,
        toolCallId: execution.toolCallId,
        conversationId: execution.conversationId,
        functionName: execution.functionName,
        result,
        duration: execution.completedAt - execution.startedAt,
        timestamp: Date.now(),
      });

      // Trigger completion callback
      if (execution.callbacks?.onComplete) {
        try {
          await execution.callbacks.onComplete(result, execution);
        } catch (callbackError) {
          console.error(`[AsyncToolQueue] Completion callback error:`, callbackError);
        }
      }
    } catch (error) {
      // Mark as failed
      execution.status = 'failed';
      execution.completedAt = Date.now();
      execution.error = error.message || String(error);

      log(`[AsyncToolQueue] Failed async tool: ${execution.functionName} (execution: ${executionId}): ${execution.error}`);

      // Broadcast failed event
      broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_FAILED, {
        executionId,
        toolCallId: execution.toolCallId,
        conversationId: execution.conversationId,
        functionName: execution.functionName,
        error: execution.error,
        timestamp: Date.now(),
      });

      // Trigger error callback
      if (execution.callbacks?.onError) {
        try {
          await execution.callbacks.onError(error, execution);
        } catch (callbackError) {
          console.error(`[AsyncToolQueue] Error callback error:`, callbackError);
        }
      }
    }
  }

  /**
   * Handle progress update from async tool
   */
  handleProgress(executionId, progressData) {
    const execution = this.executions.get(executionId);
    if (!execution) {
      console.error(`[AsyncToolQueue] Execution ${executionId} not found for progress update`);
      return;
    }

    // Store progress update
    execution.progressUpdates.push({
      timestamp: Date.now(),
      data: progressData,
    });

    log(`[AsyncToolQueue] Progress for ${execution.functionName} (execution: ${executionId}):`, progressData);

    // Broadcast progress event
    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_PROGRESS, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      functionName: execution.functionName,
      progress: progressData,
      timestamp: Date.now(),
    });

    // Trigger progress callback
    if (execution.callbacks?.onProgress) {
      try {
        execution.callbacks.onProgress(progressData, execution);
      } catch (callbackError) {
        console.error(`[AsyncToolQueue] Progress callback error:`, callbackError);
      }
    }
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId) {
    return this.executions.get(executionId);
  }

  /**
   * Get all executions for a conversation
   */
  getExecutionsByConversation(conversationId) {
    return Array.from(this.executions.values()).filter((e) => e.conversationId === conversationId);
  }

  /**
   * Get running executions for a conversation
   */
  getRunningExecutions(conversationId) {
    return this.getExecutionsByConversation(conversationId).filter((e) => e.status === 'running');
  }

  /**
   * Cancel an async tool execution
   * Note: This marks it as cancelled but doesn't forcefully stop the function
   * The tool implementation needs to check for cancellation
   */
  cancel(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return { success: false, error: 'Execution not found' };
    }

    if (execution.status === 'completed' || execution.status === 'failed') {
      return { success: false, error: 'Execution already finished' };
    }

    execution.status = 'cancelled';
    execution.completedAt = Date.now();

    log(`[AsyncToolQueue] Cancelled async tool: ${execution.functionName} (execution: ${executionId})`);

    // Broadcast cancellation
    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_FAILED, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      functionName: execution.functionName,
      error: 'Cancelled by user',
      timestamp: Date.now(),
    });

    return { success: true };
  }

  /**
   * Cleanup completed executions periodically
   */
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      const expiryThreshold = 60 * 60 * 1000; // 1 hour

      for (const [executionId, execution] of this.executions.entries()) {
        if (execution.completedAt && now - execution.completedAt > expiryThreshold) {
          log(`[AsyncToolQueue] Cleaning up old execution: ${executionId}`);
          this.executions.delete(executionId);
        }
      }
    }, this.cleanupIntervalMs);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const executions = Array.from(this.executions.values());
    return {
      total: executions.length,
      queued: executions.filter((e) => e.status === 'queued').length,
      running: executions.filter((e) => e.status === 'running').length,
      completed: executions.filter((e) => e.status === 'completed').length,
      failed: executions.filter((e) => e.status === 'failed').length,
      cancelled: executions.filter((e) => e.status === 'cancelled').length,
    };
  }
}

// Singleton instance
const asyncToolQueue = new AsyncToolQueue();
export default asyncToolQueue;
