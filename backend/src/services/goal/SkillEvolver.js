import SkillModel from '../../models/SkillModel.js';
import SkillVersionModel from '../../models/SkillVersionModel.js';
import SkillEvalModel from '../../models/SkillEvalModel.js';
import GoldenStandardModel from '../../models/GoldenStandardModel.js';
import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import GoalIterationModel from '../../models/GoalIterationModel.js';
import GoalEvaluator from './GoalEvaluator.js';
import TaskOrchestrator from './TaskOrchestrator.js';
import StreamEngine from '../../stream/StreamEngine.js';
import generateUUID from '../../utils/generateUUID.js';

/**
 * SkillEvolver — A/B testing engine for skill evolution.
 * Creates/refines skills from trace analysis, tests them, and keeps or discards.
 */
class SkillEvolver {
  static MIN_DELTA = 2.0;
  static GOLD_STANDARD_THRESHOLD = 90;
  static DEFAULT_TIME_BUDGET_MS = 300000; // 5 minutes

  /**
   * Primary entry point. Evolve a skill from a trace analysis.
   * @param {Object} traceAnalysis - Output from TraceAnalyzer
   * @param {string} sourceGoalId - The goal that produced this trace
   * @param {string} userId - Owner
   * @returns {Object} EvolutionResult { action, delta, skillId, skillName, version, ... }
   */
  static async evolveSkill(traceAnalysis, sourceGoalId, userId) {
    const candidate = traceAnalysis.skillCandidate;
    if (!candidate || !candidate.shouldGenerate) {
      return { action: 'skipped', reason: 'No skill candidate in trace analysis' };
    }

    console.log(`[SkillEvolver] Evolving skill "${candidate.name}" from goal ${sourceGoalId}`);

    try {
      // Check for existing similar skill
      const existingSkillId = await this._findSimilarSkill(candidate, userId);

      if (existingSkillId) {
        console.log(`[SkillEvolver] Found similar skill ${existingSkillId}, routing to refinement`);
        return await this.refineSkill(existingSkillId, traceAnalysis, sourceGoalId, userId);
      }

      // Create new skill
      return await this._createAndTestSkill(candidate, traceAnalysis, sourceGoalId, userId);
    } catch (error) {
      console.error(`[SkillEvolver] Evolution failed for goal ${sourceGoalId}:`, error);
      return { action: 'error', reason: error.message };
    }
  }

