import ExperimentModel from '../models/ExperimentModel.js';
import EvalDatasetService from './EvalDatasetService.js';
import SkillModel from '../models/SkillModel.js';
import GoalModel from '../models/GoalModel.js';
import TaskModel from '../models/TaskModel.js';
import StreamEngine from '../stream/StreamEngine.js';
import UserModel from '../models/UserModel.js';
import db from '../models/database/index.js';
import { broadcastToUser } from '../utils/realtimeSync.js';

class ExperimentService {
  static async createExperiment(userId, { name, hypothesis, type, sourceGoalId, benchmarkId, skillId, evalDatasetId, config }) {
    try {
      if (!name) throw new Error('Experiment name is required');

      const defaultConfig = {
        maxIterations: 3,
        runsPerExample: 1,
        minDelta: 0.05,
        constraintGates: { sizeLimit: true, growthLimit: true, structuralIntegrity: true, holdoutValidation: true },
      };
      const mergedConfig = { ...defaultConfig, ...config, constraintGates: { ...defaultConfig.constraintGates, ...(config?.constraintGates || {}) } };

      const experimentId = await ExperimentModel.create(userId, {
        name, hypothesis, type: type || 'ab_test', sourceGoalId, benchmarkId, skillId, evalDatasetId: evalDatasetId || null, config: mergedConfig,
      });

      return await ExperimentModel.findOne(experimentId);
    } catch (error) {
      console.error('[ExperimentService] Error creating experiment:', error);
      throw error;
    }
  }

  static async runExperiment(experimentId, userId, { provider, model } = {}) {
    try {
      const experiment = await ExperimentModel.findOne(experimentId);
      if (!experiment) throw new Error(`Experiment not found: ${experimentId}`);

      // Auto-generate synthetic dataset if none was provided at creation time
      let datasetId = experiment.eval_dataset_id;
      if (!datasetId && experiment.skill_id) {
        console.log(`[ExperimentService] Auto-generating synthetic dataset for skill ${experiment.skill_id}...`);
        datasetId = await EvalDatasetService.generateSynthetic(experiment.skill_id, userId, { provider, model });
        // Update experiment with the generated dataset ID
        await new Promise((resolve, reject) => {
          db.run(`UPDATE experiments SET eval_dataset_id = ? WHERE id = ?`, [datasetId, experimentId], (err) => err ? reject(err) : resolve());
        });
      }

      const dataset = await EvalDatasetService.getDatasetById(datasetId);
      if (!dataset) throw new Error('Evaluation dataset not found');

      const split = EvalDatasetService.getDatasetSplit(dataset);
      const trainExamples = split.train;

      await ExperimentModel.updateStatus(experimentId, 'running');
      broadcastToUser(userId, 'experiment:status', { experimentId, status: 'running' });

      const skill = experiment.skill_id ? await SkillModel.findById(experiment.skill_id) : null;
      const totalRuns = trainExamples.length * 2;
      let completedCount = 0;

      // Run control and treatment for each example
      for (let i = 0; i < trainExamples.length; i++) {
        const example = trainExamples[i];

        for (const variant of ['control', 'treatment']) {
          try {
            const runId = await ExperimentModel.createRun(experimentId, variant, i);
            await ExperimentModel.updateRunStatus(runId, 'running', new Date().toISOString());

            // Clone goal from example
            const goalId = await this.cloneGoalFromExample(example, userId);
            await ExperimentModel.updateRunGoalId(runId, goalId);

            // Execute goal
            const TaskOrchestrator = (await import('./goal/TaskOrchestrator.js')).default;
            await TaskOrchestrator.executeGoal(goalId, userId, { experimentId, variant, runId });

            // Poll for completion (timeout 5 min)
            const startTime = Date.now();
            let goal;
            while (Date.now() - startTime < 300000) {
              goal = await GoalModel.findOne(goalId);
              if (goal && (goal.status === 'completed' || goal.status === 'failed' || goal.status === 'validated')) break;
              await new Promise((r) => setTimeout(r, 5000));
            }

            // Get goal output for scoring
            const tasks = await TaskModel.findByGoalId(goalId);
            const goalOutput = tasks.map((t) => `${t.title}: ${t.output || t.status}`).join('\n');

            // Score with LLM-as-judge
            const scores = await this.scoreWithJudge(example.taskInput, example.expectedBehavior, goalOutput, variant === 'treatment' ? skill?.instructions : null, userId, { provider, model });
            const composite = this.calculateComposite(scores);

            await ExperimentModel.updateRunMetrics(runId, { ...scores, composite }, composite, composite >= 0.5 ? 1 : 0, scores.feedback);
            await ExperimentModel.updateRunStatus(runId, 'completed', null, new Date().toISOString());

            completedCount++;
            broadcastToUser(userId, 'experiment:run_completed', {
              experimentId, runId, variant, metrics: { ...scores, composite },
              progress: { completed: completedCount, total: totalRuns },
            });
          } catch (runError) {
            console.error(`[ExperimentService] Run error (example ${i}, ${variant}):`, runError);
            completedCount++;
          }
        }
      }

      // Analyze results
      const result = await this.analyzeResults(experimentId, skill?.instructions, null);

      await ExperimentModel.updateStatus(experimentId, 'completed', new Date().toISOString());
      broadcastToUser(userId, 'experiment:result', { experimentId, result });
      broadcastToUser(userId, 'experiment:status', { experimentId, status: 'completed' });

      return result;
    } catch (error) {
      console.error('[ExperimentService] Error running experiment:', error);
      await ExperimentModel.updateStatus(experimentId, 'failed').catch(() => {});
      broadcastToUser(userId, 'experiment:status', { experimentId, status: 'failed' });
      throw error;
    }
  }

