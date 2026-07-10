import EvolutionSettingsModel from '../../models/EvolutionSettingsModel.js';
import InsightModel from '../../models/InsightModel.js';
import EvolutionCoreRunModel from '../../models/EvolutionCoreRunModel.js';
import PerformanceMonitor from './PerformanceMonitor.js';
import MetaCognitiveAssessor from './MetaCognitiveAssessor.js';
import GeneticAlgorithm from './GeneticAlgorithm.js';

/**
 * CoreEvolutionSystem
 *
 * The minimal "built-in" evolution loop that does three things:
 *  1) Performance monitoring (telemetry snapshot)
 *  2) Meta-cognitive assessment (objective weights + parameter biases)
 *  3) Genetic search over autonomy policy parameters (recommendation-first)
 *
 * This does NOT grant new authority. It only recommends (or optionally applies)
 * EvolutionSettings.autonomy parameter updates.
 */
class CoreEvolutionSystem {
  static async runForUser(userId, {
    lookbackDays = 7,
    pendingInsightLimit = 250,
    populationSize = 24,
    generations = 10,
    eliteCount = 6,
    apply = false,
  } = {}) {
    const currentSettings = await EvolutionSettingsModel.get(userId);

    // 1) Performance monitoring
    const performanceSnapshot = await PerformanceMonitor.snapshotUser(userId, {
      lookbackDays,
      toolLimit: 15,
      persist: true,
    });

    // 2) Meta-cognitive assessment
    const assessment = MetaCognitiveAssessor.assess({ performanceSnapshot, currentSettings });

    // 3) Genetic search input: pending insights are the best proxy for "what could we apply safely".
    const pendingInsights = await InsightModel.findByUserId(userId, { status: 'pending', limit: pendingInsightLimit });

    // The AutonomyPolicy expects keys: category, target_type, confidence, blast_radius.
    const simInsights = (pendingInsights || []).map((i) => ({
      category: i.category,
      target_type: i.target_type,
      confidence: i.confidence,
      blast_radius: i.blast_radius,
    }));

    const best = GeneticAlgorithm.evolve({
      baseSettings: currentSettings,
      insights: simInsights,
      biases: assessment.biases,
      weights: assessment.weights,
      populationSize,
      generations,
      eliteCount,
    });

    // Build a "before" score for comparison.
    const baseline = GeneticAlgorithm.fitness({
      genome: currentSettings.autonomy,
      baseSettings: currentSettings,
      insights: simInsights,
      weights: assessment.weights,
    });

    const delta = best.score - baseline.score;
    const deltaRounded = Math.round(delta * 1000) / 1000;

    // Apply gate: never apply if the candidate fails to beat baseline.
    const minApplyDelta = 0.0;

    const recommendation = {
      schema: 'AGNT_CORE_EVOLUTION_RECOMMENDATION.v0.1',
      userId,
      generatedAt: new Date().toISOString(),
      lookbackDays,
      pendingInsightsConsidered: simInsights.length,
      performanceSnapshot,
      assessment,
      baseline,
      best,
      delta: deltaRounded,
      applied: false,
    };


    // Persist receipt for this run (baseline/best/delta + genome + counts)
    try {
      await EvolutionCoreRunModel.create({
        userId,
        applyRequested: !!apply,
        applied: false,
        lookbackDays,
        pendingInsightsConsidered: simInsights.length,
        baselineScore: baseline.score,
        bestScore: best.score,
        delta: recommendation.delta,
        snapshotScore: performanceSnapshot.score,
        weights: assessment.weights,
        biases: assessment.biases,
        genome: best.genome,
        counts: best.counts,
        recommendation,
      });
    } catch (e) {
      // non-critical
    }    if (apply && recommendation.delta >= minApplyDelta) {
      // IMPORTANT: CoreEvolutionSystem does NOT write EvolutionSettings directly.
      // Instead, route a parameter_tune insight through the existing AutonomyRouter
      // so we get consistent direct/gated/escalate behavior + Arena hook.
      const patch = best.genome;

      const title = 'Core evolution: tune autonomy parameters';
      const desc = `Proposed autonomy parameter tune (delta=${recommendation.delta}). Routed via InsightAutonomyRouter; will only apply if autonomy is enabled + category allowed + policy permits.`;

      const applyInsightId = await InsightModel.create({
        userId,
        sourceType: 'core_evolution',
        sourceId: 'core_run',
        sourceContext: { lookbackDays, baseline: baseline.score, best: best.score, delta: recommendation.delta },
        targetType: 'evolution_settings',
        targetId: userId,
        category: 'parameter_tune',
        title,
        description: desc,
        evidence: { autonomyPatch: patch, baseline: baseline.score, best: best.score, delta: recommendation.delta },
        confidence: 0.75,
      });

      recommendation.applyInsightId = applyInsightId;

      let routeResult = null;
      try {
        const InsightAutonomyRouter = (await import('./InsightAutonomyRouter.js')).default;
        routeResult = await InsightAutonomyRouter.route(applyInsightId, userId, { mode: 'gated_only' });
      } catch (e) {
        routeResult = { decision: 'skip', reason: 'router_error', error: e.message };
      }

      recommendation.applyRouted = routeResult;
      recommendation.applied = !!routeResult?.applied;
      if (routeResult?.applied && routeResult?.result?.autonomy) {
        recommendation.updatedSettings = { autonomy: routeResult.result.autonomy };
      }

      // Persist a second receipt when apply was requested so we can audit routing outcome.
      try {
        await EvolutionCoreRunModel.create({
          userId,
          applyRequested: true,
          applied: recommendation.applied,
          lookbackDays,
          pendingInsightsConsidered: simInsights.length,
          baselineScore: baseline.score,
          bestScore: best.score,
          delta: recommendation.delta,
          snapshotScore: performanceSnapshot.score,
          weights: assessment.weights,
          biases: assessment.biases,
          genome: patch,
          counts: best.counts,
          recommendation,
          notes: `routed:${routeResult?.decision || 'unknown'}:${routeResult?.reason || ''}`,
        });
      } catch (e) {
        // non-critical
      }
    }

    if (apply && !recommendation.applied) {
      recommendation.apply_blocked = true;
      recommendation.apply_block_reason = 'delta_below_threshold';
      recommendation.apply_block_min_delta = minApplyDelta;
    }

    return recommendation;
  }
}

export default CoreEvolutionSystem;
