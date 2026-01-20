import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import AgentTaskMatcher from './AgentTaskMatcher.js';
import LlmExecutionService from '../ai/LlmExecutionService.js';
import { getAvailableToolSchemas } from '../orchestrator/tools.js';
import GoalEvaluator from './GoalEvaluator.js';

class TaskOrchestrator {
  static runningGoals = new Map(); // Track active goals

  static async executeGoal(goalId, userId) {
    try {
      // Mark goal as executing
      await GoalModel.updateStatus(goalId, 'executing');

      // Start monitoring this goal with real workflow execution
      this.runningGoals.set(goalId, {
        userId,
        startTime: Date.now(),
        status: 'executing',
      });

      // Start real task execution with workflows
      this.executeGoalTasks(goalId, userId);

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
  static async executeGoalTasks(goalId, userId) {
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

        // Check if task dependencies are met
        const canExecute = await TaskModel.canExecuteTask(task.id);
        if (!canExecute) {
          console.log(`Task ${task.id} dependencies not met, skipping for now`);
          continue;
        }

        try {
          // Execute task with data from previous task
          const taskOutputs = await this.executeTask(task, userId, previousTaskOutputs);

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
  static async executeTask(task, userId, previousTaskOutputs = null) {
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
      const result = await this.executeTaskViaAgentChat(agent, taskMessage, userId);
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
  static async executeTaskViaAgentChat(agent, taskMessage, userId) {
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

      // ALWAYS use user's provider/model settings - NO FALLBACKS
      let provider = null;
      let model = null;

      // First check if agent has valid provider/model
      if (agent.provider && agent.provider.trim() !== '') {
        provider = agent.provider;
      }
      if (agent.model && agent.model.trim() !== '') {
        model = agent.model;
      }

      // If agent doesn't have provider/model, ALWAYS use user's settings
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

    await GoalModel.updateStatus(goalId, 'completed', new Date().toISOString());
    console.log(`Goal ${goalId} completed successfully`);

    // Trigger automatic evaluation
    if (userId) {
      console.log(`[TaskOrchestrator] Starting automatic evaluation for goal ${goalId}`);
      try {
        const evaluation = await GoalEvaluator.evaluateGoal(goalId, userId, 'automatic');
        console.log(`[TaskOrchestrator] Evaluation complete: ${evaluation.passed ? 'PASSED' : 'NEEDS REVIEW'} (${evaluation.scores.overall}%)`);
      } catch (error) {
        console.error(`[TaskOrchestrator] Evaluation failed for goal ${goalId}:`, error);
        // Don't fail the goal completion if evaluation fails
      }
    }

    this.runningGoals.delete(goalId);
  }
  static async handleGoalError(goalId, error) {
    await GoalModel.updateStatus(goalId, 'failed');
    this.runningGoals.delete(goalId);
    console.error(`Goal ${goalId} failed:`, error);
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
  static async resumeGoal(goalId) {
    const goal = await GoalModel.findOne(goalId);
    if (goal) {
      await GoalModel.updateStatus(goalId, 'executing');
      this.executeGoalTasks(goalId, goal.user_id); // Changed from startExecutionLoop
    }
  }
  static async stopGoal(goalId) {
    await GoalModel.updateStatus(goalId, 'stopped');
    this.runningGoals.delete(goalId);
  }
  static async storeTaskResults(taskId, results) {
    // For now, just log the results. Later you might want to store these in a task_results table
    console.log(`Storing results for task ${taskId}:`, JSON.stringify(results, null, 2));

    // You could add a method to TaskModel to store results
    // await TaskModel.storeResults(taskId, results);

    // Or store in a separate results table
    // await TaskResultsModel.create(taskId, results);
  }
}

export default TaskOrchestrator;
