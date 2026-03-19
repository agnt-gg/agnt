import GoalModel from '../models/GoalModel.js';
import TaskModel from '../models/TaskModel.js';
import GoalIterationModel from '../models/GoalIterationModel.js';
import GoalProcessor from '../services/goal/GoalProcessor.js';
import TaskOrchestrator from '../services/goal/TaskOrchestrator.js';
import GoalEvaluator from '../services/goal/GoalEvaluator.js';
import GoldenStandardModel from '../models/GoldenStandardModel.js';

class GoalService {
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }
  async createGoal(req, res) {
    try {
      const { text, title, description, priority = 'medium', success_criteria, provider, model } = req.body;
      const userId = req.user.userId;

      // Handle both old format (text) and new format (title + description)
      const goalText = text || (title && description ? `${title}: ${description}` : title);

      if (!goalText) {
        return res.status(400).json({
          error: "Either 'text' or 'title' is required to create a goal",
        });
      }

      console.log('Processing goal:', goalText);

      // Use GoalProcessor to analyze and create plan
      const goalPlan = await GoalProcessor.processGoal(goalText, userId, provider, model);

      res.status(201).json({
        message: 'Goal created and analyzed',
        goal: goalPlan,
      });
    } catch (error) {
      console.error('Error creating goal:', error);
      res.status(500).json({
        error: 'Failed to create goal',
        details: error.message,
      });
    }
  }
  async executeGoal(req, res) {
    try {
      const { goalId } = req.params;
      const userId = req.user.userId;
      const { provider, model, conversationId } = req.body || {};

      console.log('Starting goal execution:', goalId);

      // Start execution using TaskOrchestrator
      const execution = await TaskOrchestrator.executeGoal(goalId, userId, null, provider, model, conversationId || null);

      res.status(200).json({
        message: 'Goal execution started',
        execution,
      });
    } catch (error) {
      console.error('Error executing goal:', error);
      res.status(500).json({
        error: 'Failed to execute goal',
        details: error.message,
      });
    }
  }
  async getAllGoals(req, res) {
    try {
      const userId = req.user.userId;
      const includeDeleted = req.query.includeDeleted === 'true';
      const goals = await GoalModel.findAllByUserId(userId, { includeDeleted });
      res.json({ goals });
    } catch (error) {
      console.error('Error retrieving goals:', error);
      res.status(500).json({ error: 'Error retrieving goals' });
    }
  }
  async getGoal(req, res) {
    try {
      const { id } = req.params;
      const goal = await GoalModel.findOne(id);

      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }

      // Get associated tasks
      const tasks = await TaskModel.findByGoalId(id);

      // Calculate total duration from tasks
      let totalDuration = 0;
      let earliestStart = null;
      let latestEnd = null;

      tasks.forEach((task) => {
        if (task.started_at) {
          const startTime = new Date(task.started_at);
          if (!earliestStart || startTime < earliestStart) {
            earliestStart = startTime;
          }
        }
        if (task.completed_at) {
          const endTime = new Date(task.completed_at);
          if (!latestEnd || endTime > latestEnd) {
            latestEnd = endTime;
          }
        }
      });

      // Calculate duration in seconds if we have both start and end times
      if (earliestStart && latestEnd) {
        totalDuration = Math.floor((latestEnd - earliestStart) / 1000);
      }

      // Get token usage from goal evaluations
      const db = (await import('../models/database/index.js')).default;
      const evalTokenData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT SUM(input_tokens) as input_tokens,
                  SUM(output_tokens) as output_tokens,
                  SUM(total_tokens) as total_tokens,
                  SUM(estimated_cost) as estimated_cost
           FROM goal_evaluations
           WHERE goal_id = ?`,
          [id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
          }
        );
      });

      // Also aggregate token usage from task execution outputs
      let taskInputTokens = 0, taskOutputTokens = 0, taskTotalTokens = 0;
      for (const task of tasks) {
        try {
          const output = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
          if (output?.usage) {
            taskInputTokens += output.usage.inputTokens || 0;
            taskOutputTokens += output.usage.outputTokens || 0;
            taskTotalTokens += output.usage.totalTokens || 0;
          }
        } catch { /* ignore parse errors */ }
      }

      const totalInputTokens = (evalTokenData.input_tokens || 0) + taskInputTokens;
      const totalOutputTokens = (evalTokenData.output_tokens || 0) + taskOutputTokens;
      const totalTokens = (evalTokenData.total_tokens || 0) + taskTotalTokens;
      const totalCost = evalTokenData.estimated_cost || 0;

      res.json({
        goal: {
          ...goal,
          tasks,
          total_duration: totalDuration,
          credits_used: totalDuration,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          total_tokens: totalTokens,
          estimated_cost: totalCost,
        },
      });
    } catch (error) {
      console.error('Error retrieving goal:', error);
      res.status(500).json({ error: 'Error retrieving goal' });
    }
  }
  async getGoalStatus(req, res) {
    try {
      const { id } = req.params;
      const status = await TaskOrchestrator.getGoalStatus(id);
      res.json(status);
    } catch (error) {
      console.error('Error getting goal status:', error);
      res.status(500).json({ error: 'Error getting goal status' });
    }
  }
  async pauseGoal(req, res) {
    try {
      const { id } = req.params;
      await TaskOrchestrator.pauseGoal(id);
      res.json({ message: 'Goal paused' });
    } catch (error) {
      console.error('Error pausing goal:', error);
      res.status(500).json({ error: 'Error pausing goal' });
    }
  }
  async resumeGoal(req, res) {
    try {
      const { id } = req.params;
      const { provider, model } = req.body || {};
      await TaskOrchestrator.resumeGoal(id, provider, model);
      res.json({ message: 'Goal resumed' });
    } catch (error) {
      console.error('Error resuming goal:', error);
      res.status(500).json({ error: 'Error resuming goal' });
    }
  }
  async deleteGoal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      // Stop execution if running
      await TaskOrchestrator.stopGoal(id);

      // Delete goal
      const result = await GoalModel.delete(id, userId);
      if (result === 0) {
        return res.status(404).json({ error: 'Goal not found' });
      }
      res.json({ message: `Goal ${id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting goal:', error);
      res.status(500).json({
        error: 'Failed to delete goal',
        details: error.message,
      });
    }
  }
  async evaluateGoal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const { evaluation_type = 'automatic', provider, model } = req.body;

      console.log(`Evaluating goal ${id} with type: ${evaluation_type}`);

      const evaluation = await GoalEvaluator.evaluateGoal(id, userId, evaluation_type, provider, model);

      res.status(200).json(evaluation);
    } catch (error) {
      console.error('Error evaluating goal:', error);
      res.status(500).json({
        error: 'Failed to evaluate goal',
        details: error.message,
      });
    }
  }
  async getEvaluationReport(req, res) {
    try {
      const { id } = req.params;

      const report = await GoalEvaluator.getEvaluationReport(id);

      if (!report) {
        return res.status(404).json({ error: 'No evaluation found for this goal' });
      }

      res.json(report);
    } catch (error) {
      console.error('Error getting evaluation report:', error);
      res.status(500).json({
        error: 'Failed to get evaluation report',
        details: error.message,
      });
    }
  }
  async saveAsGoldenStandard(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const { category } = req.body;

      if (!category) {
        return res.status(400).json({ error: 'Category is required' });
      }

      // Get goal and its evaluation
      const goal = await GoalModel.findOne(id);
      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }

      const evaluation = await GoalEvaluator.getEvaluationReport(id);
      if (!evaluation || !evaluation.passed) {
        return res.status(400).json({
          error: 'Goal must be evaluated and passed before saving as golden standard',
        });
      }

      // Get all tasks
      const tasks = await TaskModel.findByGoalId(id);

      // Create template data
      const templateData = {
        goal: {
          title: goal.title,
          description: goal.description,
          success_criteria: goal.success_criteria,
        },
        tasks: tasks.map((t) => ({
          title: t.title,
          description: t.description,
          required_tools: t.required_tools,
          order_index: t.order_index,
        })),
        evaluation: {
          scores: evaluation.scores,
          feedback: evaluation.feedback,
        },
      };

      const standardId = await GoldenStandardModel.create(
        id,
        category,
        goal.title,
        goal.description,
        evaluation.scores.overall,
        templateData,
        userId
      );

      res.status(201).json({
        id: standardId,
        message: 'Goal saved as golden standard successfully',
        category,
      });
    } catch (error) {
      console.error('Error saving golden standard:', error);
      res.status(500).json({
        error: 'Failed to save as golden standard',
        details: error.message,
      });
    }
  }
  async getGoldenStandards(req, res) {
    try {
      const userId = req.user.userId;
      const { category } = req.query;

      let standards;
      if (category) {
        standards = await GoldenStandardModel.findByCategory(category);
      } else {
        standards = await GoldenStandardModel.findByUserId(userId);
      }

      res.json({ standards });
    } catch (error) {
      console.error('Error getting golden standards:', error);
      res.status(500).json({
        error: 'Failed to get golden standards',
        details: error.message,
      });
    }
  }
  // ==================== AGI Loop Endpoints ====================

  async executeGoalAutonomous(req, res) {
    try {
      const { goalId } = req.params;
      const userId = req.user.userId;
      const { maxIterations = 50, provider, model, conversationId } = req.body;

      console.log(`Starting autonomous goal execution: ${goalId} (max ${maxIterations} iterations)`);

      // Start autonomous execution (non-blocking — runs in background)
      TaskOrchestrator.executeGoalAutonomous(goalId, userId, { maxIterations, provider, model, conversationId: conversationId || null });

      res.status(200).json({
        message: 'Autonomous goal execution started',
        goalId,
        maxIterations,
      });
    } catch (error) {
      console.error('Error starting autonomous execution:', error);
      res.status(500).json({
        error: 'Failed to start autonomous execution',
        details: error.message,
      });
    }
  }

  async getIterations(req, res) {
    try {
      const { goalId } = req.params;
      const iterations = await GoalIterationModel.findByGoalId(goalId);
      res.json({ iterations });
    } catch (error) {
      console.error('Error getting iterations:', error);
      res.status(500).json({ error: 'Failed to get iterations' });
    }
  }

  async getWorldState(req, res) {
    try {
      const { goalId } = req.params;
      const worldState = await GoalModel.getWorldState(goalId);
      const goal = await GoalModel.findOne(goalId);
      res.json({
        worldState,
        currentIteration: goal?.current_iteration || 0,
        maxIterations: goal?.max_iterations || 50,
        loopStatus: goal?.loop_status || null,
      });
    } catch (error) {
      console.error('Error getting world state:', error);
      res.status(500).json({ error: 'Failed to get world state' });
    }
  }

  async reviewGoal(req, res) {
    try {
      const { id } = req.params;
      const { action, feedback } = req.body; // action: 'approve' | 'reject'

      const goal = await GoalModel.findOne(id);
      if (!goal) {
        return res.status(404).json({ error: 'Goal not found' });
      }

      if (action === 'approve') {
        await GoalModel.updateStatus(id, 'validated');
        res.json({ message: 'Goal approved', status: 'validated' });
      } else if (action === 'reject') {
        // Set back to queued so user can re-run with feedback
        await GoalModel.updateStatus(id, 'queued');
        // Store feedback in world state so the next iteration can use it
        if (feedback) {
          const currentWorldState = await GoalModel.getWorldState(id);
          const worldState = currentWorldState || {};
          worldState.user_feedback = feedback;
          worldState.user_feedback_at = new Date().toISOString();
          await GoalModel.updateWorldState(id, worldState);
        }
        res.json({ message: 'Goal sent back for revision', status: 'queued', feedback });
      } else {
        return res.status(400).json({ error: "Invalid action. Use 'approve' or 'reject'" });
      }
    } catch (error) {
      console.error('Error reviewing goal:', error);
      res.status(500).json({ error: 'Failed to review goal', details: error.message });
    }
  }

  async revertToIteration(req, res) {
    try {
      const { goalId, iteration } = req.params;
      const iterationRecord = await GoalIterationModel.findOne(goalId, parseInt(iteration));

      if (!iterationRecord) {
        return res.status(404).json({ error: 'Iteration not found' });
      }

      // Restore world state from snapshot
      await GoalModel.updateWorldState(goalId, iterationRecord.world_state_snapshot);
      await GoalModel.updateIteration(goalId, iterationRecord.iteration_number);
      await GoalModel.updateLoopStatus(goalId, 'reverted');
      await GoalModel.updateStatus(goalId, 'paused');

      // If there's a git hash, try to checkout that state
      if (iterationRecord.git_commit_hash) {
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          const branchName = `goal/${goalId}`;
          await execAsync(`git checkout ${branchName} -- .agnt/goals/${goalId}.json`, { cwd: process.cwd() });
        } catch (gitError) {
          console.warn(`[AGI Loop] Git revert failed (non-fatal):`, gitError.message);
        }
      }

      res.json({
        message: `Reverted to iteration ${iteration}`,
        worldState: iterationRecord.world_state_snapshot,
        iteration: iterationRecord.iteration_number,
      });
    } catch (error) {
      console.error('Error reverting iteration:', error);
      res.status(500).json({ error: 'Failed to revert to iteration' });
    }
  }
}

console.log(`Goal Service Started...`);

export default new GoalService();