  static async analyzeResults(experimentId, skillInstructions = null, baselineInstructions = null) {
    try {
      const runs = await ExperimentModel.findRunsByExperiment(experimentId);
      const controlRuns = runs.filter((r) => r.variant === 'control' && r.status === 'completed');
      const treatmentRuns = runs.filter((r) => r.variant === 'treatment' && r.status === 'completed');

      const avgMetrics = (runList) => {
        if (!runList.length) return { correctness: 0, procedureFollowing: 0, conciseness: 0, composite: 0 };
        const sum = runList.reduce((acc, r) => {
          const m = r.metrics || {};
          acc.correctness += m.correctness || 0;
          acc.procedureFollowing += m.procedureFollowing || 0;
          acc.conciseness += m.conciseness || 0;
          acc.composite += m.composite || 0;
          return acc;
        }, { correctness: 0, procedureFollowing: 0, conciseness: 0, composite: 0 });
        const n = runList.length;
        return { correctness: sum.correctness / n, procedureFollowing: sum.procedureFollowing / n, conciseness: sum.conciseness / n, composite: sum.composite / n };
      };

      const controlAvg = avgMetrics(controlRuns);
      const treatmentAvg = avgMetrics(treatmentRuns);

      const delta = treatmentAvg.composite - controlAvg.composite;
      const confidence = Math.min(1, controlRuns.length / 5);

      const perDimension = {
        correctness: { control: controlAvg.correctness, treatment: treatmentAvg.correctness, delta: treatmentAvg.correctness - controlAvg.correctness },
        procedure: { control: controlAvg.procedureFollowing, treatment: treatmentAvg.procedureFollowing, delta: treatmentAvg.procedureFollowing - controlAvg.procedureFollowing },
        conciseness: { control: controlAvg.conciseness, treatment: treatmentAvg.conciseness, delta: treatmentAvg.conciseness - controlAvg.conciseness },
      };

      const constraintResults = skillInstructions ? this.validateConstraints(skillInstructions, baselineInstructions) : [];
      const allGatesPass = constraintResults.length === 0 || constraintResults.every((g) => g.passed);

      // Load experiment for config
      const experiment = await ExperimentModel.findOne(experimentId);
      const minDelta = experiment?.config?.minDelta || 0.05;

      let decision;
      if (delta > minDelta && allGatesPass) decision = 'keep';
      else if (delta > minDelta && !allGatesPass) decision = 'iterate';
      else decision = 'discard';

      const resultId = await ExperimentModel.createResult(experimentId, {
        iteration: 1,
        controlAvgSes: controlAvg.composite,
        treatmentAvgSes: treatmentAvg.composite,
        delta,
        confidence,
        perDimension,
        constraintResults,
        decision,
        analysis: { reasoning: `Delta ${delta.toFixed(3)} vs threshold ${minDelta}. Gates: ${allGatesPass ? 'all passed' : 'some failed'}.`, controlMetrics: controlAvg, treatmentMetrics: treatmentAvg },
      });

      return await ExperimentModel.findLatest(experimentId);
    } catch (error) {
      console.error('[ExperimentService] Error analyzing results:', error);
      throw error;
    }
  }

  static async cloneGoalFromExample(example, userId) {
    try {
      const goalId = await GoalModel.create(example.taskInput, example.taskInput, userId, 'medium', {});
      await TaskModel.create(goalId, example.taskInput, example.expectedBehavior || example.taskInput, [], [], 0);
      return goalId;
    } catch (error) {
      console.error('[ExperimentService] Error cloning goal from example:', error);
      throw error;
    }
  }

