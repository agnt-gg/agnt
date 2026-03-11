import TraceAnalyzer from './TraceAnalyzer.js';
import SkillEvolver from './SkillEvolver.js';
import SkillEvalModel from '../../models/SkillEvalModel.js';
import SkillVersionModel from '../../models/SkillVersionModel.js';
import SkillForgeSettingsModel from '../../models/SkillForgeSettingsModel.js';
import GoalModel from '../../models/GoalModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import GoalEvaluator from './GoalEvaluator.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';
import db from '../../models/database/index.js';

/**
 * SkillForgeOrchestrator — Top-level coordinator for the SkillForge pipeline.
 * Single integration point with the existing goal system.
 */
class SkillForgeOrchestrator {
  /**
   * Called after a goal completes. Orchestrates the full SkillForge pipeline.
   * Fire-and-forget — failures here never affect goal execution.
   */
  static async onGoalCompleted(goalId, userId) {
    try {
      const settings = await this.getSettings(userId);
      if (!settings.autoAnalyze) {
        console.log(`[SkillForge] Auto-analyze disabled for user ${userId}, skipping`);
        return null;
      }

      return await this.analyzeAndEvolve(goalId, userId);
    } catch (error) {
      console.error(`[SkillForge] onGoalCompleted failed (non-critical):`, error.message);
      return null;
    }
  }

  /**
   * Manual trigger: analyze a completed goal and evolve skills.
   */
  static async analyzeAndEvolve(goalId, userId) {
    const settings = await this.getSettings(userId);

    // Guard: check goal score
    let evaluation = null;
    try {
      evaluation = await GoalEvaluator.getEvaluationReport(goalId);
    } catch { /* ignore */ }

    const score = evaluation?.overall_score || evaluation?.evaluation_data?.scores?.overall || 0;
    const minScore = settings.minScore ?? 30;
    if (score < minScore) {
      console.log(`[SkillForge] Goal ${goalId} score (${score}%) below ${minScore}% threshold, skipping`);
      return { status: 'skipped', reason: `Goal score ${score}% below ${minScore}% threshold` };
    }

    // Guard: check iteration count (configurable, default 0 — allow single-pass goals)
    const minIterations = settings.minIterations ?? 0;
    const iterations = await GoalIterationModel.findByGoalId(goalId);
    if (iterations.length < minIterations) {
      console.log(`[SkillForge] Goal ${goalId} has ${iterations.length} iterations (need >= ${minIterations}), skipping`);
      return { status: 'skipped', reason: `Only ${iterations.length} iterations (need >= ${minIterations})` };
    }

    // Phase 1: Trace Analysis
    console.log(`[SkillForge] Analyzing goal ${goalId}...`);
    const analysis = await TraceAnalyzer.analyzeTrace(goalId, userId);

    if (!analysis) {
      return { status: 'skipped', reason: 'Trace analysis returned no results' };
    }

    // Guard: confidence threshold
    if (!analysis.skillCandidate?.shouldGenerate || (analysis.skillCandidate?.confidence || 0) < settings.minConfidence) {
      console.log(`[SkillForge] Skill candidate confidence below threshold (${analysis.skillCandidate?.confidence || 0} < ${settings.minConfidence})`);
      return {
        status: 'analyzed',
        analysis: {
          traceQuality: analysis.traceQuality,
          overallAssessment: analysis.overallAssessment,
          patternCount: analysis.patterns?.length || 0,
          antipatternCount: analysis.antipatterns?.length || 0,
          patterns: analysis.patterns,
          antipatterns: analysis.antipatterns,
          insights: analysis.insights,
          skillCandidate: analysis.skillCandidate,
        },
        reason: 'No skill candidate met confidence threshold',
      };
    }

    // Phase 2: Skill Evolution
    console.log(`[SkillForge] Evolving skill from goal ${goalId}...`);
    const result = await SkillEvolver.evolveSkill(analysis, goalId, userId);

    // Broadcast result to frontend
    broadcastToUser(userId, 'skillforge:evolution_complete', {
      goalId,
      result,
    });

    return {
      status: 'completed',
      analysis: {
        traceQuality: analysis.traceQuality,
        overallAssessment: analysis.overallAssessment,
        patternCount: analysis.patterns?.length || 0,
        antipatternCount: analysis.antipatterns?.length || 0,
        patterns: analysis.patterns,
        antipatterns: analysis.antipatterns,
        insights: analysis.insights,
      },
      evolution: result,
    };
  }

