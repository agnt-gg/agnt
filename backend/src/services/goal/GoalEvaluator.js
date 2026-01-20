import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalEvaluationModel from '../../models/GoalEvaluationModel.js';
import TaskEvaluationModel from '../../models/TaskEvaluationModel.js';
import StreamEngine from '../../stream/StreamEngine.js';

/**
 * GoalEvaluator - AI-powered evaluation system for goals and tasks
 *
 * Evaluates completed goals against their success criteria using LLM analysis
 * to determine if deliverables were met and quality standards achieved.
 */
class GoalEvaluator {
  /**
   * Evaluate a completed goal against its success criteria
   * @param {string} goalId - The ID of the goal to evaluate
   * @param {string} userId - The user ID for AI service access
   * @param {string} evaluationType - Type of evaluation ('automatic', 'manual', 'hybrid')
   * @param {string} provider - AI provider to use (optional, defaults to user's default)
   * @param {string} model - AI model to use (optional, defaults to user's default)
   * @returns {Promise<Object>} Evaluation results with scores and feedback
   */
  static async evaluateGoal(goalId, userId, evaluationType = 'automatic', provider = null, model = null) {
    try {
      console.log(`[GoalEvaluator] Starting evaluation for goal ${goalId}`);

      // Step 1: Fetch goal and tasks
      const goal = await GoalModel.findOne(goalId);
      if (!goal) {
        throw new Error('Goal not found');
      }

      const tasks = await TaskModel.findByGoalId(goalId);
      console.log(`[GoalEvaluator] Evaluating goal "${goal.title}" with ${tasks.length} tasks`);

      // Step 2: Evaluate each task
      const taskEvaluations = [];
      for (const task of tasks) {
        const taskEval = await this.evaluateTask(task, goal.success_criteria, userId, provider, model);
        taskEvaluations.push(taskEval);
      }

      // Step 3: Calculate overall scores
      const scores = this.calculateOverallScores(taskEvaluations, goal.success_criteria);

      // Step 4: Generate comprehensive feedback
      const feedback = await this.generateEvaluationFeedback(goal, tasks, taskEvaluations, scores, userId, provider, model);

      // Step 5: Determine if goal passed
      const passed = scores.overall >= 70; // 70% threshold for passing

      // Step 6: Store evaluation in database
      const evaluationData = {
        scores,
        taskEvaluations: taskEvaluations.map((te) => ({
          taskId: te.taskId,
          taskTitle: te.taskTitle,
          score: te.score,
          criteriaMet: te.criteriaMet,
        })),
        timestamp: new Date().toISOString(),
      };

      const evaluationId = await GoalEvaluationModel.create(goalId, evaluationType, scores.overall, passed, evaluationData, feedback, 'system');

      // Step 7: Store individual task evaluations
      for (const taskEval of taskEvaluations) {
        await TaskEvaluationModel.create(taskEval.taskId, evaluationId, taskEval.criteriaMet, taskEval.score, taskEval.feedback);
      }

      // Step 8: Update goal status based on evaluation
      const newStatus = passed ? 'validated' : 'needs_review';
      await GoalModel.updateStatus(goalId, newStatus);

      console.log(`[GoalEvaluator] Evaluation complete: ${passed ? 'PASSED' : 'NEEDS REVIEW'} (${scores.overall.toFixed(1)}%)`);

      return {
        evaluationId,
        goalId,
        passed,
        scores,
        feedback,
        taskEvaluations,
        status: newStatus,
      };
    } catch (error) {
      console.error('[GoalEvaluator] Error evaluating goal:', error);
      throw error;
    }
  }