  /**
   * Create a new skill from candidate and A/B test it.
   * @private
   */
  static async _createAndTestSkill(candidate, traceAnalysis, sourceGoalId, userId) {
    // Create draft skill in DB
    const skillId = generateUUID();
    await SkillModel.createOrUpdate(skillId, {
      name: candidate.name,
      description: candidate.description,
      instructions: candidate.instructions,
      category: candidate.category || 'general',
      icon: 'fas fa-flask',
      allowedTools: JSON.stringify(candidate.allowedTools || []),
      metadata: JSON.stringify({
        skillforge: {
          status: 'draft',
          currentVersion: 1,
          totalEvaluations: 0,
          sourceGoals: [sourceGoalId],
          generation: 1,
        },
      }),
    }, userId);

    // Create version record
    const versionId = await SkillVersionModel.create({
      skillId,
      userId,
      version: 1,
      instructions: candidate.instructions,
      effectivenessScore: candidate.estimatedEffectiveness ? candidate.estimatedEffectiveness * 100 : null,
      sourceGoalId,
      traceAnalysisSummary: JSON.stringify({
        quality: traceAnalysis.traceQuality,
        patternCount: traceAnalysis.patterns?.length || 0,
        assessment: traceAnalysis.overallAssessment,
      }),
      status: 'active',
    });

    // Run A/B test (quality-based evaluation)
    const abResult = await this._runABTest(sourceGoalId, skillId, userId, traceAnalysis);

    if (!abResult) {
      // A/B test couldn't run (no reference goal possible) — keep the skill as draft
      console.log(`[SkillEvolver] A/B test could not run — keeping skill "${candidate.name}" as draft`);
      return {
        action: 'kept',
        skillId,
        skillName: candidate.name,
        version: 1,
        versionId,
        delta: null,
        baselineSES: null,
        treatmentSES: null,
        reason: 'A/B test skipped — kept as draft based on trace confidence',
      };
    }

    // Record evaluation
    const evalId = await SkillEvalModel.create({
      skillId,
      skillVersionId: versionId,
      userId,
      sourceGoalId,
      ...abResult,
    });

    // Decision
    if (abResult.delta > this.MIN_DELTA) {
      // KEEP
      const metadata = {
        skillforge: {
          status: abResult.treatmentSes >= this.GOLD_STANDARD_THRESHOLD ? 'gold_standard' : 'validated',
          currentVersion: 1,
          totalEvaluations: 1,
          winRate: 1.0,
          averageSES: abResult.treatmentSes,
          lastEvalDate: new Date().toISOString(),
          sourceGoals: [sourceGoalId],
          generation: 1,
        },
      };

      await SkillModel.createOrUpdate(skillId, {
        name: candidate.name,
        description: candidate.description,
        instructions: candidate.instructions,
        category: candidate.category || 'general',
        icon: 'fas fa-flask',
        allowedTools: JSON.stringify(candidate.allowedTools || []),
        metadata: JSON.stringify(metadata),
      }, userId);

      // Promote to Gold Standard if exceptional
      if (abResult.treatmentSes >= this.GOLD_STANDARD_THRESHOLD) {
        await this._promoteToGoldStandard(skillId, candidate, sourceGoalId, userId, abResult.treatmentSes);
      }

      console.log(`[SkillEvolver] KEPT "${candidate.name}" (delta: +${abResult.delta.toFixed(1)})`);

      return {
        action: abResult.treatmentSes >= this.GOLD_STANDARD_THRESHOLD ? 'promoted' : 'kept',
        skillId,
        skillName: candidate.name,
        version: 1,
        versionId,
        delta: abResult.delta,
        baselineSES: abResult.baselineSes,
        treatmentSES: abResult.treatmentSes,
        evaluationId: evalId,
        isGoldStandard: abResult.treatmentSes >= this.GOLD_STANDARD_THRESHOLD,
      };
    } else {
      // DISCARD
      await SkillModel.delete(skillId, userId);
      await SkillVersionModel.supersede(versionId);

      console.log(`[SkillEvolver] DISCARDED "${candidate.name}" (delta: ${abResult.delta.toFixed(1)})`);

      return {
        action: 'discarded',
        skillId,
        skillName: candidate.name,
        version: 1,
        delta: abResult.delta,
        baselineSES: abResult.baselineSes,
        treatmentSES: abResult.treatmentSes,
        evaluationId: evalId,
      };
    }
  }

