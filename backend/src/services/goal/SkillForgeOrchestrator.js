import TraceAnalyzer from './TraceAnalyzer.js';
import SkillEvolver from './SkillEvolver.js';
import SkillEvalModel from '../../models/SkillEvalModel.js';
import SkillVersionModel from '../../models/SkillVersionModel.js';
import GoalModel from '../../models/GoalModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import GoalEvaluator from './GoalEvaluator.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';

// In-memory settings cache per user (simple approach — no extra DB table needed)
const settingsCache = new Map();

const DEFAULT_SETTINGS = {
  autoAnalyze: false,
  abTestTimeBudgetMs: 300000,
  minConfidence: 0.7,
  minDelta: 2.0,
  goldStandardThreshold: 90,
};

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
      const settings = this.getSettings(userId);
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
    const settings = this.getSettings(userId);

    // Guard: check goal score
    let evaluation = null;
    try {
      evaluation = await GoalEvaluator.getEvaluationReport(goalId);
    } catch { /* ignore */ }

    const score = evaluation?.overall_score || evaluation?.evaluation_data?.scores?.overall || 0;
    if (score < 30) {
      console.log(`[SkillForge] Goal ${goalId} score (${score}%) below 30% threshold, skipping`);
      return { status: 'skipped', reason: `Goal score ${score}% below 30% threshold` };
    }

    // Guard: check iteration count
    const iterations = await GoalIterationModel.findByGoalId(goalId);
    if (iterations.length < 2) {
      console.log(`[SkillForge] Goal ${goalId} has ${iterations.length} iterations (need >= 2), skipping`);
      return { status: 'skipped', reason: `Only ${iterations.length} iterations (need >= 2)` };
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
          skillCandidate: null,
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
   * Get settings for a user.
   */
  static getSettings(userId) {
    return settingsCache.get(userId) || { ...DEFAULT_SETTINGS };
  }

  /**
   * Update settings for a user.
   */
  static updateSettings(userId, newSettings) {
    const current = this.getSettings(userId);
    const merged = { ...current, ...newSettings };
    settingsCache.set(userId, merged);
    return merged;
  }
}

export default SkillForgeOrchestrator;
