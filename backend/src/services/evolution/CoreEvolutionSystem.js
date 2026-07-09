import EvolutionSettingsModel from '../../models/EvolutionSettingsModel.js';
import InsightModel from '../../models/InsightModel.js';
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
      delta: Math.round(delta * 1000) / 1000,
      applied: false,
    };

    if (apply) {
      // IMPORTANT: never flip autonomy.enabled on as part of evolution.
      const nextAutonomy = { ...(currentSettings.autonomy || {}), ...best.genome, enabled: !!currentSettings.autonomy?.enabled };
      const updated = await EvolutionSettingsModel.update(userId, { autonomy: nextAutonomy });
      recommendation.applied = true;
      recommendation.updatedSettings = { autonomy: updated.autonomy };
    }

    return recommendation;
  }
}

export default CoreEvolutionSystem;