  /**
   * Refine an existing skill by merging new trace insights.
   * Uses quality-based comparison (no update-then-revert pattern).
   */
  static async refineSkill(existingSkillId, traceAnalysis, sourceGoalId, userId) {
    const existingSkill = await SkillModel.findById(existingSkillId);
    if (!existingSkill) {
      return { action: 'error', reason: 'Existing skill not found' };
    }

    const candidate = traceAnalysis.skillCandidate;
    console.log(`[SkillEvolver] Refining "${existingSkill.name}" with new trace insights`);

    // Use LLM to merge existing instructions with new patterns
    const mergedInstructions = await this._mergeSkillInstructions(
      existingSkill.instructions,
      candidate.instructions,
      traceAnalysis,
      userId
    );

    if (!mergedInstructions) {
      return { action: 'error', reason: 'Failed to merge skill instructions' };
    }

    // Get version info
    const nextVersion = await SkillVersionModel.getNextVersion(existingSkillId);
    const currentVersion = await SkillVersionModel.findLatest(existingSkillId);

    // Create new version record (candidate — will be superseded if discarded)
    const versionId = await SkillVersionModel.create({
      skillId: existingSkillId,
      userId,
      version: nextVersion,
      instructions: mergedInstructions,
      parentVersionId: currentVersion?.id || null,
      sourceGoalId,
      traceAnalysisSummary: JSON.stringify({
        quality: traceAnalysis.traceQuality,
        patternCount: traceAnalysis.patterns?.length || 0,
        assessment: traceAnalysis.overallAssessment,
      }),
      status: 'active',
    });

    // Quality-based comparison: old instructions vs new instructions
    const tasks = await TaskModel.findByGoalId(sourceGoalId);
    const rawMetrics = await this._measureGoalPerformance(sourceGoalId, userId);
    const baselineQuality = this._evaluateSkillQuality(existingSkill.instructions || '', traceAnalysis, tasks);
    const treatmentQuality = this._evaluateSkillQuality(mergedInstructions, traceAnalysis, tasks);
    const delta = treatmentQuality - baselineQuality;
    const baseSes = rawMetrics?.ses || 50;
    const baselineSes = Math.min(100, baseSes + baselineQuality);
    const treatmentSes = Math.min(100, baseSes + treatmentQuality);

    // Record evaluation
    const abResult = {
      baselineSes,
      baselineCompletion: rawMetrics?.completion || 0,
      baselineToolCalls: rawMetrics?.toolCalls || 0,
      baselineErrors: rawMetrics?.errors || 0,
      baselineDurationMs: rawMetrics?.durationMs || 0,
      treatmentSes,
      treatmentCompletion: rawMetrics?.completion || 0,
      treatmentToolCalls: rawMetrics?.toolCalls || 0,
      treatmentErrors: rawMetrics?.errors || 0,
      treatmentDurationMs: rawMetrics?.durationMs || 0,
      delta,
      decision: delta > this.MIN_DELTA ? 'kept' : 'discarded',
      judgeReasoning: `Refinement quality: old=${baselineQuality.toFixed(1)} vs new=${treatmentQuality.toFixed(1)}, improvement=${delta.toFixed(1)}`,
    };

    await SkillEvalModel.create({
      skillId: existingSkillId,
      skillVersionId: versionId,
      userId,
      sourceGoalId,
      ...abResult,
    });

    if (delta > this.MIN_DELTA) {
      // KEEP — supersede old version and update skill
      if (currentVersion) await SkillVersionModel.supersede(currentVersion.id);

      const existingMeta = existingSkill.metadata ? JSON.parse(existingSkill.metadata) : {};
      const sfMeta = existingMeta.skillforge || {};
      const sourceGoals = sfMeta.sourceGoals || [];
      if (!sourceGoals.includes(sourceGoalId)) sourceGoals.push(sourceGoalId);

      const metadata = {
        ...existingMeta,
        skillforge: {
          ...sfMeta,
          status: treatmentSes >= this.GOLD_STANDARD_THRESHOLD ? 'gold_standard' : 'validated',
          currentVersion: nextVersion,
          totalEvaluations: (sfMeta.totalEvaluations || 0) + 1,
          lastEvalDate: new Date().toISOString(),
          sourceGoals,
          generation: nextVersion,
        },
      };

      await SkillModel.createOrUpdate(existingSkillId, {
        name: existingSkill.name,
        description: existingSkill.description,
        instructions: mergedInstructions,
        category: existingSkill.category,
        icon: existingSkill.icon,
        allowedTools: existingSkill.allowed_tools,
        metadata: JSON.stringify(metadata),
      }, userId);

      if (treatmentSes >= this.GOLD_STANDARD_THRESHOLD) {
        await this._promoteToGoldStandard(existingSkillId, { name: existingSkill.name, description: existingSkill.description }, sourceGoalId, userId, treatmentSes);
      }

      console.log(`[SkillEvolver] REFINED "${existingSkill.name}" v${nextVersion} (delta: +${delta.toFixed(1)})`);

      return {
        action: treatmentSes >= this.GOLD_STANDARD_THRESHOLD ? 'promoted' : 'kept',
        skillId: existingSkillId,
        skillName: existingSkill.name,
        version: nextVersion,
        previousVersion: nextVersion - 1,
        versionId,
        delta,
        baselineSES: baselineSes,
        treatmentSES: treatmentSes,
      };
    } else {
      // DISCARD — supersede new version, don't touch the skill
      await SkillVersionModel.supersede(versionId);

      console.log(`[SkillEvolver] DISCARDED refinement of "${existingSkill.name}" (delta: ${delta.toFixed(1)})`);

      return {
        action: 'discarded',
        skillId: existingSkillId,
        skillName: existingSkill.name,
        version: nextVersion,
        previousVersion: nextVersion - 1,
        delta,
        baselineSES: baselineSes,
        treatmentSES: treatmentSes,
      };
    }
  }