  static async scoreWithJudge(taskInput, expectedBehavior, agentOutput, skillText, userId, { provider: reqProvider, model: reqModel } = {}) {
    try {
      const prompt = `You are an expert evaluator judging AI agent task execution quality.

## Task
${taskInput}

## Expected Behavior (Rubric)
${expectedBehavior}

## Agent Output
${agentOutput || 'No output produced'}

${skillText ? `## Skill Instructions Used\n${skillText}` : ''}

Score the agent's output on these dimensions (0.0 to 1.0):

1. **correctness** — Did the output solve the task correctly?
2. **procedureFollowing** — Did the agent follow the expected procedure/rubric?
3. **conciseness** — Was the response efficient and focused?

Also provide brief textual feedback for improvement.

Return ONLY JSON:
{
  "correctness": 0.0,
  "procedureFollowing": 0.0,
  "conciseness": 0.0,
  "feedback": "Brief textual feedback"
}`;

      const streamEngine = new StreamEngine(userId);
      // Use provider/model from request (frontend sends current selection), fall back to DB settings
      let provider = reqProvider;
      let model = reqModel;
      if (!provider || !model) {
        const userSettings = await UserModel.getUserSettings(userId);
        provider = provider || userSettings?.selectedProvider || 'anthropic';
        model = model || userSettings?.selectedModel || 'claude-sonnet-4-20250514';
      }
      const result = await streamEngine.generateCompletion(prompt, provider, model);

      let cleaned = result;
      if (typeof result === 'string') {
        cleaned = result.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      }

      const scores = JSON.parse(cleaned);
      return {
        correctness: Math.max(0, Math.min(1, scores.correctness || 0)),
        procedureFollowing: Math.max(0, Math.min(1, scores.procedureFollowing || 0)),
        conciseness: Math.max(0, Math.min(1, scores.conciseness || 0)),
        feedback: scores.feedback || '',
      };
    } catch (error) {
      console.error('[ExperimentService] Error scoring with judge:', error);
      return { correctness: 0, procedureFollowing: 0, conciseness: 0, feedback: 'Scoring failed' };
    }
  }

  static calculateComposite(scores) {
    const raw = (0.5 * (scores.correctness || 0)) + (0.3 * (scores.procedureFollowing || 0)) + (0.2 * (scores.conciseness || 0));
    return Math.round(raw * 1000) / 1000;
  }

  static validateConstraints(skillInstructions, baselineInstructions) {
    const results = [];

    results.push({
      name: 'size_limit',
      passed: skillInstructions.length <= 15360,
      message: `${skillInstructions.length}/15360 chars`,
    });

    if (baselineInstructions) {
      const growth = (skillInstructions.length - baselineInstructions.length) / baselineInstructions.length;
      results.push({
        name: 'growth_limit',
        passed: growth <= 0.2,
        message: `${(growth * 100).toFixed(1)}% growth (max 20%)`,
      });
    }

    results.push({
      name: 'non_empty',
      passed: skillInstructions.trim().length > 0,
      message: skillInstructions.trim().length > 0 ? 'Non-empty' : 'Empty skill',
    });

    const hasHeaders = skillInstructions.includes('#');
    const hasSteps = /\d\.\s/.test(skillInstructions) || /^-\s/m.test(skillInstructions);
    results.push({
      name: 'structure',
      passed: hasHeaders && hasSteps,
      message: hasHeaders && hasSteps ? 'Valid structure' : 'Missing headers or steps',
    });

    return results;
  }

  static async onRunCompleted(goalId, experimentContext, evaluation) {
    try {
      if (!experimentContext?.runId) return;
      const metrics = evaluation?.scores ? {
        correctness: (evaluation.scores.overall || 0) / 100,
        procedureFollowing: (evaluation.scores.overall || 0) / 100,
        conciseness: 0.5,
        feedback: evaluation.feedback || '',
      } : {};

      if (Object.keys(metrics).length > 0) {
        const composite = this.calculateComposite(metrics);
        await ExperimentModel.updateRunMetrics(experimentContext.runId, { ...metrics, composite }, composite, composite >= 0.5 ? 1 : 0, metrics.feedback);
      }
    } catch (error) {
      console.error('[ExperimentService] Error in onRunCompleted:', error);
    }
  }

  static async getExperiment(experimentId) {
    return ExperimentModel.findOne(experimentId);
  }

  static async listExperiments(userId, { status, limit } = {}) {
    return ExperimentModel.findByUserId(userId, { status, limit });
  }

  static async getExperimentWithResults(experimentId) {
    try {
      const experiment = await ExperimentModel.findOne(experimentId);
      if (!experiment) return null;

      const runs = await ExperimentModel.findRunsByExperiment(experimentId);
      const results = await ExperimentModel.findByExperiment(experimentId);
      const latestResult = results.length > 0 ? results[results.length - 1] : null;

      return { ...experiment, runs, results, result: latestResult };
    } catch (error) {
      console.error('[ExperimentService] Error getting experiment with results:', error);
      throw error;
    }
  }

  static async deleteExperiment(experimentId, userId) {
    return ExperimentModel.delete(experimentId, userId);
  }
}

export default ExperimentService;
