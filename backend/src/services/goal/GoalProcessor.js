import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from '../orchestrator/llmAdapters.js';
import { getProviderConfig } from '../ai/providerConfigs.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * A goal could not be planned. Typed so the route can answer with an
 * actionable status instead of a generic 500, and so no goal record is
 * written: planning runs before GoalModel.create.
 *   PLANNER_NOT_CONFIGURED   no provider/model selected (400, not retryable)
 *   PLANNER_NOT_CONNECTED    the provider has no usable credentials (400, not retryable)
 *   PLANNER_UNAVAILABLE      the model could not be reached or the client failed (502)
 *   PLANNER_INVALID_RESPONSE the reply was not a JSON plan (502)
 *   PLANNER_INVALID_PLAN     the plan failed validation (502)
 */
const NOT_RETRYABLE = ['PLANNER_NOT_CONFIGURED', 'PLANNER_NOT_CONNECTED'];
export class GoalPlanningError extends Error {
  constructor(code, message, { provider = null, model = null, reason = null, retryable = !NOT_RETRYABLE.includes(code), cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GoalPlanningError';
    this.code = code;
    this.status = NOT_RETRYABLE.includes(code) ? 400 : 502;
    this.provider = provider;
    this.model = model;
    this.reason = reason;
    this.retryable = retryable;
  }
}

// Client construction failures that mean "connect this provider first".
const MISSING_CREDENTIALS = /missing (access token|api key|credentials)|no api key|not (connected|authenticated)|api key (is )?(missing|not (set|configured))/i;

async function plannerName(provider, config, userId) {
  if (config?.name) return config.name;
  try {
    const { default: CustomOpenAIProviderService } = await import('../ai/CustomOpenAIProviderService.js');
    const custom = await CustomOpenAIProviderService.getProviderById(provider, userId);
    if (custom?.provider_name) return custom.provider_name;
  } catch { /* the id is still a usable label */ }
  return provider;
}

class GoalProcessor {
  /**
   * Processes a user goal by analyzing it, creating a goal record, and breaking it down into tasks.
   * @param {string} goalText - The text description of the goal to process.
   * @param {string|number} userId - The ID of the user who owns the goal.
   * @returns {Promise<Object>} An object containing the goal ID, title, description, estimated duration, tasks array, and success criteria.
   */
  static async processGoal(goalText, userId, provider = null, model = null) {
    try {
      console.log(`[GoalProcessor] Processing goal for user ${userId}: ${goalText.substring(0, 100)}...`);

      // Step 1: Analyze the goal using AI
      console.log(`[GoalProcessor] Step 1: Starting AI analysis of goal`);
      const analysis = await this._analyzeGoal(goalText, userId, provider, model);
      console.log(`[GoalProcessor] Step 1 Complete: Goal analysis completed`);
      console.log(`[GoalProcessor] Analysis result: ${analysis.title} (${analysis.priority} priority)`);
      console.log(`[GoalProcessor] Task breakdown: ${analysis.taskBreakdown.length} tasks generated`);

      // Step 2: Create goal record
      console.log(`[GoalProcessor] Step 2: Creating goal record in database`);
      const goalId = await GoalModel.create(analysis.title, goalText, userId, analysis.priority, analysis.successCriteria);
      console.log(`[GoalProcessor] Step 2 Complete: Created goal with ID: ${goalId}`);

      // Step 3: Create task breakdown
      console.log(`[GoalProcessor] Step 3: Creating ${analysis.taskBreakdown.length} tasks`);
      const tasks = await this._createTasks(goalId, analysis.taskBreakdown);
      console.log(`[GoalProcessor] Step 3 Complete: Created ${tasks.length} tasks for goal ${goalId}`);

      // Log task details
      tasks.forEach((task, index) => {
        console.log(`[GoalProcessor] Task ${index + 1}: ${task.title}`);
        console.log(`[GoalProcessor] - Description: ${task.description}`);
        // Handle both camelCase and snake_case versions
        const tools = task.required_tools || task.requiredTools || ['general'];
        const toolsArray = Array.isArray(tools) ? tools : [tools];
        console.log(`[GoalProcessor] - Required tools: ${toolsArray.join(', ')}`);
      });

      // Step 4: Return the plan
      console.log(`[GoalProcessor] Goal processing complete - returning plan`);
      return {
        goalId,
        title: analysis.title,
        description: goalText,
        estimatedDuration: analysis.estimatedDuration,
        tasks: tasks,
        successCriteria: analysis.successCriteria,
      };
    } catch (error) {
      console.error('[GoalProcessor] Error processing goal:', error);
      throw error;
    }
  }

