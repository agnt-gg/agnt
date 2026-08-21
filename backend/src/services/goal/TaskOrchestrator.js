import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import AgentTaskMatcher from './AgentTaskMatcher.js';
import LlmExecutionService from '../ai/LlmExecutionService.js';
import { raceWithAbort, GoalCancelledError, isCancellationError } from '../../utils/abortUtils.js';
import { buildAgentRuntime } from '../orchestrator/agentRuntime.js';
import GoalEvaluator from './GoalEvaluator.js';
import GoalProcessor from './GoalProcessor.js';
import SkillForgeOrchestrator from './SkillForgeOrchestrator.js';
import InsightTriggers from '../evolution/InsightTriggers.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';
import { getNodeId } from '../cluster/nodeIdentity.js';
import { checkSpendAdmission } from '../cluster/admission.js';
import autonomousMessageService from '../AutonomousMessageService.js';
import db from '../../models/database/index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * How many tasks this node will run at once.
 *
 * ---------------------------------------------------------------------------
 * WHY A CEILING AT ALL
 * ---------------------------------------------------------------------------
 * Two separate problems share this one number.
 *
 * The first is local: a group of sibling tasks used to be dispatched with an
 * unbounded `Promise.allSettled`, so a goal with fifty tasks at the same
 * order_index started fifty agent turns inside one process — fifty concurrent
 * provider streams, fifty tool sandboxes, one event loop.
 *
 * The second is the fleet: those claims complete in single-digit milliseconds,
 * while a worker polls on a multi-second interval. A primary that took the
 * whole group therefore won every race by four orders of magnitude and left
 * its workers idle — measured, with two healthy credentialed workers taking
 * ZERO claims on a six-task goal. Adding nodes changed nothing, because the
 * busiest machine in the cluster was also the greediest.
 *
 * Bounding the take fixes both: the primary runs a sane number itself and
 * leaves the rest PENDING, which is precisely the state the pull design needs
 * work to be in for anyone else to take it.
 *
 * ---------------------------------------------------------------------------
 * WHY UNCLAIMED WORK IS NOT STRANDED
 * ---------------------------------------------------------------------------
 * A ceiling alone would be a serious regression: `executeGoalTasks` visits
 * each order_index group exactly once, so tasks left behind would simply never
 * run on a single-node install. The group is therefore drained in WAVES — take
 * up to N, run them, come back for whatever is still pending — until nothing
 * claimable remains. A lone node still finishes every task in the group; it
 * just stops doing all of them simultaneously.
 *
 * The default is small on purpose. Real goals put a handful of tasks at one
 * order_index, so this changes nothing for them, and it caps the pathological
 * case that nobody designed for.
 */
const DEFAULT_LOCAL_TASK_CONCURRENCY = 4;

