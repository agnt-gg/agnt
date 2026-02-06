/**
 * Async Tool Execution Queue
 * Manages long-running tool executions that should not block the conversation.
 * Supports single-run and periodic/recurring execution with real cancellation via AbortController.
 */

import { randomUUID } from 'crypto';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import log from '../utils/logger.js';

/**
 * Strip async/periodic control params from tool args before passing to the actual tool.
 * These params are for the queue only, NOT for the tool itself.
 */
function stripControlParams(args) {
  const clean = { ...args };
  delete clean._executeAsync;
  delete clean._estimatedMinutes;
  delete clean._interval;
  delete clean._stopAfter;
  delete clean._duration;
  return clean;
}

class AsyncToolQueue {
  constructor() {
    this.executions = new Map();
    this.maxConcurrentPerConversation = 10;
    this.cleanupIntervalMs = 60 * 60 * 1000;
    this.startCleanupTimer();
  }

  /**
   * Enqueue an async tool for background execution
   */
  enqueue(toolCallId, conversationId, userId, functionName, functionArgs, assistantMessageId, callbacks, executeFunction) {
    const executionId = randomUUID();
    const abortController = new AbortController();

    const execution = {
      executionId,
      toolCallId,
      conversationId,
      userId,
      functionName,
      functionArgs,
      assistantMessageId,
      status: 'queued',
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progressUpdates: [],
      callbacks,
      abortController,
      intervalId: null,
    };

    this.executions.set(executionId, execution);

    log(`[AsyncToolQueue] Queued: ${functionName} (${executionId})`);

    broadcastToUser(userId, RealtimeEvents.ASYNC_TOOL_QUEUED, {
      executionId,
      toolCallId,
      conversationId,
      functionName,
      functionArgs,
      timestamp: Date.now(),
    });

    this.execute(executionId, executeFunction);

    return executionId;
  }