  /**
   * Analyze a goal without evolving (just return the trace analysis).
   */
  static async analyzeGoal(goalId, userId) {
    const analysis = await TraceAnalyzer.analyzeTrace(goalId, userId);
    return analysis;
  }

  /**
   * Get all completed goals eligible for skill forging.
   * Single efficient query with subqueries for iteration count, eval score, and forge status.
   */
  static async getEligibleGoals(userId) {
    const settings = await this.getSettings(userId);
    const minTasks = settings.minTasks ?? 1;
    const minIterations = settings.minIterations ?? 0;
    const minScore = settings.minScore ?? 30;

    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          g.id,
          g.title,
          g.description,
          g.status,
          g.priority,
          g.created_at,
          g.completed_at,
          g.current_iteration,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_tasks,
          COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN t.id END) as failed_tasks,
          (SELECT COUNT(*) FROM goal_iterations gi WHERE gi.goal_id = g.id) as iteration_count,
          (SELECT ge.overall_score FROM goal_evaluations ge WHERE ge.goal_id = g.id ORDER BY ge.evaluated_at DESC LIMIT 1) as eval_score,
          (SELECT ge.passed FROM goal_evaluations ge WHERE ge.goal_id = g.id ORDER BY ge.evaluated_at DESC LIMIT 1) as eval_passed,
          (SELECT COUNT(*) FROM skill_evaluations se WHERE se.source_goal_id = g.id) as forged_count
        FROM goals g
        LEFT JOIN tasks t ON g.id = t.goal_id
        WHERE g.user_id = ?
          AND g.status IN ('completed', 'validated')
          AND g.deleted_at IS NULL
        GROUP BY g.id
        ORDER BY g.completed_at DESC
        LIMIT 100
      `, [userId], (err, rows) => {
        if (err) {
          console.error('[SkillForge] getEligibleGoals error:', err);
          reject(err);
          return;
        }

        const goals = (rows || []).map(goal => {
          const reasons = [];
          if (goal.task_count < minTasks) reasons.push(`Only ${goal.task_count} tasks (need ${minTasks}+)`);
          if (goal.iteration_count < minIterations) reasons.push(`Only ${goal.iteration_count} iterations (need ${minIterations}+)`);
          if (goal.eval_score !== null && goal.eval_score < minScore) reasons.push(`Score ${Math.round(goal.eval_score)}% below ${minScore}%`);

          return {
            ...goal,
            eval_passed: goal.eval_passed === 1,
            already_forged: goal.forged_count > 0,
            eligible: reasons.length === 0,
            ineligible_reasons: reasons,
          };
        });

        resolve(goals);
      });
    });
  }

  /**
   * Get aggregate stats for the user.
   */
  static async getStats(userId) {
    try {
      const evaluations = await SkillEvalModel.findByUserId(userId, 1000);
      const leaderboard = await SkillEvalModel.getLeaderboard(userId, 5);

      const totalEvaluations = evaluations.length;
      const kept = evaluations.filter(e => e.decision === 'kept' || e.decision === 'promoted').length;
      const discarded = evaluations.filter(e => e.decision === 'discarded').length;
      const promoted = evaluations.filter(e => e.decision === 'promoted').length;
      const avgDelta = totalEvaluations > 0 ? evaluations.reduce((s, e) => s + (e.delta || 0), 0) / totalEvaluations : 0;

      return {
        totalEvaluations,
        skillsKept: kept,
        skillsDiscarded: discarded,
        skillsPromoted: promoted,
        averageDelta: Math.round(avgDelta * 10) / 10,
        winRate: totalEvaluations > 0 ? Math.round((kept / totalEvaluations) * 100) / 100 : 0,
        topSkills: leaderboard,
      };
    } catch (error) {
      console.error('[SkillForge] Stats error:', error);
      return {
        totalEvaluations: 0,
        skillsKept: 0,
        skillsDiscarded: 0,
        skillsPromoted: 0,
        averageDelta: 0,
        winRate: 0,
        topSkills: [],
      };
    }
  }

  /**
   * Get settings for a user (persisted to DB).
   */
  static async getSettings(userId) {
    try {
      return await SkillForgeSettingsModel.get(userId);
    } catch (error) {
      console.error('[SkillForge] Settings read error:', error);
      return {
        autoAnalyze: false,
        abTestTimeBudgetMs: 300000,
        minConfidence: 0.7,
        minDelta: 2.0,
        goldStandardThreshold: 90,
      };
    }
  }

  /**
   * Update settings for a user (persisted to DB).
   */
  static async updateSettings(userId, newSettings) {
    return await SkillForgeSettingsModel.update(userId, newSettings);
  }
}

export default SkillForgeOrchestrator;