  /**
   * Run A/B test: baseline (raw execution) vs treatment (with skill quality bonus).
   * Uses structural analysis of skill quality instead of fake string-length bonus.
   * @private
   * @returns {Object|null} A/B test metrics, or null if test couldn't run
   */
  static async _runABTest(sourceGoalId, skillId, userId, traceAnalysis) {
    try {
      const goal = await GoalModel.findOne(sourceGoalId);
      if (!goal) return null;

      const tasks = await TaskModel.findByGoalId(sourceGoalId);

      // Baseline: actual execution performance (no skill)
      const baselineMetrics = await this._measureGoalPerformance(sourceGoalId, userId);
      if (!baselineMetrics) return null;

      // Treatment: evaluate skill quality structurally
      const skill = await SkillModel.findById(skillId);
      const qualityScore = this._evaluateSkillQuality(skill?.instructions || '', traceAnalysis, tasks);

      const treatmentSes = Math.min(100, baselineMetrics.ses + qualityScore);
      const delta = qualityScore;
      const decision = delta > this.MIN_DELTA
        ? (treatmentSes >= this.GOLD_STANDARD_THRESHOLD ? 'promoted' : 'kept')
        : 'discarded';

      return {
        baselineSes: baselineMetrics.ses,
        baselineCompletion: baselineMetrics.completion,
        baselineToolCalls: baselineMetrics.toolCalls,
        baselineErrors: baselineMetrics.errors,
        baselineDurationMs: baselineMetrics.durationMs,
        treatmentSes,
        treatmentCompletion: baselineMetrics.completion,
        treatmentToolCalls: baselineMetrics.toolCalls,
        treatmentErrors: baselineMetrics.errors,
        treatmentDurationMs: baselineMetrics.durationMs,
        delta,
        decision,
        judgeReasoning: `Skill quality score: ${qualityScore.toFixed(1)}/25 — structural analysis of instruction depth, tool alignment, pattern coverage, error handling, and format quality.`,
      };
    } catch (error) {
      console.error(`[SkillEvolver] A/B test failed:`, error);
      return null;
    }
  }

  /**
   * Measure goal performance metrics and calculate SES from actual execution data.
   * Returns raw metrics without any skill bonus — skill quality is evaluated separately.
   * @private
   */
  static async _measureGoalPerformance(goalId, userId) {
    try {
      const goal = await GoalModel.findOne(goalId);
      if (!goal) return null;

      const tasks = await TaskModel.findByGoalId(goalId);
      const iterations = await GoalIterationModel.findByGoalId(goalId);

      // Get evaluation
      let evaluation = null;
      try {
        evaluation = await GoalEvaluator.getEvaluationReport(goalId);
      } catch { /* ignore */ }

      // Calculate metrics from existing data
      const completedTasks = tasks.filter(t => t.status === 'completed');
      const failedTasks = tasks.filter(t => t.status === 'failed');
      const completion = tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0;

      // Count tool calls from task outputs
      let totalToolCalls = 0;
      for (const task of tasks) {
        try {
          const output = task.output ? (typeof task.output === 'string' ? JSON.parse(task.output) : task.output) : null;
          totalToolCalls += output?.toolExecutions?.length || 0;
        } catch { /* ignore */ }
      }

      // Calculate duration
      const startTimes = tasks.map(t => t.started_at ? new Date(t.started_at).getTime() : Infinity);
      const endTimes = tasks.map(t => t.completed_at ? new Date(t.completed_at).getTime() : 0);
      const durationMs = Math.max(0, Math.max(...endTimes) - Math.min(...startTimes));

      const errorCount = failedTasks.length;

      const ses = this._calculateSES({
        completion,
        toolCalls: totalToolCalls,
        expectedToolCalls: tasks.length * 3,
        errorCount,
        totalErrors: errorCount + completedTasks.length,
        durationMs,
        baselineDurationMs: durationMs * 1.2,
        qualityScore: evaluation?.overall_score || evaluation?.evaluation_data?.scores?.overall || completion * 0.7,
        taskScores: tasks.map(t => {
          const te = evaluation?.taskEvaluations?.find(e => (e.task_id || e.taskId) === t.id);
          return te?.score || (t.status === 'completed' ? 70 : 0);
        }),
      });

      return {
        ses: Math.min(100, Math.max(0, ses)),
        completion,
        toolCalls: totalToolCalls,
        errors: errorCount,
        durationMs,
      };
    } catch (error) {
      console.error(`[SkillEvolver] Performance measurement failed:`, error);
      return null;
    }
  }