  /**
   * Plans tasks for a goal that already exists but has no tasks
   * (e.g. proposal goals inserted directly into the goals table by an agent,
   * bypassing processGoal). Reuses the same AI analysis + task creation
   * pipeline as processGoal, but against the existing goal record.
   * @param {string} goalId - The ID of the existing goal.
   * @param {string|number} userId - The ID of the user who owns the goal.
   * @param {string|null} provider - Optional LLM provider override.
   * @param {string|null} model - Optional LLM model override.
   * @returns {Promise<Array>} The tasks for the goal (existing or newly created).
   */
  static async planTasksForExistingGoal(goalId, userId, provider = null, model = null) {
    const goal = await GoalModel.findOne(goalId);
    if (!goal) {
      throw new Error(`Goal ${goalId} not found`);
    }

    const existingTasks = await TaskModel.findByGoalId(goalId);
    if (existingTasks.length > 0) {
      console.log(`[GoalProcessor] Goal ${goalId} already has ${existingTasks.length} tasks — skipping bootstrap`);
      return existingTasks;
    }

    const goalText = goal.description ? `${goal.title}: ${goal.description}` : goal.title;
    console.log(`[GoalProcessor] Bootstrapping task plan for existing goal ${goalId}: ${goalText.substring(0, 100)}...`);

    // _analyzeGoal throws a GoalPlanningError when no usable plan comes back,
    // so no placeholder task is ever created for this goal.
    const analysis = await this._analyzeGoal(goalText, userId, provider, model);
    const tasks = await this._createTasks(goalId, analysis.taskBreakdown);

    if (tasks.length === 0) {
      throw new Error(`Task planning produced 0 tasks for goal ${goalId}`);
    }

    console.log(`[GoalProcessor] Bootstrap complete: created ${tasks.length} tasks for goal ${goalId}`);
    return tasks;
  }