  /**
   * Evaluate a single task against success criteria
   * @param {Object} task - The task to evaluate
   * @param {Object} successCriteria - The goal's success criteria
   * @param {string} userId - User ID for AI service
   * @param {string} provider - AI provider to use
   * @param {string} model - AI model to use
   * @returns {Promise<Object>} Task evaluation results
   */
  static async evaluateTask(task, successCriteria, userId, provider = null, model = null) {
    console.log(`[GoalEvaluator] Evaluating task: ${task.title}`);

    // Parse task output
    const taskOutput = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;

    if (!taskOutput) {
      return {
        taskId: task.id,
        taskTitle: task.title,
        score: 0,
        criteriaMet: { hasOutput: false },
        feedback: 'Task has no output to evaluate',
      };
    }

    // Use AI to evaluate task output against criteria
    const evaluation = await this.aiEvaluateTaskOutput(task, taskOutput, successCriteria, userId, provider, model);

    return {
      taskId: task.id,
      taskTitle: task.title,
      score: evaluation.score,
      criteriaMet: evaluation.criteriaMet,
      feedback: evaluation.feedback,
    };
  }

  /**
   * Use AI to evaluate task output against success criteria
   * @param {Object} task - The task being evaluated
   * @param {Object} taskOutput - The task's output data
   * @param {Object} successCriteria - Success criteria from goal
   * @param {string} userId - User ID for AI service
   * @param {string} provider - AI provider to use
   * @param {string} model - AI model to use
   * @returns {Promise<Object>} AI evaluation results
   */
  static async aiEvaluateTaskOutput(task, taskOutput, successCriteria, userId, provider = null, model = null) {
    const streamEngine = new StreamEngine(userId);

    const prompt = `You are an expert evaluator assessing whether a task output meets specified success criteria.

TASK INFORMATION:
Title: ${task.title}
Description: ${task.description}

TASK OUTPUT:
${JSON.stringify(taskOutput, null, 2)}

SUCCESS CRITERIA:
Deliverables Expected: ${JSON.stringify(successCriteria.deliverables || [], null, 2)}
Quality Checks: ${JSON.stringify(successCriteria.qualityChecks || [], null, 2)}

EVALUATION INSTRUCTIONS:
1. Analyze if the task output contains or demonstrates the expected deliverables
2. Check if the output meets the quality standards specified
3. Provide a score from 0-100 based on how well criteria are met
4. List which specific criteria were met or not met
5. Provide constructive feedback

Respond with ONLY a valid JSON object (no markdown, no extra text):
{
  "score": 85,
  "criteriaMet": {
    "deliverable1": true,
    "deliverable2": false,
    "qualityCheck1": true
  },
  "feedback": "Detailed feedback explaining the evaluation",
  "strengths": ["What was done well"],
  "improvements": ["What could be improved"]
}`;

    try {
      // ALWAYS use user's provider/model settings
      let evalProvider = provider;
      let evalModel = model;

      if (!evalProvider || !evalModel) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);

        if (!evalProvider) {
          evalProvider = userSettings?.selectedProvider;
        }
        if (!evalModel) {
          evalModel = userSettings?.selectedModel;
        }
      }

      if (!evalProvider || !evalModel) {
        throw new Error('No provider/model configured for evaluation');
      }

      const result = await streamEngine.generateCompletion(prompt, evalProvider, evalModel);

      // Clean and parse response - remove thinking tags and markdown
      let cleanedResult = result;
      if (typeof result === 'string') {
        cleanedResult = result
          .replace(/<think>[\s\S]*?<\/think>/gi, '') // Remove <think></think> tags
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
      }

      const evaluation = JSON.parse(cleanedResult);

      // Validate evaluation structure
      if (typeof evaluation.score !== 'number' || !evaluation.criteriaMet || !evaluation.feedback) {
        throw new Error('Invalid evaluation structure');
      }

