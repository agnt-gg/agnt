import AutonomyPolicy from './AutonomyPolicy.js';

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * MetaCognitiveAssessor
 *
 * Converts telemetry snapshots into a small set of objective weights +
 * parameter biases for the genetic search.
 *
 * This is intentionally explainable and conservative.
 */
class MetaCognitiveAssessor {
  static assess({ performanceSnapshot, currentSettings } = {}) {
    const snapshot = performanceSnapshot || {};
    const insightsPending = snapshot?.insights?.pending || 0;
    const toolSuccessRate = snapshot?.tools?.successRate || 0;

    const autonomy = AutonomyPolicy.merged(currentSettings || {});

    // Heuristic signals
    const backlogHigh = insightsPending >= 50;
    const reliabilityLow = toolSuccessRate < 0.7;

    // Objective weights drive GA fitness.
    // - throughput: apply more low-blast insights
    // - safety: keep blast radius low
    // - reliability: don't widen autonomy when tools are failing a lot
    const weights = {
      throughput: backlogHigh ? 1.2 : 1.0,
      safety: reliabilityLow ? 1.4 : 1.1,
      reliability: reliabilityLow ? 1.3 : 1.0,
    };

    // Bias suggestions (GA uses as priors)
    const biases = {
      // If backlog is high, allow slightly lower confidence (still >= 0.65)
      minConfidence: backlogHigh ? clamp(autonomy.minConfidence - 0.05, 0.65, 0.95) : autonomy.minConfidence,
      // If reliability is low, tighten blast radius + require gate earlier
      maxBlastRadius: reliabilityLow ? clamp(autonomy.maxBlastRadius - 0.05, 0.2, 0.7) : autonomy.maxBlastRadius,
      requireGateAbove: reliabilityLow ? clamp(autonomy.requireGateAbove - 0.05, 0.25, 0.7) : autonomy.requireGateAbove,
      // If backlog high but reliable, allow higher daily budget
      dailyBudget: backlogHigh && !reliabilityLow ? clamp(autonomy.dailyBudget + 5, 5, 200) : autonomy.dailyBudget,
      minDelta: autonomy.minDelta,
    };

    const rationale = {
      backlogHigh,
      reliabilityLow,
      insightsPending,
      toolSuccessRate,
    };

    return { weights, biases, rationale };
  }
}

export default MetaCognitiveAssessor;