function localTaskConcurrency() {
  const raw = Number(process.env.AGNT_LOCAL_TASK_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LOCAL_TASK_CONCURRENCY;
  return Math.floor(raw);
}

class TaskOrchestrator {
  static runningGoals = new Map(); // Track active goals

  /**
   * Abort a running goal's in-flight work and remove it from tracking.
   * reason: 'paused' | 'stopped'. The abort reason (a GoalCancelledError)
   * propagates through raceWithAbort so awaits unblock immediately.
   */
  static _cancelGoal(goalId, reason) {
    const entry = this.runningGoals.get(goalId);
    this.runningGoals.delete(goalId);
    if (entry?.abortController && !entry.abortController.signal.aborted) {
      entry.abortController.abort(new GoalCancelledError(goalId, reason));
    }
    if (entry?.userId) {
      broadcastToUser(entry.userId, RealtimeEvents.GOAL_UPDATED, {
        id: goalId,
        status: reason,
      });
    }
  }

  static _getGoalSignal(goalId) {
    return this.runningGoals.get(goalId)?.abortController?.signal || null;
  }

  static _isCancellation(error) {
    return isCancellationError(error);
  }

  static async executeGoal(goalId, userId, experimentContext = null, provider = null, model = null, conversationId = null) {
    try {
      // Mark goal as executing
      await GoalModel.updateStatus(goalId, 'executing');

      // Reset any failed/stuck tasks to pending so they can be re-executed
      const tasks = await TaskModel.findByGoalId(goalId);
      for (const task of tasks) {
        if (task.status === 'failed' || task.status === 'running') {
          await TaskModel.updateStatus(task.id, 'pending', 0);
        }
      }

      // Start monitoring this goal with real workflow execution
      this.runningGoals.set(goalId, {
        userId,
        startTime: Date.now(),
        status: 'executing',
        abortController: new AbortController(),
        experimentContext,
        provider,
        model,
        conversationId,
      });

      // Broadcast status change to frontend
      broadcastToUser(userId, RealtimeEvents.GOAL_UPDATED, {
        id: goalId,
        status: 'executing',
      });

      // Start real task execution with workflows
      this.executeGoalTasks(goalId, userId, provider, model);

      return {
        goalId,
        status: 'started',
        message: 'Goal execution initiated with agent-based task execution',
      };
    } catch (error) {
      console.error('Error starting goal execution:', error);
      throw error;
    }
  }
  static async executeGoalTasks(goalId, userId, provider = null, model = null) {
    console.log(`Starting workflow-based execution for goal ${goalId}`);
    const signal = this._getGoalSignal(goalId);

    try {
      // Get all tasks for this goal, ordered by order_index
      const tasks = await TaskModel.findByGoalId(goalId);

      if (tasks.length === 0) {
        console.log(`No tasks found for goal ${goalId}`);
        return;
      }

      // Group tasks by order_index for parallel execution
      const taskGroups = new Map();
      for (const task of tasks) {
        const orderIndex = task.order_index || 0;
        if (!taskGroups.has(orderIndex)) {
          taskGroups.set(orderIndex, []);
        }
        taskGroups.get(orderIndex).push(task);
      }

      // Sort groups by order_index
      const sortedGroupKeys = [...taskGroups.keys()].sort((a, b) => a - b);

      // Execute groups sequentially, tasks within each group in parallel
      let previousGroupOutputs = null;

      for (const orderIndex of sortedGroupKeys) {
        const group = taskGroups.get(orderIndex);

        if (!this.runningGoals.has(goalId)) {
          console.log(`Goal ${goalId} was stopped, ending execution`);
          return;
        }

        // Filter out already-completed tasks, but collect their outputs
        const tasksToExecute = [];
        for (const task of group) {
          if (task.status === 'completed') {
            console.log(`[TaskOrchestrator] Task ${task.id} already completed, skipping`);
            try {
              const output = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
              if (output) previousGroupOutputs = output;
            } catch { /* ignore parse errors */ }
          } else {
            tasksToExecute.push(task);
          }
        }

        if (tasksToExecute.length === 0) continue;

        // Dispatch this group in BOUNDED WAVES rather than all of it at once.
        //
        // localTaskConcurrency() above explains why the ceiling exists. This
        // loop is what makes the ceiling SAFE: each group is visited exactly
        // once by the outer loop, so simply claiming fewer tasks would strand
        // the remainder forever on an install with nobody else to run them.
        // Instead the group is drained — take up to N, run them, come back for
        // whatever is still pending — until nothing claimable is left.
        //
        // TERMINATION: every pass either claims at least one task, which
        // strictly shrinks the queue because claimed tasks are not carried
        // forward, or claims none and breaks. So the loop runs at most once
        // per task in the group.
        const waveSize = localTaskConcurrency();
        let queue = tasksToExecute;
        let stopGoal = false;

        while (queue.length > 0) {
          // Re-checked per wave, not just per group: a wave can take minutes,
          // and a goal stopped during one must not have another dispatched.
          if (!this.runningGoals.has(goalId)) {
            console.log(`Goal ${goalId} was stopped, ending execution`);
            return;
          }

          // The budget gate is applied HERE too, not only on the cluster route.
          // A ceiling that workers respect and the primary ignores is not a
          // ceiling. Checked once per WAVE rather than once per task: it is a
          // spend limit, not a quota, and a wave is this node's unit of
          // "starting new work". Returns admit:true immediately — with no query
          // at all — when no limit is configured, which is every install that
          // has not asked for one.
          const admission = await checkSpendAdmission(userId);
          if (!admission.admit) {
            // Stop admitting NEW work. Anything already running is untouched —
            // killing a turn mid-flight for a billing reason destroys more value
            // than the overage it prevents.
            console.warn(
              `[TaskOrchestrator] goal ${goalId} paused at the spend ceiling ` +
                `(${admission.reason}, spent $${admission.spentUsd ?? '?'} of $${admission.hardLimitUsd ?? '?'})`
            );
            await GoalModel.updateStatus(goalId, 'paused');
            broadcastToUser(userId, RealtimeEvents.GOAL_UPDATED, { id: goalId, status: 'paused' });
            return;
          }

          // Check dependencies for the tasks in this wave, then take a claim on
          // each one we intend to run.
          //
          // The claim is the ONLY thing standing between two nodes and running
          // the same task twice, and it is deliberately here rather than inside
          // executeTask: a task must be excluded from this wave's batch before
          // any work begins on it, not abandoned halfway through.
          const executableTasks = [];
          const deferred = [];
          for (const task of queue) {
            if (executableTasks.length >= waveSize) {
              // Past this node's ceiling. Left PENDING and UNCLAIMED on
              // purpose: pending is the only state another node can take work
              // from, and this node comes back for it next wave if none does.
              deferred.push(task);
              continue;
            }
            const canExecute = await TaskModel.canExecuteTask(task.id);
            if (!canExecute) {
              // Deferred rather than dropped — an earlier wave of this same
              // group may be exactly what satisfies the dependency.
              console.log(`Task ${task.id} dependencies not met, skipping for now`);
              deferred.push(task);
              continue;
            }
            const claimed = await TaskModel.claim(task.id, getNodeId());
            if (!claimed) {
              // Someone else holds a live lease on it. Not an error, and not
              // something to retry here — whoever holds it is running it.
              console.log(`[TaskOrchestrator] Task ${task.id} is claimed by another node — skipping`);
              continue;
            }
            executableTasks.push(task);
          }

          // Nothing left this node can start: either the fleet holds the rest,
          // or what remains is blocked on dependencies this group cannot meet.
          if (executableTasks.length === 0) break;

          if (executableTasks.length === 1) {
            // Single task — run directly
            try {
              const taskOutputs = await this.executeTask(executableTasks[0], userId, previousGroupOutputs, provider, model, signal);
              if (taskOutputs) {
                previousGroupOutputs = taskOutputs;
                console.log(`[TaskOrchestrator] Task ${executableTasks[0].id} completed with outputs for next group`);
              }
            } catch (error) {
              if (this._isCancellation(error)) {
                console.log(`Goal ${goalId} cancelled during task ${executableTasks[0].id} — ending execution`);
                return;
              }
              console.error(`Error executing task ${executableTasks[0].id}:`, error);
              await TaskModel.updateStatus(executableTasks[0].id, 'failed');
              stopGoal = true;
              break;
            }
          } else {
            // Multiple tasks in this wave — run them in parallel
            console.log(`[TaskOrchestrator] Running ${executableTasks.length} tasks in parallel (order_index: ${orderIndex})`);
            const results = await Promise.allSettled(
              executableTasks.map(task => this.executeTask(task, userId, previousGroupOutputs, provider, model, signal))
            );

            // Collect outputs from all parallel tasks
            const groupOutputs = [];
            let hasFailure = false;
            let cancelled = false;
            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              if (result.status === 'fulfilled' && result.value) {
                groupOutputs.push({
                  taskId: executableTasks[i].id,
                  taskTitle: executableTasks[i].title,
                  ...result.value,
                });
              } else if (result.status === 'rejected') {
                if (this._isCancellation(result.reason)) {
                  cancelled = true;
                  continue;
                }
                console.error(`Error executing parallel task ${executableTasks[i].id}:`, result.reason);
                await TaskModel.updateStatus(executableTasks[i].id, 'failed');
                hasFailure = true;
              }
            }

            if (cancelled) {
              console.log(`Goal ${goalId} cancelled during parallel task execution — ending execution`);
              return;
            }

            // Merge parallel outputs for the next group
            if (groupOutputs.length > 0) {
              previousGroupOutputs = {
                parallelResults: groupOutputs,
                summary: groupOutputs.map(o => `[${o.taskTitle}]: ${typeof o.content === 'string' ? o.content.substring(0, 500) : 'completed'}`).join('\n\n'),
              };
            }

            if (hasFailure && groupOutputs.length === 0) {
              // Every task in this wave failed — stop execution
              stopGoal = true;
              break;
            }
          }

          queue = deferred;
        }

        if (stopGoal) break;
      }

      // Check if all tasks are complete
      // Skip completeGoal if running inside the autonomous loop — the loop handles its own completion
      const goalData = this.runningGoals.get(goalId);
      if (!goalData?.autonomous) {
        const isComplete = await this.checkGoalCompletion(goalId);
        if (isComplete) {
          await this.completeGoal(goalId);
        }
      }
    } catch (error) {
      if (this._isCancellation(error)) {
        console.log(`Goal ${goalId} cancelled — execution halted`);
        return;
      }
      console.error(`Error in goal execution for goal ${goalId}:`, error);
      await this.handleGoalError(goalId, error);
    }
  }
  /**
   * Keep this node's claim on a task alive for as long as the task is running.
   *
   * WHY A TIMER AND NOT A PROGRESS HOOK
   * ───────────────────────────────────
   * The lease has to outlive the work, and the work is an agent turn: it can
   * sit inside a single provider call for minutes and report nothing. Renewing
   * from a progress callback would let the lease lapse during exactly the
   * quiet stretch it exists to cover, and the reaper would then hand a
   * *running* task to another node — turning a safety mechanism into the
   * duplicate execution it was added to prevent.
   *
   * Renews at a third of the lease, so two consecutive missed ticks are still
   * survivable. unref'd, so a pending renewal can never hold the process open.
   *
   * @returns {() => void} stop function; safe to call more than once
   */
  static _holdClaim(taskId, leaseMs = TaskModel.DEFAULT_LEASE_MS) {
    const timer = setInterval(() => {
      TaskModel.renewClaim(taskId, getNodeId(), leaseMs).catch((error) => {
        // Never throw out of a timer — an unhandled rejection here would take
        // down the process over a bookkeeping write.
        console.warn(`[TaskOrchestrator] lease renewal failed for task ${taskId}: ${error.message}`);
      });
    }, Math.max(1000, Math.floor(leaseMs / 3)));
    if (typeof timer.unref === 'function') timer.unref();

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    };
  }

  static async executeTask(task, userId, previousTaskOutputs = null, provider = null, model = null, signal = null) {
    console.log(`[TaskOrchestrator] Executing task: ${task.title} (ID: ${task.id})`);

    // The caller already claimed this task; this keeps that claim from lapsing
    // while the agent works. Stopped in the finally below, on every path.
    const releaseLeaseTimer = this._holdClaim(task.id);

    try {
      // Step 1: Select and assign appropriate agent
      console.log(`[TaskOrchestrator] Step 1: Selecting agent for task ${task.id}`);
      const agent = await AgentTaskMatcher.selectAgentForTask(task, userId);

      // Only assign agent to task if it's not a built-in agent
      if (!agent.isBuiltIn) {
        await TaskModel.assignAgent(task.id, agent.id);
        console.log(`[TaskOrchestrator] Step 1 Complete: Agent ${agent.name} (${agent.id}) assigned to task ${task.id}`);
      } else {
        console.log(`[TaskOrchestrator] Step 1 Complete: Using built-in agent ${agent.name} (${agent.id}) for task ${task.id}`);
      }

      // Step 2: Prepare task message for agent
      console.log(`[TaskOrchestrator] Step 2: Preparing task message`);
      const taskMessage = this.prepareTaskMessage(task, previousTaskOutputs);
      console.log(`[TaskOrchestrator] Step 2 Complete: Task message prepared`);

      // Step 3: Update task status to running with input data
      console.log(`[TaskOrchestrator] Step 3: Updating task ${task.id} status to 'running'`);
      const taskInput = {
        message: taskMessage,
        previousOutputs: previousTaskOutputs,
        agent: { id: agent.id, name: agent.name },
      };
      await TaskModel.updateStatus(task.id, 'running', 0, new Date().toISOString(), null, taskInput);
      console.log(`[TaskOrchestrator] Step 3 Complete: Task ${task.id} marked as running with input data`);

      // Broadcast task running
      broadcastToUser(userId, RealtimeEvents.GOAL_TASK_UPDATED, {
        goalId: task.goal_id,
        taskId: task.id,
        title: task.title,
        status: 'running',
        agentName: agent.name,
      });

      // Step 4: Execute task via agent chat
      console.log(`[TaskOrchestrator] Step 4: Executing task via agent ${agent.name}`);
      const result = await this.executeTaskViaAgentChat(agent, taskMessage, userId, provider, model, signal, {
        origin: 'goal_task',
        originId: task.goal_id,
      });
      console.log(`[TaskOrchestrator] Step 4 Complete: Agent completed task execution`);

      // Step 5: Process and store results
      console.log(`[TaskOrchestrator] Step 5: Processing task results`);
      const taskOutputs = await this.processTaskResult(task.id, result);
      console.log(`[TaskOrchestrator] Step 5 Complete: Task ${task.id} completed successfully`);

      // Broadcast task completed
      broadcastToUser(userId, RealtimeEvents.GOAL_TASK_UPDATED, {
        goalId: task.goal_id,
        taskId: task.id,
        title: task.title,
        status: 'completed',
        agentName: agent.name,
      });

      return taskOutputs; // Return outputs for next task
    } catch (error) {
      if (this._isCancellation(error)) {
        // Pause/stop/delete: leave the task resumable, never mark it failed.
        console.log(`[TaskOrchestrator] Task ${task.id} cancelled (${error.message}) — resetting to pending`);
        await TaskModel.updateStatus(task.id, 'pending', 0).catch(() => {});
        // Hand the claim back now rather than making the whole fleet wait out
        // a lease on a task this node has openly stopped working on.
        await TaskModel.releaseClaim(task.id, getNodeId()).catch(() => {});
        broadcastToUser(userId, RealtimeEvents.GOAL_TASK_UPDATED, {
          goalId: task.goal_id,
          taskId: task.id,
          title: task.title,
          status: 'pending',
        });
        throw error;
      }
      console.error(`[TaskOrchestrator] Error executing task ${task.id}:`, error);
      console.log(`[TaskOrchestrator] Marking task ${task.id} as failed due to error`);
      await TaskModel.updateStatus(task.id, 'failed');
      await TaskModel.releaseClaim(task.id, getNodeId()).catch(() => {});

      // Broadcast task failed
      broadcastToUser(userId, RealtimeEvents.GOAL_TASK_UPDATED, {
        goalId: task.goal_id,
        taskId: task.id,
        title: task.title,
        status: 'failed',
        error: error.message,
      });

      throw error;
    } finally {
      releaseLeaseTimer();
    }
  }
  static prepareTaskMessage(task, previousTaskOutputs) {
    let message = `TASK ASSIGNMENT:
Title: ${task.title}
Description: ${task.description}

OBJECTIVE: Complete this task using your assigned tools. Provide clear, actionable results.`;

    if (previousTaskOutputs) {
      message += `

PREVIOUS TASK DATA:
${JSON.stringify(previousTaskOutputs, null, 2)}

IMPORTANT: Use the previous task outputs as input data for your work. Build upon what has already been completed.`;
    }

    message += `

DELIVERABLES:
- Provide clear output/results that can be used by subsequent tasks
- Use your tools as needed to accomplish the objective
- Report completion status and any relevant findings

Begin working on this task now.`;

    return message;
  }
  static async executeTaskViaAgentChat(agent, taskMessage, userId, reqProvider = null, reqModel = null, signal = null, ledgerCtx = null) {
    console.log(`[TaskOrchestrator] Sending task to agent ${agent.name} via chat`);

    try {
      // Prepare messages
      const messages = [{ role: 'user', content: taskMessage }];

      // Priority: request provider/model → agent config → user settings
      let provider = reqProvider;
      let model = reqModel;

      // If not from request, check agent config
      if (!provider && agent.provider && agent.provider.trim() !== '') {
        provider = agent.provider;
      }
      if (!model && agent.model && agent.model.trim() !== '') {
        model = agent.model;
      }

      // If still missing, fall back to user settings
      if (!provider || !model) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);

        if (!provider) {
          provider = userSettings?.selectedProvider;
          console.log(`[TaskOrchestrator] Using user's default provider: ${provider}`);
        }
        if (!model) {
          model = userSettings?.selectedModel;
          console.log(`[TaskOrchestrator] Using user's default model: ${model}`);
        }
      }

      // Validate that we have provider and model
      if (!provider || !model) {
        throw new Error('No provider/model configured. Please set your default provider and model in user settings.');
      }

      console.log(`[TaskOrchestrator] Executing with provider: ${provider}, model: ${model}`);

      // SAME RUNTIME AS THE AGENT CHAT. This block previously filtered
      // getAvailableToolSchemas() — called with no userId, so Tool Forge
      // tools were absent entirely (issue #64) — by assignedTools alone,
      // ignoring toolAccessMode, the agent defaults and the universal
      // primitives. The prompt then told the agent to call activate_skill
      // and save_agent_memory, neither of which was in its schema list.
      // Resolved after provider/model so the prompt's block gates see the
      // provider that will actually serve the turn.
      const { systemPrompt, toolSchemas: availableTools } = await buildAgentRuntime({
        agentId: agent.id,
        userId,
        latestUserMessage: taskMessage,
        provider,
      });

      // Execute with tools using LlmExecutionService
      // CRITICAL FIX: Pass userId in context so tools can access OAuth tokens
      const result = await LlmExecutionService.executeWithTools({
        provider,
        model,
        userId,
        messages,
        toolSchemas: availableTools,
        systemPrompt,
        context: {
          userId, // CRITICAL: Add userId to context for tool authentication
          agentId: agent.id,
          agentName: agent.name,
        },
        // PRD-122: attribute this call's spend to whatever caused it.
        //
        // Supplied by the caller rather than hard-coded, because this method
        // has two callers with genuinely different answers: the goal system
        // (goal_task) and the run_agent tool (agent). Hard-coding 'goal_task'
        // filed every run_agent invocation under goal spend with a null goal
        // id — real money attributed to a goal that does not exist.
        ledger: ledgerCtx || { origin: 'system', originId: null },
        maxToolRounds: 10,
        signal,
      });

      // Format response to match expected structure
      return {
        content: result.content,
        tool_executions: result.toolExecutions.map((execution) => ({
          name: execution.name,
          arguments: execution.arguments,
          response: execution.response,
        })),
        usage: result.usage || null,
      };
    } catch (error) {
      console.error(`[TaskOrchestrator] Error executing task via agent chat:`, error);
      throw error;
    }
  }
  static async processTaskResult(taskId, agentResponse) {
    console.log(`[TaskOrchestrator] Processing results for task ${taskId}`);

    // Extract structured data from agent response
    const outputs = {
      content: agentResponse.content,
      toolExecutions: agentResponse.tool_executions || [],
      files: this.extractFileReferences(agentResponse),
      timestamp: new Date().toISOString(),
      usage: agentResponse.usage || null,
    };

    // Mark task as completed with output data
    await TaskModel.updateStatus(taskId, 'completed', 100, null, outputs.timestamp, null, outputs);

    // Store results (for backward compatibility)
    await this.storeTaskResults(taskId, outputs);

    return outputs;
  }
  static extractFileReferences(agentResponse) {
    const files = [];

    // Look for file paths in tool executions
    if (agentResponse.tool_executions) {
      agentResponse.tool_executions.forEach((execution) => {
        if (execution.name === 'file_operations' && execution.arguments.path) {
          files.push(execution.arguments.path);
        }
      });
    }

    // Look for file paths in content (simple pattern matching)
    if (typeof agentResponse.content === 'string') {
      const filePathPattern = /(?:file:\/\/|path:\s*)([^\s,;]+\.[a-zA-Z0-9]+)/g;
      const matches = agentResponse.content.matchAll(filePathPattern);
      for (const match of matches) {
        files.push(match[1]);
      }
    }

    return files;
  }
  static async loadToolLibrary() {
    try {
      // Load the tool library from the frontend tools directory
      // Navigate from backend/src/systems/goals/ to frontend/src/tools/
      const toolLibraryPath = path.resolve(__dirname, '../../tools/toolLibrary.json');
      console.log(`[TaskOrchestrator] Loading tool library from: ${toolLibraryPath}`);

      const toolLibraryContent = await fs.readFile(toolLibraryPath, 'utf-8');
      const toolLibrary = JSON.parse(toolLibraryContent);

      console.log(`[TaskOrchestrator] Successfully loaded tool library with ${Object.keys(toolLibrary).length} categories`);
      return toolLibrary;
    } catch (error) {
      console.error('[TaskOrchestrator] Error loading tool library:', error);
      console.log('[TaskOrchestrator] Using fallback tool library');

      // Fallback to a basic tool library if the file can't be loaded
      return {
        triggers: [
          {
            title: 'Manual Trigger',
            category: 'trigger',
            type: 'manual-trigger',
            icon: 'play',
            description: 'Manually trigger the workflow execution',
          },
        ],
        actions: [
          {
            title: 'Generate with AI LLM',
            category: 'action',
            type: 'generate-with-ai-llm',
            icon: 'magic',
            description: 'Generate content using AI language models',
          },
        ],
        utilities: [
          {
            title: 'Content Output',
            category: 'utility',
            type: 'content-output',
            icon: 'text',
            description: 'Display or output content',
          },
        ],
      };
    }
  }
  static async checkGoalCompletion(goalId) {
    const tasks = await TaskModel.findByGoalId(goalId);
    const completedTasks = tasks.filter((t) => t.status === 'completed');
    return completedTasks.length === tasks.length && tasks.length > 0;
  }
  static async completeGoal(goalId) {
    const goalData = this.runningGoals.get(goalId);
    const userId = goalData?.userId;
    const provider = goalData?.provider || null;
    const model = goalData?.model || null;
    const conversationId = goalData?.conversationId || null;

    await GoalModel.updateStatus(goalId, 'completed', new Date().toISOString());
    console.log(`Goal ${goalId} completed successfully`);

    // Broadcast completion to frontend immediately
    if (userId) {
      broadcastToUser(userId, RealtimeEvents.GOAL_UPDATED, {
        id: goalId,
        status: 'completed',
      });
    }

    // Trigger automatic evaluation
    if (userId) {
      console.log(`[TaskOrchestrator] Starting automatic evaluation for goal ${goalId}`);
      try {
        const evaluation = await GoalEvaluator.evaluateGoal(goalId, userId, 'automatic', provider, model);
        console.log(`[TaskOrchestrator] Evaluation complete: ${evaluation.passed ? 'PASSED' : 'NEEDS REVIEW'} (${evaluation.scores.overall}%)`);

        // Broadcast the final status (validated or needs_review) set by evaluator
        broadcastToUser(userId, RealtimeEvents.GOAL_UPDATED, {
          id: goalId,
          status: evaluation.status,
          evaluation: {
            passed: evaluation.passed,
            scores: evaluation.scores,
            feedback: evaluation.feedback,
          },
        });

        // Auto-merge: send results summary back to the originating conversation
        if (conversationId) {
          this._sendGoalResultsToChat(goalId, conversationId, evaluation).catch(err => {
            console.error('[TaskOrchestrator] Auto-merge to chat failed (non-critical):', err.message);
          });
        }

        // Fire-and-forget: trigger unified insight extraction + SkillForge (non-blocking)
        InsightTriggers.onGoalCompleted(goalId, userId, provider, model).catch(err => {
          console.error('[TaskOrchestrator] Insight/SkillForge analysis failed (non-critical):', err.message);
        });

        // Fire-and-forget: notify ExperimentService if this goal is part of an experiment
        if (goalData?.experimentContext) {
          import('../ExperimentService.js').then(mod => {
            mod.default.onRunCompleted(goalId, goalData.experimentContext, evaluation).catch(err => {
              console.error('[TaskOrchestrator] Experiment notification failed (non-critical):', err.message);
            });
          }).catch(() => {});
        }
      } catch (error) {
        console.error(`[TaskOrchestrator] Evaluation failed for goal ${goalId}:`, error);
        // Don't fail the goal completion if evaluation fails
      }
    }

    this.runningGoals.delete(goalId);
  }

  /**
   * Send goal completion results back to the originating chat conversation.
   * Collects all task outputs and triggers an autonomous message so Annie can
   * synthesize a final response for the user.
   */
  static async _sendGoalResultsToChat(goalId, conversationId, evaluation) {
    const goal = await GoalModel.findOne(goalId);
    const tasks = await TaskModel.findByGoalId(goalId);

    // Collect task results
    const taskSummaries = tasks.map(task => {
      let output = null;
      try {
        output = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
      } catch { /* ignore parse errors */ }

      return {
        title: task.title,
        status: task.status,
        agentId: task.agent_id,
        content: output?.content ? (typeof output.content === 'string' ? output.content.substring(0, 1000) : JSON.stringify(output.content).substring(0, 1000)) : null,
      };
    });

    const systemMessage = {
      role: 'user',
      content: `[System: Goal completed — synthesize results for user]

✅ GOAL COMPLETED: "${goal.title}"

Score: ${evaluation.scores?.overall || 0}% | Status: ${evaluation.passed ? 'PASSED' : 'NEEDS REVIEW'}
${evaluation.feedback ? `Evaluation: ${evaluation.feedback}` : ''}

TASK RESULTS:
${taskSummaries.map(t => `**${t.title}** (${t.status}):\n${t.content || 'No output'}`).join('\n\n---\n\n')}

INSTRUCTIONS:
The goal you delegated has completed. Synthesize the results from all tasks into a clear, comprehensive response for the user.
- Summarize what was accomplished
- Highlight key findings or deliverables from each task
- If the goal needs review (score < 70%), mention what might need improvement
- Be conversational and helpful`,
    };

    await autonomousMessageService.triggerAutonomousMessage(conversationId, systemMessage);
    console.log(`[TaskOrchestrator] Auto-merge results sent to conversation ${conversationId} for goal ${goalId}`);
  }

  /**
   * Send goal failure/stuck notification back to the originating chat conversation.
   */
  static async _sendGoalFailureToChat(goalId, conversationId, reason, details, evaluation = null) {
    const goal = await GoalModel.findOne(goalId);
    const tasks = await TaskModel.findByGoalId(goalId);

    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const failedCount = tasks.filter(t => t.status === 'failed').length;
    const score = evaluation?.scores?.overall || 0;

    const systemMessage = {
      role: 'user',
      content: `[System: Goal did not pass — inform the user]

⚠️ GOAL NEEDS ATTENTION: "${goal.title}"

Status: ${reason.toUpperCase()}
${details}
${score > 0 ? `Best score achieved: ${score}%` : ''}
Tasks: ${completedCount}/${tasks.length} completed, ${failedCount} failed

INSTRUCTIONS:
The goal you delegated did not fully pass. Let the user know:
- What was accomplished (${completedCount} of ${tasks.length} tasks completed)
- Why it stopped (${details})
- Suggest next steps (retry with different approach, review partial results, etc.)
- Be helpful and constructive, not alarming`,
    };

    await autonomousMessageService.triggerAutonomousMessage(conversationId, systemMessage);
    console.log(`[TaskOrchestrator] Goal failure notification sent to conversation ${conversationId} for goal ${goalId}`);
  }
  static async handleGoalError(goalId, error) {
    if (this._isCancellation(error)) {
      // Pause/stop/delete is not a failure — never overwrite 'paused'/'stopped' with 'failed'.
      console.log(`Goal ${goalId} cancelled — not marking as failed`);
      this.runningGoals.delete(goalId);
      return;
    }
    const goalData = this.runningGoals.get(goalId);
    const userId = goalData?.userId;

    await GoalModel.updateStatus(goalId, 'failed');
    this.runningGoals.delete(goalId);
    console.error(`Goal ${goalId} failed:`, error);

    // Broadcast failure to frontend
    if (userId) {
      broadcastToUser(userId, RealtimeEvents.GOAL_UPDATED, {
        id: goalId,
        status: 'failed',
      });
    }
  }
  static async getGoalStatus(goalId) {
    const goal = await GoalModel.findOne(goalId);
    const tasks = await TaskModel.findByGoalId(goalId);

    // Handle case where goal doesn't exist
    if (!goal) {
      console.warn(`[TaskOrchestrator] Goal ${goalId} not found in database`);
      return {
        goalId,
        status: 'not_found',
        progress: 0,
        tasks: {
          total: tasks.length,
          completed: 0,
          running: 0,
          failed: 0,
        },
        currentTasks: [],
        allTasks: tasks.map((t) => ({
          id: t.id,
          goal_id: t.goal_id,
          title: t.title,
          description: t.description,
          status: t.status,
          progress: t.progress || 0,
          required_tools: Array.isArray(t.required_tools) ? t.required_tools : JSON.parse(t.required_tools || '[]'),
          agent_id: t.agent_id,
          agent_name: t.agent_name,
          workflow_id: t.workflow_id,
          input: t.input ? (typeof t.input === 'string' ? JSON.parse(t.input) : t.input) : null,
          output: t.output ? (typeof t.output === 'string' ? JSON.parse(t.output) : t.output) : null,
          error: t.error || null,
          created_at: t.created_at,
          started_at: t.started_at,
          completed_at: t.completed_at,
          order_index: t.order_index,
        })),
      };
    }

    const completedTasks = tasks.filter((t) => t.status === 'completed');
    const runningTasks = tasks.filter((t) => t.status === 'running');
    const failedTasks = tasks.filter((t) => t.status === 'failed');

    const overallProgress = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

    return {
      goalId,
      status: goal.status,
      progress: overallProgress,
      tasks: {
        total: tasks.length,
        completed: completedTasks.length,
        running: runningTasks.length,
        failed: failedTasks.length,
      },
      currentTasks: runningTasks.map((t) => ({
        id: t.id,
        title: t.title,
        progress: t.progress || 0,
      })),
      allTasks: tasks.map((t) => ({
        id: t.id,
        goal_id: t.goal_id,
        title: t.title,
        description: t.description,
        status: t.status,
        progress: t.progress || 0,
        required_tools: Array.isArray(t.required_tools) ? t.required_tools : JSON.parse(t.required_tools || '[]'),
        agent_id: t.agent_id,
        workflow_id: t.workflow_id,
        created_at: t.created_at,
        started_at: t.started_at,
        completed_at: t.completed_at,
        order_index: t.order_index,
      })),
    };
  }
  static async pauseGoal(goalId) {
    await GoalModel.updateStatus(goalId, 'paused');
    this._cancelGoal(goalId, 'paused');
  }
  static async resumeGoal(goalId, provider = null, model = null) {
    const goal = await GoalModel.findOne(goalId);
    if (goal) {
      // Reset any failed/stuck tasks to pending so they can be re-executed
      const tasks = await TaskModel.findByGoalId(goalId);
      for (const task of tasks) {
        if (task.status === 'failed' || task.status === 'running') {
          await TaskModel.updateStatus(task.id, 'pending', 0);
        }
      }

      await GoalModel.updateStatus(goalId, 'executing');
      this.runningGoals.set(goalId, {
        userId: goal.user_id,
        startTime: Date.now(),
        status: 'executing',
        abortController: new AbortController(),
        provider,
        model,
      });

      broadcastToUser(goal.user_id, RealtimeEvents.GOAL_UPDATED, {
        id: goalId,
        status: 'executing',
      });

      this.executeGoalTasks(goalId, goal.user_id, provider, model);
    }
  }
  static async stopGoal(goalId) {
    await GoalModel.updateStatus(goalId, 'stopped');
    this._cancelGoal(goalId, 'stopped');
  }
  static async storeTaskResults(taskId, results) {
    // For now, just log the results. Later you might want to store these in a task_results table
    console.log(`Storing results for task ${taskId}:`, JSON.stringify(results, null, 2));
  }

  // ==================== AGI LOOP: Autonomous Goal Execution ====================

  /**
   * Execute a goal autonomously with iterative feedback loop.
   * Evaluate → Re-plan failed tasks → Re-execute → Repeat until pass or max iterations.
   */
  static async executeGoalAutonomous(goalId, userId, { maxIterations = 50, provider = null, model = null, conversationId = null } = {}) {
    try {
      console.log(`[AGI Loop] Starting autonomous execution for goal ${goalId} (max ${maxIterations} iterations)`);

      // Must run before updateLoopStatus below overwrites the previous run's
      // loop state — that state is what tells us whether to resume or start fresh.
      const resume = await this._resolveResumeState(goalId, maxIterations);

      await GoalModel.updateMaxIterations(goalId, maxIterations);
      await GoalModel.updateLoopStatus(goalId, 'starting');
      await GoalModel.updateStatus(goalId, 'executing');

      this.runningGoals.set(goalId, {
        userId,
        startTime: Date.now(),
        status: 'executing',
        abortController: new AbortController(),
        autonomous: true,
        provider,
        model,
        conversationId,
      });

      // Bootstrap: goals created without tasks (e.g. proposals inserted
      // directly into the goals table by an agent) can never pass evaluation —
      // the loop would burn LLM eval calls on an empty task list and stop as
      // "stuck". Plan tasks from the goal description before entering the loop.
      let bootstrappedTasks = await TaskModel.findByGoalId(goalId);
      if (bootstrappedTasks.length === 0) {
        console.log(`[AGI Loop] Goal ${goalId} has 0 tasks — bootstrapping task plan from goal description`);
        await GoalModel.updateLoopStatus(goalId, 'planning');
        try {
          bootstrappedTasks = await GoalProcessor.planTasksForExistingGoal(goalId, userId, provider, model);
          console.log(`[AGI Loop] Bootstrapped ${bootstrappedTasks.length} tasks for goal ${goalId}`);
        } catch (bootstrapError) {
          console.error(`[AGI Loop] Task bootstrap failed for goal ${goalId}:`, bootstrapError.message);
        }
        await GoalModel.updateLoopStatus(goalId, 'starting');
      }

      // Fail fast: if there are still no tasks, exit with a clear error
      // instead of looping evaluate/replan against nothing.
      if (bootstrappedTasks.length === 0) {
        console.error(`[AGI Loop] Goal ${goalId} has no tasks and task planning failed — aborting (no_tasks)`);
        await GoalModel.updateLoopStatus(goalId, 'error');
        await GoalModel.updateStatus(goalId, 'failed');
        broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_ERROR, {
          goalId,
          error: 'no_tasks: goal has no tasks and automatic task planning failed',
        });
        if (conversationId) {
          this._sendGoalFailureToChat(goalId, conversationId, 'no_tasks', 'Goal has no tasks and automatic task planning failed — nothing to execute.').catch(() => {});
        }
        this.runningGoals.delete(goalId);
        return { goalId, status: 'error', reason: 'no_tasks' };
      }

      let identicalReplanCount = 0;
      let lastReplanHash = null;

      // Keep/discard tracking (monotone improvement guarantee), seeded from
      // the previous run's persisted state when resuming an interrupted loop.
      let bestScore = resume.bestScore;
      let bestIteration = resume.bestIteration;
      let bestTaskSnapshot = resume.bestTaskSnapshot;

      for (let iteration = resume.startIteration; iteration <= maxIterations; iteration++) {
        const iterationStart = Date.now();

        // Check if goal was paused/stopped
        if (!this.runningGoals.has(goalId)) {
          console.log(`[AGI Loop] Goal ${goalId} was stopped, ending loop at iteration ${iteration}`);
          await GoalModel.updateLoopStatus(goalId, 'stopped');
          return { goalId, status: 'stopped', iteration };
        }

        console.log(`[AGI Loop] === Iteration ${iteration}/${maxIterations} for goal ${goalId} ===`);
        await GoalModel.updateIteration(goalId, iteration);
        await GoalModel.updateLoopStatus(goalId, 'executing');

        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_START, {
          goalId,
          iteration,
          maxIterations,
          phase: 'executing',
          bestScore,
          bestIteration,
        });

        // Phase 1: Execute tasks
        try {
          await this.executeGoalTasks(goalId, userId, provider, model);
        } catch (error) {
          console.error(`[AGI Loop] Task execution error at iteration ${iteration}:`, error);
          // Don't break — evaluate what we have
        }

        // Cancellation check between phases: don't burn an evaluation LLM call after pause/stop
        if (!this.runningGoals.has(goalId)) {
          console.log(`[AGI Loop] Goal ${goalId} was paused/stopped during execution at iteration ${iteration}`);
          await GoalModel.updateLoopStatus(goalId, 'stopped');
          return { goalId, status: 'stopped', iteration };
        }

        // Phase 2: Evaluate
        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_EVALUATE, {
          goalId,
          iteration,
          phase: 'evaluating',
        });

        let evaluation;
        let evaluationFailed = false;
        try {
          evaluation = await raceWithAbort(
            GoalEvaluator.evaluateGoal(goalId, userId, 'automatic', provider, model),
            this._getGoalSignal(goalId)
          );
        } catch (error) {
          if (this._isCancellation(error)) {
            console.log(`[AGI Loop] Goal ${goalId} cancelled during evaluation at iteration ${iteration}`);
            await GoalModel.updateLoopStatus(goalId, 'stopped');
            return { goalId, status: 'stopped', iteration };
          }
          console.error(`[AGI Loop] Evaluation error at iteration ${iteration}:`, error);
          evaluationFailed = true;
          evaluation = { passed: false, scores: { overall: 0 }, feedback: error.message };
        }

        // If all tasks completed but evaluation itself failed (LLM error, no provider, etc.),
        // treat the goal as passed — the work is done, don't fail because the evaluator broke
        const allTasksComplete = await this.checkGoalCompletion(goalId);
        if (allTasksComplete && (evaluationFailed || !evaluation.passed)) {
          const failedTasks = (await TaskModel.findByGoalId(goalId)).filter(t => t.status === 'failed');
          if (failedTasks.length === 0) {
            console.log(`[AGI Loop] All tasks completed for goal ${goalId} — treating as passed${evaluationFailed ? ' (evaluator failed)' : ' (all work done)'}`);
            evaluation.passed = true;
            if (evaluation.scores.overall === 0) {
              evaluation.scores.overall = 100;
            }
          }
        }

        const iterationDuration = Date.now() - iterationStart;

        const currentScore = evaluation.scores?.overall || 0;
        const isImprovement = currentScore > bestScore;

        // Update best tracking if improved
        if (isImprovement) {
          bestScore = currentScore;
          bestIteration = iteration;
          // Snapshot current tasks for potential revert
          bestTaskSnapshot = await this._captureTaskSnapshot(goalId);
          // Persist best-tracking so an interrupted run can resume with it
          // (the snapshot itself is recovered from that iteration's DB record).
          try {
            const stateWithBest = await GoalModel.getWorldState(goalId);
            stateWithBest.best = { score: bestScore, iteration: bestIteration, updatedAt: new Date().toISOString() };
            await GoalModel.updateWorldState(goalId, stateWithBest);
          } catch (bestError) {
            console.error(`[AGI Loop] Failed to persist best-tracking (non-fatal):`, bestError.message);
          }
          console.log(`[AGI Loop] New best score: ${bestScore}% at iteration ${iteration}`);
        } else {
          console.log(`[AGI Loop] No improvement (${currentScore}% <= best ${bestScore}%) — will try different approach`);
        }

        // Phase 3: Check if passed
        if (evaluation.passed) {
          console.log(`[AGI Loop] Goal ${goalId} PASSED at iteration ${iteration} (${evaluation.scores.overall}%)`);

          await GoalModel.updateLoopStatus(goalId, 'completed');
          await GoalModel.updateStatus(goalId, 'validated');

          // Record iteration (non-fatal if this fails)
          try {
            await GoalIterationModel.create(
              goalId, iteration, evaluation.scores.overall, true,
              await GoalModel.getWorldState(goalId), [], iterationDuration,
              await this._captureTaskSnapshot(goalId)
            );
            await GoalIterationModel.prune(goalId);
          } catch (recordError) {
            console.error(`[AGI Loop] Failed to record iteration (non-fatal):`, recordError.message);
          }

          broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_COMPLETED, {
            goalId,
            iteration,
            score: evaluation.scores.overall,
            bestScore: evaluation.scores.overall,
            passed: true,
          });

          // Auto-merge: send results summary back to the originating conversation
          if (conversationId) {
            this._sendGoalResultsToChat(goalId, conversationId, evaluation).catch(err => {
              console.error('[AGI Loop] Auto-merge to chat failed (non-critical):', err.message);
            });
          }

          // Fire-and-forget: trigger unified insight extraction + SkillForge (non-blocking)
          InsightTriggers.onGoalCompleted(goalId, userId, provider, model).catch(err => {
            console.error('[AGI Loop] Insight/SkillForge analysis failed (non-critical):', err.message);
          });

          this.runningGoals.delete(goalId);
          return { goalId, status: 'completed', iteration, score: evaluation.scores.overall };
        }

        // Cancellation check between phases: don't burn a replanning LLM call after pause/stop
        if (!this.runningGoals.has(goalId)) {
          console.log(`[AGI Loop] Goal ${goalId} was paused/stopped before replanning at iteration ${iteration}`);
          await GoalModel.updateLoopStatus(goalId, 'stopped');
          return { goalId, status: 'stopped', iteration };
        }

        // Phase 4: Re-plan failed tasks
        console.log(`[AGI Loop] Goal ${goalId} needs improvement (${evaluation.scores.overall}%) — re-planning`);
        await GoalModel.updateLoopStatus(goalId, 'replanning');

        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_REPLAN, {
          goalId,
          iteration,
          score: currentScore,
          bestScore,
          bestIteration,
          isImprovement,
          phase: 'replanning',
        });

        const replannedTasks = await raceWithAbort(
          this._replanFailedTasks(goalId, evaluation, userId, provider, model, {
            bestScore,
            bestIteration,
            isImprovement,
            bestTaskSnapshot,
            currentIteration: iteration,
          }),
          this._getGoalSignal(goalId)
        );

        // Guard: detect identical re-plans
        const replanHash = JSON.stringify(replannedTasks.map((t) => t.title + t.description).sort());
        if (replanHash === lastReplanHash) {
          identicalReplanCount++;
          if (identicalReplanCount >= 3) {
            console.error(`[AGI Loop] Identical re-plan detected 3x for goal ${goalId} — stopping`);
            await GoalModel.updateLoopStatus(goalId, 'stuck');
            await GoalModel.updateStatus(goalId, 'needs_review');
            broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_ERROR, {
              goalId,
              iteration,
              error: 'Identical re-plan detected 3 times — stopping to prevent infinite loop',
            });
            if (conversationId) {
              this._sendGoalFailureToChat(goalId, conversationId, 'stuck', 'Goal got stuck — identical replans detected 3 times.', evaluation).catch(() => {});
            }
            this.runningGoals.delete(goalId);
            return { goalId, status: 'stuck', iteration, reason: 'identical_replan' };
          }
        } else {
          identicalReplanCount = 0;
          lastReplanHash = replanHash;
        }

        // Phase 5: Update world state & record iteration (non-fatal if these fail)
        let worldState = {};
        try {
          worldState = await this._updateWorldState(goalId, iteration, evaluation);
          await GoalIterationModel.create(
            goalId, iteration, evaluation.scores.overall, false,
            worldState, replannedTasks, iterationDuration,
            await this._captureTaskSnapshot(goalId)
          );
          await GoalIterationModel.prune(goalId);
        } catch (stateError) {
          console.error(`[AGI Loop] World state/iteration record error (non-fatal):`, stateError.message);
        }

        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_END, {
          goalId,
          iteration,
          score: currentScore,
          bestScore,
          bestIteration,
          isImprovement,
          replannedCount: replannedTasks.length,
          duration: iterationDuration,
        });
      }

      // Max iterations reached
      console.log(`[AGI Loop] Max iterations (${maxIterations}) reached for goal ${goalId}`);
      await GoalModel.updateLoopStatus(goalId, 'max_iterations');
      await GoalModel.updateStatus(goalId, 'needs_review');
      broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_ERROR, {
        goalId,
        iteration: maxIterations,
        error: 'Max iterations reached',
      });
      if (conversationId) {
        this._sendGoalFailureToChat(goalId, conversationId, 'max_iterations', `Goal reached the maximum of ${maxIterations} iterations without passing.`).catch(() => {});
      }
      this.runningGoals.delete(goalId);
      return { goalId, status: 'max_iterations', iteration: maxIterations };
    } catch (error) {
      if (this._isCancellation(error)) {
        console.log(`[AGI Loop] Goal ${goalId} cancelled — loop halted`);
        await GoalModel.updateLoopStatus(goalId, 'stopped').catch(() => {});
        return { goalId, status: 'stopped' };
      }
      console.error(`[AGI Loop] Fatal error for goal ${goalId}:`, error);
      await GoalModel.updateLoopStatus(goalId, 'error');
      await this.handleGoalError(goalId, error);
      broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_ERROR, {
        goalId,
        error: error.message,
      });
      return { goalId, status: 'error', error: error.message };
    }
  }

  /**
   * Re-plan failed/low-scoring tasks using LLM analysis.
   * Resets failed tasks to pending with updated descriptions.
   */
  static async _replanFailedTasks(goalId, evaluation, userId, provider = null, model = null, loopContext = {}) {
    const goal = await GoalModel.findOne(goalId);
    const tasks = await TaskModel.findByGoalId(goalId);
    const worldState = await GoalModel.getWorldState(goalId);

    // Identify tasks needing re-work
    const taskEvaluations = evaluation.taskEvaluations || [];
    const failedTasks = tasks.filter((task) => {
      const taskEval = taskEvaluations.find((te) => te.taskId === task.id);
      return task.status === 'failed' || (taskEval && taskEval.score < 70);
    });

    if (failedTasks.length === 0) {
      // If no specific failures, reset all non-completed tasks
      const incompleteTasks = tasks.filter((t) => t.status !== 'completed' || t.status === 'needs_review');
      for (const task of incompleteTasks) {
        await TaskModel.updateStatus(task.id, 'pending', 0);
      }
      return incompleteTasks.map((t) => ({ id: t.id, title: t.title, description: t.description }));
    }

    // Use LLM to generate improved task descriptions
    const { bestScore = 0, bestIteration = 0, isImprovement = true, currentIteration = 0 } = loopContext;

    // Get iteration history from world state for context
    const iterationHistory = worldState?.iterationHistory || [];
    const historyContext = iterationHistory.length > 0
      ? `\nITERATION HISTORY (what has been tried before):\n${iterationHistory.map(h =>
          `  Iteration #${h.iteration}: ${h.score}% ${h.passed ? '(PASSED)' : '(FAILED)'}`
        ).join('\n')}`
      : '';

    const approachGuidance = !isImprovement
      ? `\n⚠️ CRITICAL: The previous iteration scored ${evaluation.scores?.overall || 0}% which is WORSE than the best score of ${bestScore}% (iteration #${bestIteration}).
The previous approach did NOT work. You MUST try a fundamentally DIFFERENT strategy.
Do NOT repeat or slightly vary the same approach. Think about what went wrong and try something new.`
      : '';

    const prompt = `You are re-planning failed tasks for an autonomous goal execution system.
This is iteration #${currentIteration}. Best score so far: ${bestScore}% (iteration #${bestIteration}).

GOAL: ${goal.title}
DESCRIPTION: ${goal.description}

SUCCESS CRITERIA:
${JSON.stringify(goal.success_criteria, null, 2)}

CURRENT WORLD STATE (what has been accomplished so far):
${JSON.stringify(worldState, null, 2)}
${historyContext}

EVALUATION FEEDBACK:
Score: ${evaluation.scores?.overall || 0}%
Feedback: ${evaluation.feedback || 'No feedback available'}
${approachGuidance}

FAILED/LOW-SCORING TASKS:
${failedTasks
  .map((task) => {
    const taskEval = taskEvaluations.find((te) => te.taskId === task.id);
    const taskOutput = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
    return `- Task: ${task.title}
  Description: ${task.description}
  Score: ${taskEval?.score || 0}%
  Feedback: ${taskEval?.feedback || 'No feedback'}
  Previous Output: ${taskOutput ? JSON.stringify(taskOutput.content || taskOutput, null, 2).substring(0, 500) : 'None'}
  Error: ${task.error || 'None'}`;
  })
  .join('\n\n')}

ALL TASKS (for context):
${tasks.map((t) => `- [${t.status}] ${t.title}`).join('\n')}

Respond with ONLY a valid JSON array of improved task objects:
[
  {
    "taskId": "existing-task-id-to-update",
    "title": "Updated task title (max 50 chars)",
    "description": "Improved, more specific description based on what went wrong"
  }
]

Rules:
- Keep the same task IDs — you are updating existing tasks, not creating new ones
- Make descriptions more specific based on what failed
- Incorporate feedback from the evaluation
- Build upon what was already accomplished (world state)
- If the previous approach didn't improve the score, try a fundamentally different strategy
- Return ONLY the JSON array`;

    try {
      let rawProvider = provider;
      let evalModel = model;
      if (!rawProvider || !evalModel) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);
        if (!rawProvider) rawProvider = userSettings?.selectedProvider;
        if (!evalModel) evalModel = userSettings?.selectedModel;
      }

      if (!rawProvider || !evalModel) {
        throw new Error('No provider/model configured for re-planning');
      }

      const _cfg = getProviderConfig(rawProvider);
      const evalProvider = _cfg ? _cfg.key : rawProvider.toLowerCase();
      const client = await createLlmClient(evalProvider, userId);
      const adapter = await createLlmAdapter(evalProvider, client, evalModel);
      const adapterResult = await adapter.call([
        { role: 'system', content: 'You are a task re-planning assistant. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ], []);

      let result = '';
      if (adapterResult.responseMessage?.content) {
        if (typeof adapterResult.responseMessage.content === 'string') {
          result = adapterResult.responseMessage.content;
        } else if (Array.isArray(adapterResult.responseMessage.content)) {
          result = adapterResult.responseMessage.content.map(block => block.text || '').join('');
        }
      }

      let cleanedResult = result;
      if (typeof result === 'string') {
        cleanedResult = result
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }

      const updatedTasks = JSON.parse(cleanedResult);

      // Apply updates and reset tasks to pending
      for (const update of updatedTasks) {
        const existingTask = failedTasks.find((t) => t.id === update.taskId);
        if (existingTask) {
          // Reset to pending with updated description
          await TaskModel.updateStatus(update.taskId, 'pending', 0);
          // Update description if the model suggested one
          if (update.description) {
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE tasks SET title = ?, description = ?, updated_at = ? WHERE id = ?',
                [update.title || existingTask.title, update.description, new Date().toISOString(), update.taskId],
                (err) => (err ? reject(err) : resolve())
              );
            });
          }
        }
      }

      console.log(`[AGI Loop] Re-planned ${updatedTasks.length} tasks for goal ${goalId}`);
      return updatedTasks;
    } catch (error) {
      console.error(`[AGI Loop] Re-plan LLM failed, doing simple reset:`, error);

      // Fallback: just reset failed tasks to pending
      for (const task of failedTasks) {
        await TaskModel.updateStatus(task.id, 'pending', 0);
      }
      return failedTasks.map((t) => ({ id: t.id, title: t.title, description: t.description }));
    }
  }

  /**
   * Update world state with what's been accomplished so far.
   */
  static async _updateWorldState(goalId, iteration, evaluation) {
    const tasks = await TaskModel.findByGoalId(goalId);
    const existingState = await GoalModel.getWorldState(goalId);

    const worldState = {
      ...existingState,
      lastIteration: iteration,
      lastScore: evaluation.scores?.overall || 0,
      lastEvaluatedAt: new Date().toISOString(),
      completedTasks: tasks
        .filter((t) => t.status === 'completed')
        .map((t) => {
          let outputPreview = null;
          try {
            const parsed = t.output ? (typeof t.output === 'string' ? JSON.parse(t.output) : t.output) : null;
            if (parsed?.content) {
              outputPreview = typeof parsed.content === 'string' ? parsed.content.substring(0, 200) : JSON.stringify(parsed.content).substring(0, 200);
            }
          } catch { /* ignore parse errors */ }
          return { id: t.id, title: t.title, output: outputPreview };
        }),
      failedTasks: tasks
        .filter((t) => t.status === 'failed')
        .map((t) => ({ id: t.id, title: t.title, error: t.error })),
      pendingTasks: tasks.filter((t) => t.status === 'pending').map((t) => ({ id: t.id, title: t.title })),
      // Cap: a goal that re-runs on a schedule accumulates history forever;
      // only the recent window is useful context for replanning.
      iterationHistory: [
        ...(existingState.iterationHistory || []),
        {
          iteration,
          score: evaluation.scores?.overall || 0,
          passed: evaluation.passed,
          timestamp: new Date().toISOString(),
        },
      ].slice(-50),
    };

    await GoalModel.updateWorldState(goalId, worldState);
    return worldState;
  }

  /**
   * Capture the full state of a goal's tasks for iteration records.
   * Stored per-iteration in goal_iterations.task_snapshot; this is what
   * revert-to-iteration and resume-best restore from.
   */
  static async _captureTaskSnapshot(goalId) {
    const tasks = await TaskModel.findByGoalId(goalId);
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      progress: t.progress || 0,
      output: t.output ?? null,
      error: t.error ?? null,
    }));
  }

  /**
   * Decide where a new autonomous run should start.
   *
   * A loop interrupted mid-run (backend restart, pause/stop) resumes from the
   * iteration after the last recorded one, seeded with the persisted best
   * score/snapshot. A loop whose previous run reached a terminal state
   * (completed, stuck, error, max_iterations) starts fresh — including
   * clearing best-tracking, because the monotone-improvement guarantee is
   * per-run: yesterday's outputs are stale context for today's scheduled run.
   */
  static async _resolveResumeState(goalId, maxIterations) {
    const fresh = { startIteration: 1, bestScore: 0, bestIteration: 0, bestTaskSnapshot: null };
    try {
      const goal = await GoalModel.findOne(goalId);
      const interruptedStatuses = ['starting', 'executing', 'replanning', 'stopped', 'reverted'];
      const lastIteration = goal?.current_iteration || 0;
      const resumable = !!goal
        && interruptedStatuses.includes(goal.loop_status)
        && lastIteration >= 1
        && lastIteration < maxIterations;

      const worldState = await GoalModel.getWorldState(goalId);

      if (!resumable) {
        if (worldState.best) {
          delete worldState.best;
          await GoalModel.updateWorldState(goalId, worldState);
        }
        return fresh;
      }

      const best = worldState.best || {};
      let bestTaskSnapshot = null;
      if (best.iteration >= 1) {
        const bestRecord = await GoalIterationModel.findOne(goalId, best.iteration);
        bestTaskSnapshot = bestRecord?.task_snapshot?.length ? bestRecord.task_snapshot : null;
      }

      console.log(`[AGI Loop] Resuming goal ${goalId} from iteration ${lastIteration + 1} (best ${best.score || 0}% at iteration ${best.iteration || 0})`);
      return {
        startIteration: lastIteration + 1,
        bestScore: best.score || 0,
        bestIteration: best.iteration || 0,
        bestTaskSnapshot,
      };
    } catch (error) {
      console.error(`[AGI Loop] Resume-state resolution failed (starting fresh):`, error.message);
      return fresh;
    }
  }
}

export default TaskOrchestrator;