      return evaluation;
    } catch (error) {
      console.error('[GoalEvaluator] AI evaluation failed:', error);

      // Fallback to basic evaluation
      return {
        score: 50,
        criteriaMet: { evaluated: false, error: true },
        feedback: `Unable to perform AI evaluation: ${error.message}. Task appears to have output but requires manual review.`,
        strengths: ['Task completed with output'],
        improvements: ['Manual review recommended'],
      };
    }
  }

  /**
   * Calculate overall scores from task evaluations
   * @param {Array} taskEvaluations - Array of task evaluation results
   * @param {Object} successCriteria - Goal success criteria
   * @returns {Object} Calculated scores
   */
  static calculateOverallScores(taskEvaluations, successCriteria) {
    if (taskEvaluations.length === 0) {
      return {
        overall: 0,
        completeness: 0,
        quality: 0,
        taskAverage: 0,
      };
    }

    // Calculate average task score
    const taskAverage = taskEvaluations.reduce((sum, te) => sum + te.score, 0) / taskEvaluations.length;

    // Calculate completeness (all tasks have output)
    const tasksWithOutput = taskEvaluations.filter((te) => te.criteriaMet.hasOutput !== false).length;
    const completeness = (tasksWithOutput / taskEvaluations.length) * 100;

    // Calculate quality (average of task scores)
    const quality = taskAverage;

    // Overall score is weighted average
    const overall = completeness * 0.3 + quality * 0.7;

    return {
      overall: Math.round(overall * 10) / 10,
      completeness: Math.round(completeness * 10) / 10,
      quality: Math.round(quality * 10) / 10,
      taskAverage: Math.round(taskAverage * 10) / 10,
    };
  }

  /**
   * Generate comprehensive evaluation feedback using AI
   * @param {Object} goal - The goal being evaluated
   * @param {Array} tasks - All tasks in the goal
   * @param {Array} taskEvaluations - Task evaluation results
   * @param {Object} scores - Calculated scores
   * @param {string} userId - User ID for AI service
   * @param {string} provider - AI provider to use
   * @param {string} model - AI model to use
   * @returns {Promise<string>} Generated feedback
   */
  static async generateEvaluationFeedback(goal, tasks, taskEvaluations, scores, userId, provider = null, model = null) {
    const streamEngine = new StreamEngine(userId);

    const prompt = `Generate a comprehensive evaluation report for a completed goal.

GOAL: ${goal.title}
DESCRIPTION: ${goal.description}

OVERALL SCORES:
- Overall: ${scores.overall}%
- Completeness: ${scores.completeness}%
- Quality: ${scores.quality}%

TASK EVALUATIONS:
${taskEvaluations
  .map(
    (te, i) => `
Task ${i + 1}: ${te.taskTitle}
Score: ${te.score}%
Feedback: ${te.feedback}
`
  )
  .join('\n')}

SUCCESS CRITERIA:
${JSON.stringify(goal.success_criteria, null, 2)}

Generate a concise evaluation report (2-3 paragraphs) that:
1. Summarizes overall performance
2. Highlights what was accomplished well
3. Identifies areas for improvement
4. Provides actionable recommendations

Keep it professional but encouraging. Focus on constructive feedback.`;

    try {
      // ALWAYS use user's provider/model settings
      let evalProvider = provider;
      let evalModel = model;

      if (!evalProvider || !evalModel) {
        const UserModel = (await import('../../models/UserModel.js')).default;
        const userSettings = await UserModel.getUserSettings(userId);

        if (!evalProvider) {
          evalProvider = userSettings?.selectedProvider;
        }
        if (!evalModel) {
          evalModel = userSettings?.selectedModel;
        }
      }

      if (!evalProvider || !evalModel) {
        throw new Error('No provider/model configured for evaluation feedback');
      }

      const feedback = await streamEngine.generateCompletion(prompt, evalProvider, evalModel);
      return feedback.trim();
    } catch (error) {
      console.error('[GoalEvaluator] Failed to generate feedback:', error);

      // Fallback feedback
      const status = scores.overall >= 70 ? 'successfully completed' : 'completed with areas for improvement';
      return `Goal "${goal.title}" was ${status} with an overall score of ${scores.overall}%. ${taskEvaluations.length} tasks were evaluated. ${
        scores.overall >= 70
          ? 'The goal met its success criteria and deliverables were achieved.'
          : 'Some success criteria were not fully met. Review individual task feedback for details.'
      }`;
    }
  }

  /**
   * Get evaluation report for a goal
   * @param {string} goalId - Goal ID
   * @returns {Promise<Object>} Evaluation report
   */
  static async getEvaluationReport(goalId) {
    const evaluation = await GoalEvaluationModel.findLatestByGoalId(goalId);
    if (!evaluation) {
      return null;
    }

    const taskEvaluations = await TaskEvaluationModel.findByGoalEvaluationId(evaluation.id);

    return {
      ...evaluation,
      taskEvaluations,
    };
  }
}

export default GoalEvaluator;