  /**
   * Validates whether a goal is completed by checking if all associated tasks are completed.
   * Updates the goal status to 'completed' if all tasks are done.
   * @param {string|number} goalId - The ID of the goal to validate.
   * @returns {Promise<boolean>} True if the goal is completed, false otherwise.
   */
  static async validateGoalCompletion(goalId) {
    const goal = await GoalModel.findOne(goalId);
    const tasks = await TaskModel.findByGoalId(goalId);

    if (!goal || !tasks.length) {
      return false;
    }

    const completedTasks = tasks.filter((t) => t.status === 'completed');
    const isComplete = completedTasks.length === tasks.length;

    if (isComplete) {
      await GoalModel.updateStatus(goalId, 'completed', new Date().toISOString());
    }

    return isComplete;
  }
  /**
   * Loads the tool library from the JSON file.
   * @returns {Promise<Object>} The tool library object with categories and tools.
   * @private
   */
  static async _loadToolLibrary() {
    try {
      // Load the tool library from the tools directory
      const toolLibraryPath = path.resolve(__dirname, '../../tools/toolLibrary.json');
      console.log(`[GoalProcessor] Loading tool library from: ${toolLibraryPath}`);

      const toolLibraryContent = await fs.readFile(toolLibraryPath, 'utf-8');
      const toolLibrary = JSON.parse(toolLibraryContent);

      console.log(`[GoalProcessor] Successfully loaded tool library with ${Object.keys(toolLibrary).length} categories`);
      return toolLibrary;
    } catch (error) {
      console.error('[GoalProcessor] Error loading tool library:', error);
      console.log('[GoalProcessor] Using fallback tool types');

      // Fallback to basic tool types if the file can't be loaded
      return {
        triggers: [{ type: 'manual-trigger' }],
        actions: [{ type: 'generate-with-ai-llm' }, { type: 'send-email' }],
        utilities: [{ type: 'content-output' }],
      };
    }
  }
  /**
   * Extracts all tool types from the tool library object.
   * @param {Object} toolLibrary - The tool library object containing categories with tools.
   * @returns {string[]} Array of tool type strings.
   * @private
   */
  static _extractToolTypes(toolLibrary) {
    const toolTypes = [];

    // Extract tool types from each category
    Object.values(toolLibrary).forEach((category) => {
      if (Array.isArray(category)) {
        category.forEach((tool) => {
          if (tool.type) {
            // Convert hyphens to underscores to match tool schema naming convention
            // Tool library uses 'gmail-api' but tool schemas use 'gmail_api'
            toolTypes.push(tool.type.replace(/-/g, '_'));
          }
        });
      }
    });

    return toolTypes;
  }
  /**
   * Analyzes a goal using AI to break it down into tasks and determine priority/success criteria.
   * @param {string} goalText - The text description of the goal to analyze.
   * @param {string|number} userId - The ID of the user for whom the goal is being analyzed.
   * @returns {Promise<Object>} An analysis object containing title, priority, estimatedDuration, successCriteria, and taskBreakdown array.
   * @private
   */
  static async _analyzeGoal(goalText, userId, provider = null, model = null) {
    // Load the actual tool library
    const toolLibrary = await this._loadToolLibrary();
    const availableToolTypes = this._extractToolTypes(toolLibrary);

    const prompt = `
Analyze this goal and break it down into actionable tasks:

GOAL: "${goalText}"

AVAILABLE TOOL TYPES: ${availableToolTypes.join(', ')}

Respond with ONLY a valid JSON object (no markdown, no extra text) containing:
{
  "title": "Short descriptive title (max 60 characters)",
  "priority": "low|medium|high|urgent",
  "estimatedDuration": 120,
  "successCriteria": {
    "deliverables": ["list", "of", "expected", "outputs"],
    "qualityChecks": ["validation", "criteria"]
  },
  "taskBreakdown": [
    {
      "title": "Task name",
      "description": "What needs to be done",
      "requiredTools": ["tool-type-from-available-list"],
      "dependencies": [],
      "estimatedDuration": 30,
      "orderIndex": 0
    }
  ]
}

Rules:
- Break down the goal into the MINIMUM number of tasks needed to complete it effectively
- Simple goals may only need 1 task - that's perfectly fine
- Complex goals may need multiple tasks - use your judgment
- Each task should be specific and measurable
- Keep task titles under 50 characters
- estimatedDuration is in minutes
- requiredTools should ONLY use tool types from the AVAILABLE TOOL TYPES list above
- Return ONLY the JSON object, no other text
`;

    try {
      console.log('Sending goal analysis request to AI...');
      console.log(`[GoalProcessor] Available tool types: ${availableToolTypes.join(', ')}`);

      // Use user's configured provider/model, fall back to user settings
      let analysisProvider = provider;
      let analysisModel = model;
      if (!analysisProvider || !analysisModel) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);
        if (!analysisProvider) analysisProvider = userSettings?.selectedProvider;
        if (!analysisModel) analysisModel = userSettings?.selectedModel;
      }
      if (!analysisProvider || !analysisModel) {
        throw new GoalPlanningError('PLANNER_NOT_CONFIGURED', 'No provider/model configured. Please set your default provider and model in settings.');
      }
      const _cfg = getProviderConfig(analysisProvider);
      const normalizedProvider = _cfg ? _cfg.key : analysisProvider.toLowerCase();
      const plannerLabel = `${await plannerName(analysisProvider, _cfg, userId)} (${analysisModel})`;
      const planner = { provider: normalizedProvider, model: analysisModel };
      console.log(`[GoalProcessor] Using provider: ${normalizedProvider}, model: ${analysisModel}`);
      let adapterResult;
      try {
        const client = await createLlmClient(normalizedProvider, userId);
        const adapter = await createLlmAdapter(normalizedProvider, client, analysisModel);
        adapterResult = await adapter.call([
          { role: 'system', content: 'You are a goal analysis assistant. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ], []);
      } catch (error) {
        if (MISSING_CREDENTIALS.test(error.message || '')) {
          throw new GoalPlanningError('PLANNER_NOT_CONNECTED', `${plannerLabel} is not connected (${error.message}). Connect it in Settings, or choose another model.`, { ...planner, reason: error.message, cause: error });
        }
        throw new GoalPlanningError('PLANNER_UNAVAILABLE', `${plannerLabel} could not be reached: ${error.message}`, { ...planner, reason: error.message, cause: error });
      }
      // Transports return an exhausted-retry error as assistant text flagged
      // recoveredFromError; that is a failed call, not a plan to parse.
      if (adapterResult?.recoveredFromError) {
        const reason = adapterResult.recoveredError || 'Provider error';
        throw new GoalPlanningError('PLANNER_UNAVAILABLE', `${plannerLabel} could not be reached: ${reason}`, { ...planner, reason });
      }

      let analysisResult = '';
      if (adapterResult?.responseMessage?.content) {
        if (typeof adapterResult.responseMessage.content === 'string') {
          analysisResult = adapterResult.responseMessage.content;
        } else if (Array.isArray(adapterResult.responseMessage.content)) {
          analysisResult = adapterResult.responseMessage.content.map(block => block.text || '').join('');
        }
      }
      console.log('Raw AI response:', analysisResult);

      // Clean up the response (remove any markdown formatting)
      let cleanedResult = analysisResult;
      if (typeof analysisResult === 'string') {
        cleanedResult = analysisResult
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }

      console.log('Cleaned AI response:', cleanedResult);

      // Parse the JSON response
      let analysis;
      try {
        analysis = JSON.parse(cleanedResult);
      } catch (error) {
        throw new GoalPlanningError('PLANNER_INVALID_RESPONSE', `${plannerLabel} did not return a JSON plan. Try again, or choose a model that follows JSON instructions.`, { ...planner, reason: error.message, cause: error });
      }

      // Validate the analysis structure; an empty plan would create a goal
      // with nothing to execute.
      if (!analysis || !analysis.title || !Array.isArray(analysis.taskBreakdown) || analysis.taskBreakdown.length === 0) {
        const reason = 'Invalid analysis structure';
        throw new GoalPlanningError('PLANNER_INVALID_PLAN', `${plannerLabel} returned an unusable plan: ${reason}`, { ...planner, reason });
      }

      // Ensure required fields have defaults
      analysis.priority = analysis.priority || 'medium';
      analysis.estimatedDuration = analysis.estimatedDuration || 120;
      analysis.successCriteria = analysis.successCriteria || {
        deliverables: ['Complete the requested task'],
        qualityChecks: ['Output meets requirements'],
      };

      // Validate each task and ensure tool types are valid
      analysis.taskBreakdown = analysis.taskBreakdown.map((task, index) => ({
        title: task.title || `Task ${index + 1}`,
        description: task.description || goalText,
        requiredTools: Array.isArray(task.requiredTools)
          ? task.requiredTools.filter((tool) => availableToolTypes.includes(tool))
          : ['manual-trigger'], // Default to manual trigger if no valid tools
        dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
        estimatedDuration: task.estimatedDuration || 30,
        orderIndex: task.orderIndex !== undefined ? task.orderIndex : index,
      }));

      console.log('Validated analysis:', analysis);
      return analysis;
    } catch (error) {
      // No fabricated fallback plan: a goal the model did not plan would carry
      // a placeholder task and hide why planning failed.
      console.error('Error analyzing goal with AI:', error);
      throw error;
    }
  }
  /**
   * Creates task records in the database for each task in the breakdown.
   * @param {string|number} goalId - The ID of the goal to which tasks belong.
   * @param {Object[]} taskBreakdown - Array of task objects containing title, description, requiredTools, etc.
   * @returns {Promise<Object[]>} Array of created task objects with IDs and metadata.
   * @private
   */
  static async _createTasks(goalId, taskBreakdown) {
    const createdTasks = [];

    console.log(`Creating ${taskBreakdown.length} tasks for goal ${goalId}`);

    for (let i = 0; i < taskBreakdown.length; i++) {
      const task = taskBreakdown[i];

      try {
        const taskId = await TaskModel.create(
          goalId,
          task.title,
          task.description,
          task.requiredTools || ['general'],
          task.dependencies || [],
          task.orderIndex !== undefined ? task.orderIndex : i
        );

        console.log(`Created task ${taskId}: ${task.title}`);

        createdTasks.push({
          id: taskId,
          goal_id: goalId,
          title: task.title,
          description: task.description,
          required_tools: task.requiredTools || ['general'],
          dependencies: task.dependencies || [],
          order_index: task.orderIndex !== undefined ? task.orderIndex : i,
          estimated_duration: task.estimatedDuration || 30,
          status: 'pending',
        });
      } catch (error) {
        console.error(`Error creating task ${i}:`, error);
        // Continue with other tasks even if one fails
      }
    }

    console.log(`Successfully created ${createdTasks.length} tasks`);
    return createdTasks;
  }
}

export default GoalProcessor;
