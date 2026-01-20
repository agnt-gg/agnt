import GoalModel from '../models/GoalModel.js';
import TaskModel from '../models/TaskModel.js';
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
      const { text, title, description, priority = 'medium', success_criteria } = req.body;
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
      const goalPlan = await GoalProcessor.processGoal(goalText, userId);

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

      console.log('Starting goal execution:', goalId);

      // Start execution using TaskOrchestrator
      const execution = await TaskOrchestrator.executeGoal(goalId, userId);

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
      const goals = await GoalModel.findAllByUserId(userId);
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

      // Get total credits used from task_executions
      const db = (await import('../models/database/index.js')).default;
      const creditsUsed = await new Promise((resolve, reject) => {
        db.get(
          `SELECT SUM(te.credits_used) as total_credits
           FROM task_executions te
           JOIN tasks t ON te.task_id = t.id
           WHERE t.goal_id = ?`,
          [id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.total_credits || 0);
          }
        );
      });

      res.json({
        goal: {
          ...goal,
          tasks,
          total_duration: totalDuration,
          credits_used: creditsUsed,
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
      await TaskOrchestrator.resumeGoal(id);
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
      const { evaluation_type = 'automatic' } = req.body;

      console.log(`Evaluating goal ${id} with type: ${evaluation_type}`);

      const evaluation = await GoalEvaluator.evaluateGoal(id, userId, evaluation_type);

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
}

console.log(`Goal Service Started...`);

export default new GoalService();