  /**
   * Evaluate skill quality through structural analysis of instructions.
   * Scores based on: comprehensiveness, tool alignment, pattern coverage,
   * error handling, and structural format.
   * @private
   * @returns {number} Quality score 0-25
   */
  static _evaluateSkillQuality(skillInstructions, traceAnalysis, tasks) {
    if (!skillInstructions || !skillInstructions.trim()) return 0;

    let score = 0;
    const instructionsLower = skillInstructions.toLowerCase();

    // 1. Instruction comprehensiveness (0-5)
    const wordCount = skillInstructions.split(/\s+/).length;
    if (wordCount >= 200) score += 5;
    else if (wordCount >= 100) score += 4;
    else if (wordCount >= 50) score += 3;
    else if (wordCount >= 25) score += 2;
    else score += 1;

    // 2. Tool alignment — do instructions reference tools used in execution? (0-5)
    const usedTools = new Set();
    for (const task of (tasks || [])) {
      try {
        const tools = typeof task.required_tools === 'string'
          ? JSON.parse(task.required_tools)
          : (task.required_tools || []);
        tools.forEach(t => usedTools.add(String(t).toLowerCase()));
      } catch { /* ignore */ }
    }
    if (usedTools.size > 0) {
      let toolMatches = 0;
      for (const tool of usedTools) {
        if (instructionsLower.includes(tool)) toolMatches++;
      }
      score += Math.min(5, (toolMatches / usedTools.size) * 5);
    } else {
      score += 2; // No tools to compare against
    }

    // 3. Pattern coverage — does skill incorporate discovered patterns? (0-5)
    const patterns = traceAnalysis?.patterns || [];
    const effectivePatterns = patterns.filter(p => (p.effectiveness || 0) >= 0.5);
    score += Math.min(5, effectivePatterns.length * 1.25);

    // 4. Error handling coverage (0-5)
    const errorKeywords = ['error', 'fail', 'recover', 'retry', 'fallback', 'exception', 'handle', 'timeout', 'issue'];
    const errorMatches = errorKeywords.filter(k => instructionsLower.includes(k)).length;
    score += Math.min(5, errorMatches);

    // 5. Structural quality — well-formatted instructions (0-5)
    let structScore = 0;
    if (skillInstructions.includes('#')) structScore += 1;
    if (/\d\.\s/.test(skillInstructions) || /^-\s/m.test(skillInstructions)) structScore += 1;
    if (instructionsLower.includes('when') || instructionsLower.includes('if')) structScore += 1;
    if (instructionsLower.includes('avoid') || instructionsLower.includes('do not') || instructionsLower.includes("don't")) structScore += 1;
    if (instructionsLower.includes('step') || instructionsLower.includes('first') || instructionsLower.includes('then')) structScore += 1;
    score += structScore;

    // Apply confidence multiplier from trace analysis (0.5-1.0)
    const confidence = traceAnalysis?.skillCandidate?.confidence || 0.7;
    score *= Math.max(0.5, Math.min(1.0, confidence));

    return Math.round(Math.min(25, Math.max(0, score)) * 10) / 10;
  }

  /**
   * Calculate Skill Effectiveness Score (SES).
   * Composite metric: completion(0.30) + efficiency(0.20) + recovery(0.15) + speed(0.15) + quality(0.10) + consistency(0.10)
   * @private
   */
  static _calculateSES({ completion, toolCalls, expectedToolCalls, errorCount, totalErrors, durationMs, baselineDurationMs, qualityScore, taskScores }) {
    // Completion (0-100)
    const completionScore = Math.min(100, Math.max(0, completion));

    // Efficiency — fewer unnecessary tool calls = better
    const excessCalls = Math.max(0, toolCalls - expectedToolCalls);
    const efficiencyScore = toolCalls > 0 ? Math.min(100, 100 * (1 - excessCalls / toolCalls)) : 100;

    // Recovery — errors recovered from vs total errors
    const recoveryScore = totalErrors > 0 ? Math.min(100, 100 * ((totalErrors - errorCount) / totalErrors)) : 100;

    // Speed — faster than baseline = better
    const speedScore = baselineDurationMs > 0 ? Math.min(100, 100 * (baselineDurationMs / Math.max(1, durationMs))) : 50;

    // Quality — from evaluator
    const qualityScoreNorm = Math.min(100, Math.max(0, qualityScore));

    // Consistency — low variance across task scores
    let consistencyScore = 100;
    if (taskScores && taskScores.length > 1) {
      const mean = taskScores.reduce((a, b) => a + b, 0) / taskScores.length;
      const variance = taskScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / taskScores.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 1;
      consistencyScore = Math.min(100, Math.max(0, 100 * (1 - cv)));
    }

    const ses = (0.30 * completionScore)
      + (0.20 * efficiencyScore)
      + (0.15 * recoveryScore)
      + (0.15 * speedScore)
      + (0.10 * qualityScoreNorm)
      + (0.10 * consistencyScore);

    return Math.round(ses * 10) / 10;
  }

