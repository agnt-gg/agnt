import { commitGoalEvaluation, staleEvaluation } from '../../models/GoalEvaluationCommit.js';
import { taskFailureReason, assessGoalCompletion } from './taskOutcome.js';
import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalEvaluationModel from '../../models/GoalEvaluationModel.js';
import TaskEvaluationModel from '../../models/TaskEvaluationModel.js';
import { checklistOf, checklistPrompt, parseChecklistVerdict } from './goalChecklist.js';
import { createSession as createUnfirehoseSession, isEnabled as isUnfirehoseEnabled } from '../unfirehose/UnfirehoseLogger.js';
import { getModelCost } from '../ai/providerConfigs.js';

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
  static async evaluateGoal(goalId, userId, evaluationType = 'automatic', provider = null, model = null, { assertCurrent } = {}) {
    try {
      assertCurrent?.();
      console.log(`[GoalEvaluator] Starting evaluation for goal ${goalId}`);

      // Step 1: Fetch goal and tasks
      const goal = await GoalModel.findOne(goalId);
      if (!goal) {
        throw new Error('Goal not found');
      }

      if (goal.user_id !== userId || goal.deleted_at || ['paused','stopped'].includes(goal.status)) throw staleEvaluation();
      const tasks = await TaskModel.findByGoalId(goalId);
      console.log(`[GoalEvaluator] Evaluating goal "${goal.title}" with ${tasks.length} tasks`);

      // Token usage accumulator across all LLM calls. Each call is ALSO
      // priced at the model that actually served it (ModelRouter may fail
      // over), so the legacy estimated_cost column stays honest.
      const tokenAccumulator = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
      function accumulateUsage(usage, served = null) {
        if (!usage) return;
        const input = usage.prompt_tokens || usage.input_tokens || usage.inputTokens || 0;
        const output = usage.completion_tokens || usage.output_tokens || usage.outputTokens || 0;
        tokenAccumulator.inputTokens += input;
        tokenAccumulator.outputTokens += output;
        tokenAccumulator.totalTokens += input + output;
        if (served?.provider && served?.model) {
          tokenAccumulator.estimatedCost += getModelCost(served.provider, served.model, input, output)?.totalCost || 0;
        }
      }

      // Step 2: Evaluate each task
      const taskEvaluations = [];
      for (const task of tasks) {
        const taskEval = await this.evaluateTask(task, goal.success_criteria, userId, provider, model, accumulateUsage);
        taskEvaluations.push(taskEval);
      }

      // Step 3: Calculate overall scores
      const scores = this.calculateOverallScores(taskEvaluations, goal.success_criteria);

      // Step 4: Generate comprehensive feedback
      const feedback = await this.generateEvaluationFeedback(goal, tasks, taskEvaluations, scores, userId, provider, model, accumulateUsage);

      // Step 4b: Check the acceptance checklist item by item, so the reviewer
      // signs off against a pre-checked list instead of reading raw output.
      const checklist = await this.evaluateChecklist(goal, tasks, userId, provider, model, accumulateUsage);

      // Step 5: Determine if goal passed
      const completionDecision = assessGoalCompletion({passed:scores.overall >= 70,scores,taskEvaluations,checklist},tasks);
      const passed = completionDecision.passed;

      // Ledger rows are written per call by ModelRouter (origin goal_eval,
      // originId = this goal), each attributed to the model that SERVED it.
      // The aggregate written here used to name the account default even when
      // a call failed over — a wrong attribution once calls can move. This
      // block now only fills the legacy goal_evaluations.estimated_cost column.
      let tokenUsage = null;
      if (tokenAccumulator.totalTokens > 0) {
        tokenUsage = {
          inputTokens: tokenAccumulator.inputTokens,
          outputTokens: tokenAccumulator.outputTokens,
          totalTokens: tokenAccumulator.totalTokens,
          estimatedCost: tokenAccumulator.estimatedCost,
        };
        console.log(`[GoalEvaluator] Token Usage: ${tokenAccumulator.inputTokens} in / ${tokenAccumulator.outputTokens} out = ${tokenAccumulator.totalTokens} total, est. cost: $${(tokenUsage.estimatedCost || 0).toFixed(6)}`);
      }

      // Step 6: Store evaluation in database
      const evaluationData = {
        scores,
        completionDecision,
        taskEvaluations: taskEvaluations.map((te) => ({
          taskId: te.taskId,
          taskTitle: te.taskTitle,
          score: te.score,
          criteriaMet: te.criteriaMet,
        })),
        checklist,
        timestamp: new Date().toISOString(),
      };

      const {evaluationId,status:newStatus} = await commitGoalEvaluation({goal,userId,evaluationType,scores,passed,evaluationData,feedback,tokenUsage,taskEvaluations,assertCurrent});

      console.log(`[GoalEvaluator] Evaluation complete: ${passed ? 'PASSED' : 'NEEDS REVIEW'} (${scores.overall.toFixed(1)}%)`);

      // Log to unfirehose/1.0
      if (isUnfirehoseEnabled()) {
        try {
          const ufSession = createUnfirehoseSession({
            conversationId: `eval-${goalId}-${evaluationId}`,
            chatType: 'goal-evaluation',
            firstPrompt: `Evaluate goal: ${goal.title}`,
          });
          // Log overall eval
          ufSession.logGoalEvaluation(goalId, scores.overall, feedback);
          // Log per-task evals as training events
          for (const [i, te] of taskEvaluations.entries()) {
            ufSession.logTrainingEvent({
              type: 'run.eval',
              run_id: `goal-${goalId}`,
              step: i,
              eval: te.taskTitle || `task-${te.taskId}`,
              score: te.score / 100,
              ts: new Date().toISOString(),
            });
          }
          ufSession.close({
            summary: `${passed ? 'PASSED' : 'NEEDS REVIEW'} (${scores.overall.toFixed(1)}%)`,
            totalUsage: tokenUsage || undefined,
          });
        } catch (ufErr) {
          console.error('[unfirehose] Goal evaluation logging failed:', ufErr.message);
        }
      }

      return {
        evaluationId,
        completionDecision,
        goalId,
        passed,
        scores,
        feedback,
        taskEvaluations,
        checklist,
        status: newStatus,
        tokenUsage: tokenUsage || undefined,
      };
    } catch (error) {
      console.error('[GoalEvaluator] Error evaluating goal:', error);
      throw error;
    }
  }

  /**
   * Check each acceptance-checklist item against the work. Never throws: a
   * failed model call leaves every item unassessed (met: null) rather than
   * failing the whole evaluation or inventing a verdict.
   * @returns {Promise<Array<{id,text,met,evidence}>>}
   */
  static async evaluateChecklist(goal, tasks, userId, provider = null, model = null, accumulateUsage = null) {
    const checklist = checklistOf(goal.success_criteria, goal.world_state?.reviewerFeedback);
    if (!checklist.length) return [];
    try {
      const raw = await this._complete(checklistPrompt(goal, checklist, tasks), 'You check work against a checklist. Return valid JSON only.', userId, provider, model, accumulateUsage, goal.id);
      return parseChecklistVerdict(raw, checklist);
    } catch (error) {
      console.error('[GoalEvaluator] Checklist check failed:', error.message);
      return parseChecklistVerdict('', checklist);
    }
  }

  /**
   * One evaluation call; returns the text.
   *
   * Through ModelRouter as 'goal_eval' (high stake): the account default and
   * fallbacks, then routed picks — a judgement is never handed to a cheaper
   * model to save money. `provider`/`model` name who DID the work: the grader
   * prefers a different provider so a model never grades its own output, and
   * falls back to the same one only when the account has nothing else (it
   * stays in the chain as a last resort, so grading works wherever it did).
   */
  static async _complete(prompt, system, userId, provider, model, accumulateUsage, goalId = null) {
    const { complete } = await import('../ai/ModelRouter.js');
    const { text } = await complete({
      userId,
      origin: 'goal_eval',
      originId: goalId,
      preferOtherThan: provider || true,
      alsoTry: provider ? [{ provider, model }] : [],
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      onUsage: accumulateUsage ? (usage, served) => accumulateUsage(usage, served) : null,
    });
    return text;
  }

  /**
   * Evaluate a single task against success criteria
   * @param {Object} task - The task to evaluate
   * @param {Object} successCriteria - The goal's success criteria
   * @param {string} userId - User ID for AI service
   * @param {string} provider - AI provider to use
   * @param {string} model - AI model to use
   * @param {Function} accumulateUsage - Optional callback to accumulate token usage
   * @returns {Promise<Object>} Task evaluation results
   */
  static async evaluateTask(task, successCriteria, userId, provider = null, model = null, accumulateUsage = null) {
    console.log(`[GoalEvaluator] Evaluating task: ${task.title}`);

    // Parse task output
    const taskOutput = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;

    const invalidOutput = !taskOutput || task.status !== 'completed' || task.error || taskFailureReason({...taskOutput,tool_executions:taskOutput?.toolExecutions});
    if (invalidOutput) {
      return {
        taskId: task.id,
        taskTitle: task.title,
        score: 0,
        criteriaMet: { hasOutput: !!taskOutput, completed:false },
        feedback: 'Task is incomplete, failed, or has no usable output',
      };
    }

    // Use AI to evaluate task output against criteria
    const evaluation = await this.aiEvaluateTaskOutput(task, taskOutput, successCriteria, userId, provider, model, accumulateUsage);

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
   * @param {Function} accumulateUsage - Optional callback to accumulate token usage
   * @returns {Promise<Object>} AI evaluation results
   */
  static async aiEvaluateTaskOutput(task, taskOutput, successCriteria, userId, provider = null, model = null, accumulateUsage = null) {
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
4. List applicable required deliverable and quality criteria as Boolean values (true/false). Do not invent requirements. Explain optional suggestions in feedback, not as failed required criteria. Mixed tool failures/successes require explaining whether the failed operation was actually recovered; an unrelated successful call is not recovery.
5. Review adversarially: look for every defect, gap or unsupported claim. Any defect the work could have avoided means the criterion it affects is false. Do not give credit for intent, effort or plans — only for what the output shows.

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
      const result = await this._complete(
        prompt,
        'You are a strict, adversarial reviewer. Return valid JSON only.',
        userId,
        provider,
        model,
        accumulateUsage,
        task.goal_id || null,
      );

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
      if (!Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 100 || !evaluation.criteriaMet || typeof evaluation.criteriaMet !== 'object' || Array.isArray(evaluation.criteriaMet) || !Object.keys(evaluation.criteriaMet).length || Object.values(evaluation.criteriaMet).some(v=>typeof v !== 'boolean') || typeof evaluation.feedback !== 'string' || !evaluation.feedback.trim()) {
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
   * @param {Function} accumulateUsage - Optional callback to accumulate token usage
   * @returns {Promise<string>} Generated feedback
   */
  static async generateEvaluationFeedback(goal, tasks, taskEvaluations, scores, userId, provider = null, model = null, accumulateUsage = null) {
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
      const feedback = await this._complete(
        prompt,
        'You are an evaluation report writer. Provide constructive feedback.',
        userId,
        provider,
        model,
        accumulateUsage,
        goal.id,
      );
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
