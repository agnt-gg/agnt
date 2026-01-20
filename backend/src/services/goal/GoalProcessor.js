import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import StreamEngine from '../../stream/StreamEngine.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GoalProcessor {
  /**
   * Processes a user goal by analyzing it, creating a goal record, and breaking it down into tasks.
   * @param {string} goalText - The text description of the goal to process.
   * @param {string|number} userId - The ID of the user who owns the goal.
   * @returns {Promise<Object>} An object containing the goal ID, title, description, estimated duration, tasks array, and success criteria.
   */
  static async processGoal(goalText, userId) {
    try {
      console.log(`[GoalProcessor] Processing goal for user ${userId}: ${goalText.substring(0, 100)}...`);

      // Step 1: Analyze the goal using AI
      console.log(`[GoalProcessor] Step 1: Starting AI analysis of goal`);
      const analysis = await this._analyzeGoal(goalText, userId);
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
  static async _analyzeGoal(goalText, userId) {
    const streamEngine = new StreamEngine(userId);

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

      // Use OpenAI with a reliable model for JSON generation
      const analysisResult = await streamEngine.generateCompletion(prompt, 'openai', 'gpt-4o-mini');
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
      const analysis = JSON.parse(cleanedResult);

      // Validate the analysis structure
      if (!analysis.title || !analysis.taskBreakdown || !Array.isArray(analysis.taskBreakdown)) {
        throw new Error('Invalid analysis structure');
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
      console.error('Error analyzing goal with AI:', error);
      console.log('Falling back to basic analysis...');

      // Fallback to basic analysis
      return this._createFallbackAnalysis(goalText, availableToolTypes);
    }
  }
  /**
   * Creates a fallback analysis when AI analysis fails, providing a basic task breakdown.
   * @param {string} goalText - The text description of the goal.
   * @param {string[]} availableToolTypes - Array of available tool types for task assignment.
   * @returns {Object} An analysis object with basic task breakdown.
   * @private
   */
  static _createFallbackAnalysis(goalText, availableToolTypes = []) {
    const title = goalText.length > 60 ? goalText.substring(0, 57) + '...' : goalText;

    // Default to manual trigger if no tool types available
    const defaultTools = availableToolTypes.length > 0 ? ['manual-trigger'] : ['general'];

    // For simple goals, just create one task
    const isSimpleGoal = goalText.length < 100 && !goalText.includes(' and ') && !goalText.includes(',');

    if (isSimpleGoal) {
      return {
        title: title,
        priority: 'medium',
        estimatedDuration: 30, // Simple goals should be quick
        successCriteria: {
          deliverables: ['Complete the requested task'],
          qualityChecks: ['Output meets requirements'],
        },
        taskBreakdown: [
          {
            title: title.length > 50 ? goalText.substring(0, 47) + '...' : title,
            description: goalText,
            requiredTools: defaultTools,
            dependencies: [],
            estimatedDuration: 30,
            orderIndex: 0,
          },
        ],
      };
    }

    // For complex goals, break into multiple tasks
    return {
      title: title,
      priority: 'medium',
      estimatedDuration: 120, // 2 hours default
      successCriteria: {
        deliverables: ['Complete the requested task'],
        qualityChecks: ['Output meets requirements'],
      },
      taskBreakdown: [
        {
          title: 'Analyze Requirements',
          description: `Understand and analyze what needs to be done for: ${goalText}`,
          requiredTools: defaultTools,
          dependencies: [],
          estimatedDuration: 30,
          orderIndex: 0,
        },
        {
          title: 'Execute Main Task',
          description: goalText,
          requiredTools: defaultTools,
          dependencies: [],
          estimatedDuration: 60,
          orderIndex: 1,
        },
        {
          title: 'Review and Finalize',
          description: 'Review the completed work and make any necessary adjustments',
          requiredTools: defaultTools,
          dependencies: [],
          estimatedDuration: 30,
          orderIndex: 2,
        },
      ],
    };
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