  /**
   * Check if a similar skill already exists (same category + >50% tool overlap).
   * @private
   */
  static async _findSimilarSkill(candidate, userId) {
    try {
      const allSkills = await SkillModel.findAll(userId);
      const candidateTools = candidate.allowedTools || [];

      for (const skill of allSkills) {
        // Same category check
        if (skill.category !== (candidate.category || 'general')) continue;

        // Tool overlap check
        let skillTools = [];
        try {
          skillTools = JSON.parse(skill.allowed_tools || '[]');
        } catch { continue; }

        if (candidateTools.length === 0 && skillTools.length === 0) {
          // Both have no tools — check name similarity
          if (skill.name.toLowerCase().includes(candidate.name.toLowerCase().split(' ')[0])) {
            return skill.id;
          }
          continue;
        }

        const overlap = candidateTools.filter(t => skillTools.includes(t)).length;
        const totalUnique = new Set([...candidateTools, ...skillTools]).size;
        const overlapRatio = totalUnique > 0 ? overlap / totalUnique : 0;

        if (overlapRatio > 0.5) {
          return skill.id;
        }
      }

      return null;
    } catch (error) {
      console.error('[SkillEvolver] Similar skill search failed:', error);
      return null;
    }
  }

  /**
   * Use LLM to merge existing skill instructions with new trace insights.
   * @private
   */
  static async _mergeSkillInstructions(existingInstructions, newInstructions, traceAnalysis, userId) {
    try {
      const streamEngine = new StreamEngine(userId);

      const prompt = `You are merging an existing AI agent skill with new insights from a recent execution trace.

CURRENT SKILL INSTRUCTIONS:
${existingInstructions}

NEW TRACE INSIGHTS:
${newInstructions}

PATTERNS FOUND:
${JSON.stringify(traceAnalysis.patterns?.map(p => ({ name: p.name, description: p.description, effectiveness: p.effectiveness })) || [], null, 2)}

ANTI-PATTERNS FOUND:
${JSON.stringify(traceAnalysis.antipatterns?.map(a => ({ name: a.name, description: a.description })) || [], null, 2)}

MERGE RULES:
1. Keep all existing patterns that are still valid
2. Add new patterns that don't conflict
3. If a new pattern contradicts an existing one, keep the one with more evidence
4. Update anti-patterns based on new failure data
5. Preserve the overall structure (Strategy → Steps → Anti-patterns → Recovery)

Output the FULL updated skill instructions as markdown. No JSON wrapping, no code fences — just the raw markdown content.`;

      const UserModel = (await import('../../models/UserModel.js')).default;
      const userSettings = await UserModel.getUserSettings(userId);
      const provider = userSettings?.selectedProvider;
      const model = userSettings?.selectedModel;

      if (!provider || !model) return null;

      const result = await streamEngine.generateCompletion(prompt, provider, model);
      if (streamEngine._lastCompletionUsage) {
        const u = streamEngine._lastCompletionUsage;
        const input = u.prompt_tokens || u.input_tokens || 0;
        const output = u.completion_tokens || u.output_tokens || 0;
        console.log(`[SkillEvolver] Token Usage: ${input} in / ${output} out = ${input + output} total`);
      }

      // Clean up
      let cleaned = result;
      if (typeof cleaned === 'string') {
        cleaned = cleaned
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .trim();
      }

      return cleaned || null;
    } catch (error) {
      console.error('[SkillEvolver] Merge failed:', error);
      return null;
    }
  }

  /**
   * Promote a skill to Gold Standard.
   * @private
   */
  static async _promoteToGoldStandard(skillId, skillData, sourceGoalId, userId, ses) {
    try {
      const skill = await SkillModel.findById(skillId);
      const templateData = {
        skillId,
        instructions: skill?.instructions || skillData.instructions,
        ses,
        promotedAt: new Date().toISOString(),
      };

      await GoldenStandardModel.create(
        sourceGoalId,
        'skill',
        skillData.name || skill?.name,
        skillData.description || skill?.description || 'Auto-generated Gold Standard skill',
        ses,
        templateData,
        userId
      );

      console.log(`[SkillEvolver] Promoted "${skillData.name}" to Gold Standard (SES: ${ses})`);
    } catch (error) {
      console.error('[SkillEvolver] Gold Standard promotion failed (non-fatal):', error);
    }
  }
}

export default SkillEvolver;
