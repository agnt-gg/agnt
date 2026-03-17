import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import AgentTaskMatcher from './AgentTaskMatcher.js';
import LlmExecutionService from '../ai/LlmExecutionService.js';
import { getAvailableToolSchemas } from '../orchestrator/tools.js';
import GoalEvaluator from './GoalEvaluator.js';
import SkillForgeOrchestrator from './SkillForgeOrchestrator.js';
import InsightTriggers from '../evolution/InsightTriggers.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';
import db from '../../models/database/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

class TaskOrchestrator {
  static runningGoals = new Map(); // Track active goals

  static async executeGoal(goalId, userId, experimentContext = null, provider = null, model = null) {
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
        experimentContext,
        provider,
        model,
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

    try {
      // Get all tasks for this goal, ordered by order_index
      const tasks = await TaskModel.findByGoalId(goalId);

      if (tasks.length === 0) {
        console.log(`No tasks found for goal ${goalId}`);
        return;
      }

      // Sort tasks by order_index to ensure proper execution order
      tasks.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

      // Execute tasks sequentially, passing data between them
      let previousTaskOutputs = null;

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (!this.runningGoals.has(goalId)) {
          console.log(`Goal ${goalId} was stopped, ending execution`);
          return;
        }

        // Skip already-completed tasks (preserve their output for downstream tasks)
        if (task.status === 'completed') {
          console.log(`[TaskOrchestrator] Task ${task.id} already completed, skipping`);
          try {
            const output = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
            if (output) previousTaskOutputs = output;
          } catch { /* ignore parse errors */ }
          continue;
        }

        // Check if task dependencies are met
        const canExecute = await TaskModel.canExecuteTask(task.id);
        if (!canExecute) {
          console.log(`Task ${task.id} dependencies not met, skipping for now`);
          continue;
        }

        try {
          // Execute task with data from previous task
          const taskOutputs = await this.executeTask(task, userId, previousTaskOutputs, provider, model);

          // Store outputs for next task
          if (taskOutputs) {
            previousTaskOutputs = taskOutputs;
            console.log(`[TaskOrchestrator] Task ${task.id} completed with outputs for next task`);
          }
        } catch (error) {
          console.error(`Error executing task ${task.id}:`, error);
          await TaskModel.updateStatus(task.id, 'failed');
          // Don't continue with remaining tasks if one fails in sequential execution
          break;
        }
      }

      // Check if all tasks are complete
      const isComplete = await this.checkGoalCompletion(goalId);
      if (isComplete) {
        await this.completeGoal(goalId);
      }
    } catch (error) {
      console.error(`Error in goal execution for goal ${goalId}:`, error);
      await this.handleGoalError(goalId, error);
    }
  }
  static async executeTask(task, userId, previousTaskOutputs = null, provider = null, model = null) {
    console.log(`[TaskOrchestrator] Executing task: ${task.title} (ID: ${task.id})`);

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

      // Step 4: Execute task via agent chat
      console.log(`[TaskOrchestrator] Step 4: Executing task via agent ${agent.name}`);
      const result = await this.executeTaskViaAgentChat(agent, taskMessage, userId, provider, model);
      console.log(`[TaskOrchestrator] Step 4 Complete: Agent completed task execution`);

      // Step 5: Process and store results
      console.log(`[TaskOrchestrator] Step 5: Processing task results`);
      const taskOutputs = await this.processTaskResult(task.id, result);
      console.log(`[TaskOrchestrator] Step 5 Complete: Task ${task.id} completed successfully`);

      return taskOutputs; // Return outputs for next task
    } catch (error) {
      console.error(`[TaskOrchestrator] Error executing task ${task.id}:`, error);
      console.log(`[TaskOrchestrator] Marking task ${task.id} as failed due to error`);
      await TaskModel.updateStatus(task.id, 'failed');
      throw error;
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
  static async executeTaskViaAgentChat(agent, taskMessage, userId, reqProvider = null, reqModel = null) {
    console.log(`[TaskOrchestrator] Sending task to agent ${agent.name} via chat`);

    try {
      // Get agent's tools
      const agentTools = Array.isArray(agent.assignedTools) ? agent.assignedTools : JSON.parse(agent.tools || '[]');

      // Get all available tool schemas
      const allToolSchemas = await getAvailableToolSchemas();

      // Filter to only tools assigned to this agent
      const availableTools = allToolSchemas.filter((toolSchema) => agentTools.includes(toolSchema.function.name));

      // Build system prompt using LlmExecutionService
      const systemPrompt = LlmExecutionService.buildAgentSystemPrompt(agent, availableTools);

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
        maxToolRounds: 10,
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
  static async handleGoalError(goalId, error) {
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
    this.runningGoals.delete(goalId);
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
    this.runningGoals.delete(goalId);
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
  static async executeGoalAutonomous(goalId, userId, { maxIterations = 50, provider = null, model = null } = {}) {
    try {
      console.log(`[AGI Loop] Starting autonomous execution for goal ${goalId} (max ${maxIterations} iterations)`);

      await GoalModel.updateMaxIterations(goalId, maxIterations);
      await GoalModel.updateLoopStatus(goalId, 'starting');
      await GoalModel.updateStatus(goalId, 'executing');

      this.runningGoals.set(goalId, {
        userId,
        startTime: Date.now(),
        status: 'executing',
        autonomous: true,
        provider,
        model,
      });

      let identicalReplanCount = 0;
      let lastReplanHash = null;

      // Keep/discard tracking (monotone improvement guarantee)
      let bestScore = 0;
      let bestIteration = 0;
      let bestTaskSnapshot = null;

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
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

        // Phase 2: Evaluate
        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_EVALUATE, {
          goalId,
          iteration,
          phase: 'evaluating',
        });

        let evaluation;
        try {
          evaluation = await GoalEvaluator.evaluateGoal(goalId, userId, 'automatic', provider, model);
        } catch (error) {
          console.error(`[AGI Loop] Evaluation error at iteration ${iteration}:`, error);
          evaluation = { passed: false, scores: { overall: 0 }, feedback: error.message };
        }

        const iterationDuration = Date.now() - iterationStart;

        const currentScore = evaluation.scores?.overall || 0;
        const isImprovement = currentScore > bestScore;

        // Update best tracking if improved
        if (isImprovement) {
          bestScore = currentScore;
          bestIteration = iteration;
          // Snapshot current tasks for potential revert
          const currentTasks = await TaskModel.findByGoalId(goalId);
          bestTaskSnapshot = currentTasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            output: t.output,
          }));
          console.log(`[AGI Loop] New best score: ${bestScore}% at iteration ${iteration}`);
        } else {
          console.log(`[AGI Loop] No improvement (${currentScore}% <= best ${bestScore}%) — will try different approach`);
        }

        // Phase 3: Check if passed
        if (evaluation.passed) {
          console.log(`[AGI Loop] Goal ${goalId} PASSED at iteration ${iteration} (${evaluation.scores.overall}%)`);

          await GoalModel.updateLoopStatus(goalId, 'completed');
          await GoalModel.updateStatus(goalId, 'validated');

          // Record iteration
          const gitHash = await this._gitCheckpoint(goalId, iteration, evaluation.scores.overall, userId);
          await GoalIterationModel.create(
            goalId, iteration, evaluation.scores.overall, true,
            await GoalModel.getWorldState(goalId), [], gitHash, iterationDuration
          );

          broadcastToUser(userId, RealtimeEvents.GOAL_LOOP_COMPLETED, {
            goalId,
            iteration,
            score: evaluation.scores.overall,
            bestScore: evaluation.scores.overall,
            passed: true,
          });

          // Fire-and-forget: trigger unified insight extraction + SkillForge (non-blocking)
          InsightTriggers.onGoalCompleted(goalId, userId, provider, model).catch(err => {
            console.error('[AGI Loop] Insight/SkillForge analysis failed (non-critical):', err.message);
          });

          this.runningGoals.delete(goalId);
          return { goalId, status: 'completed', iteration, score: evaluation.scores.overall };
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

        const replannedTasks = await this._replanFailedTasks(goalId, evaluation, userId, provider, model, {
          bestScore,
          bestIteration,
          isImprovement,
          bestTaskSnapshot,
          currentIteration: iteration,
        });

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
            this.runningGoals.delete(goalId);
            return { goalId, status: 'stuck', iteration, reason: 'identical_replan' };
          }
        } else {
          identicalReplanCount = 0;
          lastReplanHash = replanHash;
        }

        // Phase 5: Update world state
        const worldState = await this._updateWorldState(goalId, iteration, evaluation);

        // Phase 6: Git checkpoint
        const gitHash = await this._gitCheckpoint(goalId, iteration, evaluation.scores.overall, userId);

        broadcastToUser(userId, RealtimeEvents.GOAL_ITERATION_CHECKPOINT, {
          goalId,
          iteration,
          gitHash,
        });

        // Record iteration
        await GoalIterationModel.create(
          goalId, iteration, evaluation.scores.overall, false,
          worldState, replannedTasks, gitHash, iterationDuration
        );

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
      this.runningGoals.delete(goalId);
      return { goalId, status: 'max_iterations', iteration: maxIterations };
    } catch (error) {
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
        .map((t) => ({
          id: t.id,
          title: t.title,
          output: t.output
            ? typeof t.output === 'string'
              ? JSON.parse(t.output).content?.substring(0, 200)
              : t.output.content?.substring(0, 200)
            : null,
        })),
      failedTasks: tasks
        .filter((t) => t.status === 'failed')
        .map((t) => ({ id: t.id, title: t.title, error: t.error })),
      pendingTasks: tasks.filter((t) => t.status === 'pending').map((t) => ({ id: t.id, title: t.title })),
      iterationHistory: [
        ...(existingState.iterationHistory || []),
        {
          iteration,
          score: evaluation.scores?.overall || 0,
          passed: evaluation.passed,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    await GoalModel.updateWorldState(goalId, worldState);
    return worldState;
  }

  /**
   * Create a git checkpoint for the current iteration.
   * Writes world state to a file and commits on an isolated branch.
   */
  static async _gitCheckpoint(goalId, iteration, score, userId) {
    try {
      // Determine a safe working directory for git operations
      const cwd = process.cwd();

      // Check if we're in a git repo
      try {
        await execAsync('git rev-parse --git-dir', { cwd });
      } catch {
        console.log(`[AGI Loop] Not in a git repo, skipping checkpoint`);
        return null;
      }

      const branchName = `goal/${goalId}`;
      const worldState = await GoalModel.getWorldState(goalId);

      // Create/switch to goal branch (from current HEAD)
      try {
        await execAsync(`git checkout -b ${branchName}`, { cwd });
      } catch {
        // Branch may already exist, switch to it
        try {
          await execAsync(`git checkout ${branchName}`, { cwd });
        } catch {
          console.log(`[AGI Loop] Could not switch to branch ${branchName}, skipping checkpoint`);
          return null;
        }
      }

      // Write world state file
      const stateDir = path.join(cwd, '.agnt', 'goals');
      await fs.mkdir(stateDir, { recursive: true });
      const stateFile = path.join(stateDir, `${goalId}.json`);
      await fs.writeFile(stateFile, JSON.stringify(worldState, null, 2));

      // Stage and commit
      await execAsync(`git add "${stateFile}"`, { cwd });
      const commitMessage = `checkpoint: goal ${goalId} iteration ${iteration} - score ${Math.round(score)}%`;
      const { stdout } = await execAsync(`git commit -m "${commitMessage}"`, { cwd });

      // Extract commit hash
      const hashMatch = stdout.match(/\[[\w/]+ ([a-f0-9]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;

      // Switch back to previous branch
      await execAsync('git checkout -', { cwd });

      console.log(`[AGI Loop] Git checkpoint: ${commitHash} on branch ${branchName}`);
      return commitHash;
    } catch (error) {
      console.error(`[AGI Loop] Git checkpoint failed (non-fatal):`, error.message);
      // Try to switch back to previous branch
      try {
        await execAsync('git checkout -', { cwd: process.cwd() });
      } catch { /* ignore */ }
      return null;
    }
  }
}

export default TaskOrchestrator;