  /**
   * Execute an async tool in the background
   */
  async execute(executionId, executeFunction) {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.status = 'running';
    execution.startedAt = Date.now();

    // Extract periodic params BEFORE stripping
    const interval = execution.functionArgs._interval;
    const stopAfter = execution.functionArgs._stopAfter;
    const duration = execution.functionArgs._duration;

    // Clean args for actual tool execution (strip ALL control params)
    const cleanArgs = stripControlParams(execution.functionArgs);

    log(`[AsyncToolQueue] Started: ${execution.functionName} (${executionId})${interval ? ` | PERIODIC: every ${interval}s, stop=${stopAfter || '∞'}, dur=${duration || '∞'}min` : ''}`);

    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_STARTED, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      functionName: execution.functionName,
      timestamp: Date.now(),
    });

    const progressCallback = (progressData) => {
      this.handleProgress(executionId, progressData);
    };

    try {
      if (interval) {
        // PERIODIC EXECUTION
        await this.executePeriodicTool(executionId, executeFunction, cleanArgs, progressCallback, {
          intervalSeconds: interval,
          stopAfter,
          durationMinutes: duration,
        });
      } else {
        // SINGLE EXECUTION with abort support
        const result = await this.executeWithAbort(execution, executeFunction, cleanArgs, progressCallback);

        if (execution.status === 'cancelled') return; // Was cancelled during execution

        execution.status = 'completed';
        execution.completedAt = Date.now();
        execution.result = result;

        log(`[AsyncToolQueue] Completed: ${execution.functionName} (${executionId}, ${execution.completedAt - execution.startedAt}ms)`);

        broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_COMPLETED, {
          executionId,
          toolCallId: execution.toolCallId,
          conversationId: execution.conversationId,
          assistantMessageId: execution.assistantMessageId,
          functionName: execution.functionName,
          result,
          duration: execution.completedAt - execution.startedAt,
          timestamp: Date.now(),
        });

        if (execution.callbacks?.onComplete) {
          try { await execution.callbacks.onComplete(result, execution); } catch (e) { console.error(`[AsyncToolQueue] Completion callback error:`, e); }
        }
      }
    } catch (error) {
      if (execution.status === 'cancelled') return; // Abort throws, ignore if cancelled

      execution.status = 'failed';
      execution.completedAt = Date.now();
      execution.error = error.message || String(error);

      log(`[AsyncToolQueue] Failed: ${execution.functionName} (${executionId}): ${execution.error}`);

      broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_FAILED, {
        executionId,
        toolCallId: execution.toolCallId,
        conversationId: execution.conversationId,
        assistantMessageId: execution.assistantMessageId,
        functionName: execution.functionName,
        error: execution.error,
        timestamp: Date.now(),
      });

      if (execution.callbacks?.onError) {
        try { await execution.callbacks.onError(error, execution); } catch (e) { console.error(`[AsyncToolQueue] Error callback error:`, e); }
      }
    }
  }

  /**
   * Execute a tool with abort support.
   * Wraps the execution in a race with the AbortController signal.
   */
  async executeWithAbort(execution, executeFunction, cleanArgs, progressCallback) {
    const { abortController } = execution;

    // Race the tool execution against an abort signal
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(new Error('Cancelled by user'));
      };

      if (abortController.signal.aborted) {
        return reject(new Error('Cancelled by user'));
      }

      abortController.signal.addEventListener('abort', onAbort, { once: true });

      executeFunction(cleanArgs, progressCallback)
        .then((result) => {
          abortController.signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((error) => {
          abortController.signal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  /**
   * Execute a tool periodically/repeatedly
   */
  async executePeriodicTool(executionId, executeFunction, cleanArgs, progressCallback, options) {
    const { intervalSeconds, stopAfter, durationMinutes } = options;
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const intervalMs = intervalSeconds * 1000;
    const maxDuration = durationMinutes ? durationMinutes * 60 * 1000 : null;
    const startTime = Date.now();
    let iterationCount = 0;
    const results = [];

    const runIteration = async () => {
      if (execution.status === 'cancelled' || execution.abortController.signal.aborted) {
        log(`[AsyncToolQueue] Periodic cancelled: ${execution.functionName} (${executionId})`);
        if (execution.intervalId) clearInterval(execution.intervalId);
        return;
      }

      if (maxDuration && (Date.now() - startTime) >= maxDuration) {
        log(`[AsyncToolQueue] Duration limit reached: ${execution.functionName} (${executionId})`);
        await this.completePeriodicExecution(executionId, results, startTime);
        return;
      }

      if (stopAfter && iterationCount >= stopAfter) {
        log(`[AsyncToolQueue] Iteration limit reached: ${execution.functionName} (${executionId})`);
        await this.completePeriodicExecution(executionId, results, startTime);
        return;
      }

      try {
        iterationCount++;
        log(`[AsyncToolQueue] Iteration ${iterationCount} of ${execution.functionName} (${executionId})`);

        const result = await executeFunction(cleanArgs, progressCallback);
        results.push({ iteration: iterationCount, result, timestamp: Date.now() });

        progressCallback({
          type: 'iteration_complete',
          iteration: iterationCount,
          totalIterations: stopAfter || '∞',
          result,
          elapsedTime: Date.now() - startTime,
        });
      } catch (error) {
        log(`[AsyncToolQueue] Iteration ${iterationCount} error: ${error.message}`);
        results.push({ iteration: iterationCount, error: error.message, timestamp: Date.now() });
      }
    };

    // Run first iteration immediately
    await runIteration();

    // Schedule subsequent iterations if not already done/cancelled
    if (execution.status !== 'cancelled' && !execution.abortController.signal.aborted) {
      // Check if we already hit the limit after first iteration
      if (stopAfter && iterationCount >= stopAfter) return;
      if (maxDuration && (Date.now() - startTime) >= maxDuration) return;

      await new Promise((resolve) => {
        execution.intervalId = setInterval(async () => {
          await runIteration();
          // Check if we should stop after this iteration
          if (execution.status !== 'running' || execution.abortController.signal.aborted) {
            if (execution.intervalId) clearInterval(execution.intervalId);
            resolve();
          }
        }, intervalMs);

        // Also resolve when abort fires
        execution.abortController.signal.addEventListener('abort', () => {
          if (execution.intervalId) clearInterval(execution.intervalId);
          resolve();
        }, { once: true });
      });
    }
  }

  /**
   * Complete periodic execution and broadcast results
   */
  async completePeriodicExecution(executionId, results, startTime) {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    if (execution.intervalId) {
      clearInterval(execution.intervalId);
      execution.intervalId = null;
    }

    execution.status = 'completed';
    execution.completedAt = Date.now();
    execution.result = {
      periodicExecution: true,
      totalIterations: results.length,
      results,
      totalDuration: Date.now() - startTime,
    };

    log(`[AsyncToolQueue] Periodic completed: ${execution.functionName} (${results.length} iterations, ${Date.now() - startTime}ms)`);

    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_COMPLETED, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      assistantMessageId: execution.assistantMessageId,
      functionName: execution.functionName,
      result: execution.result,
      duration: execution.completedAt - execution.startedAt,
      timestamp: Date.now(),
    });

    if (execution.callbacks?.onComplete) {
      try { await execution.callbacks.onComplete(execution.result, execution); } catch (e) { console.error(`[AsyncToolQueue] Completion callback error:`, e); }
    }
  }

  handleProgress(executionId, progressData) {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.progressUpdates.push({ timestamp: Date.now(), data: progressData });

    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_PROGRESS, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      functionName: execution.functionName,
      progress: progressData,
      timestamp: Date.now(),
    });

    if (execution.callbacks?.onProgress) {
      try { execution.callbacks.onProgress(progressData, execution); } catch (e) { console.error(`[AsyncToolQueue] Progress callback error:`, e); }
    }
  }

  getExecution(executionId) {
    return this.executions.get(executionId);
  }

  getExecutionsByConversation(conversationId) {
    return Array.from(this.executions.values()).filter((e) => e.conversationId === conversationId);
  }

  getRunningExecutions(conversationId) {
    return this.getExecutionsByConversation(conversationId).filter((e) => e.status === 'running');
  }

  /**
   * Cancel an async tool execution. Actually stops it via AbortController.
   */
  cancel(executionId) {
    const execution = this.executions.get(executionId);
    if (!execution) return { success: false, error: 'Execution not found' };

    if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
      return { success: false, error: 'Execution already finished' };
    }

    // Abort the running execution
    execution.abortController.abort();

    // Clear periodic interval
    if (execution.intervalId) {
      clearInterval(execution.intervalId);
      execution.intervalId = null;
    }

    execution.status = 'cancelled';
    execution.completedAt = Date.now();

    log(`[AsyncToolQueue] Cancelled: ${execution.functionName} (${executionId})`);

    broadcastToUser(execution.userId, RealtimeEvents.ASYNC_TOOL_FAILED, {
      executionId,
      toolCallId: execution.toolCallId,
      conversationId: execution.conversationId,
      assistantMessageId: execution.assistantMessageId,
      functionName: execution.functionName,
      error: 'Cancelled by user',
      timestamp: Date.now(),
    });

    return { success: true };
  }

  /**
   * Cancel ALL running executions for a conversation
   */
  cancelAllForConversation(conversationId) {
    const running = this.getRunningExecutions(conversationId);
    let cancelled = 0;
    for (const exec of running) {
      const result = this.cancel(exec.executionId);
      if (result.success) cancelled++;
    }
    return { cancelled, total: running.length };
  }

  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [executionId, execution] of this.executions.entries()) {
        if (execution.completedAt && now - execution.completedAt > this.cleanupIntervalMs) {
          this.executions.delete(executionId);
        }
      }
    }, this.cleanupIntervalMs);
  }

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

const asyncToolQueue = new AsyncToolQueue();
export default asyncToolQueue;
