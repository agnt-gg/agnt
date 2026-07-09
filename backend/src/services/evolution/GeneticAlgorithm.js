import AutonomyPolicy from './AutonomyPolicy.js';

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function randBetween(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * GeneticAlgorithm
 *
 * Minimal GA for evolving EvolutionSettingsModel.autonomy parameters.
 *
 * Safety posture:
 * - Never enables autonomy if it was disabled.
 * - Keeps parameters within conservative bounds.
 */
class GeneticAlgorithm {
  static bounds() {
    return {
      minConfidence: [0.65, 0.95],
      minDelta: [0.02, 0.15],
      maxBlastRadius: [0.2, 0.7],
      requireGateAbove: [0.25, 0.75],
      dailyBudget: [5, 200],
    };
  }

  static normalizeGenome(genome, baseAutonomy) {
    const b = this.bounds();
    const g = { ...(baseAutonomy || {}), ...(genome || {}) };

    g.enabled = !!(baseAutonomy && baseAutonomy.enabled); // never flip on
    g.minConfidence = round3(clamp(Number(g.minConfidence), ...b.minConfidence));
    g.minDelta = round3(clamp(Number(g.minDelta), ...b.minDelta));
    g.maxBlastRadius = round3(clamp(Number(g.maxBlastRadius), ...b.maxBlastRadius));
    g.requireGateAbove = round3(clamp(Number(g.requireGateAbove), ...b.requireGateAbove));
    g.dailyBudget = Math.round(clamp(Number(g.dailyBudget), ...b.dailyBudget));

    // Invariant: requireGateAbove cannot exceed maxBlastRadius by too much.
    // If gating threshold > maxBlastRadius, nothing gets gated (it escalates).
    // Keep it at most maxBlastRadius.
    if (g.requireGateAbove > g.maxBlastRadius) {
      g.requireGateAbove = g.maxBlastRadius;
    }

    // Preserve allowedCategories if present
    if (Array.isArray(baseAutonomy?.allowedCategories) && !Array.isArray(g.allowedCategories)) {
      g.allowedCategories = baseAutonomy.allowedCategories;
    }

    return g;
  }

  static randomGenome(baseAutonomy, biases = {}) {
    const b = this.bounds();
    const g = {
      minConfidence: biases.minConfidence ?? randBetween(...b.minConfidence),
      minDelta: biases.minDelta ?? randBetween(...b.minDelta),
      maxBlastRadius: biases.maxBlastRadius ?? randBetween(...b.maxBlastRadius),
      requireGateAbove: biases.requireGateAbove ?? randBetween(...b.requireGateAbove),
      dailyBudget: biases.dailyBudget ?? Math.round(randBetween(...b.dailyBudget)),
    };
    return this.normalizeGenome(g, baseAutonomy);
  }

  static crossover(a, b, baseAutonomy) {
    const child = {
      minConfidence: Math.random() < 0.5 ? a.minConfidence : b.minConfidence,
      minDelta: Math.random() < 0.5 ? a.minDelta : b.minDelta,
      maxBlastRadius: Math.random() < 0.5 ? a.maxBlastRadius : b.maxBlastRadius,
      requireGateAbove: Math.random() < 0.5 ? a.requireGateAbove : b.requireGateAbove,
      dailyBudget: Math.random() < 0.5 ? a.dailyBudget : b.dailyBudget,
    };
    return this.normalizeGenome(child, baseAutonomy);
  }

  static mutate(genome, baseAutonomy, rate = 0.2) {
    const b = this.bounds();
    const g = { ...genome };

    function maybeMutate(key, lo, hi, isInt = false) {
      if (Math.random() > rate) return;
      const span = hi - lo;
      const step = span * 0.1; // 10% move
      const dir = Math.random() < 0.5 ? -1 : 1;
      const next = Number(g[key]) + dir * randBetween(0, step);
      g[key] = isInt ? Math.round(clamp(next, lo, hi)) : round3(clamp(next, lo, hi));
    }

    maybeMutate('minConfidence', ...b.minConfidence);
    maybeMutate('minDelta', ...b.minDelta);
    maybeMutate('maxBlastRadius', ...b.maxBlastRadius);
    maybeMutate('requireGateAbove', ...b.requireGateAbove);
    maybeMutate('dailyBudget', ...b.dailyBudget, true);

    return this.normalizeGenome(g, baseAutonomy);
  }

  /**
   * Fitness function: simulate AutonomyPolicy decisions on a set of pending insights.
   * Returns score in [0, 1].
   */
  static fitness({ genome, baseSettings, insights = [], weights = {} } = {}) {
    const autonomyBase = AutonomyPolicy.merged(baseSettings || {});
    const candidate = this.normalizeGenome(genome, autonomyBase);

    const w = {
      throughput: weights.throughput ?? 1.0,
      safety: weights.safety ?? 1.1,
      reliability: weights.reliability ?? 1.0,
    };

    let direct = 0;
    let gated = 0;
    let escalated = 0;
    let skipped = 0;
    let blastSum = 0;
    let blastCount = 0;

    for (const insight of insights) {
      const verdict = AutonomyPolicy.evaluate(insight, { autonomy: candidate }, { budgetExhausted: false });
      if (verdict.decision === 'direct') {
        direct++;
        blastSum += verdict.blastRadius;
        blastCount++;
      } else if (verdict.decision === 'gated') {
        gated++;
        blastSum += verdict.blastRadius;
        blastCount++;
      } else if (verdict.decision === 'escalate') {
        escalated++;
      } else {
        skipped++;
      }
    }

    const total = Math.max(1, insights.length);
    const throughput = (direct + 0.5 * gated) / total;
    const escalationRate = escalated / total;
    const avgBlast = blastCount ? blastSum / blastCount : 0;

    // Safety: penalize high blast radius.
    const safety = 1 - clamp(avgBlast / 1.0, 0, 1);

    // Reliability proxy: don't suggest widening autonomy too much.
    const conservatism = clamp((0.95 - candidate.minConfidence) / 0.3, 0, 1); // lower confidence => less conservative
    const reliability = 1 - conservatism;

    // Composite
    const raw =
      (w.throughput * throughput) +
      (w.safety * safety) +
      (w.reliability * reliability) -
      (0.6 * escalationRate);

    // Normalize to [0,1] (raw upper bound ~3.3)
    const score = clamp(raw / 3.3, 0, 1);

    return {
      score: round3(score),
      components: {
        throughput: round3(throughput),
        escalationRate: round3(escalationRate),
        avgBlast: round3(avgBlast),
        safety: round3(safety),
        reliability: round3(reliability),
      },
      counts: { direct, gated, escalated, skipped, total },
      genome: candidate,
    };
  }

  static evolve({ baseSettings, insights, biases, weights, populationSize = 24, generations = 10, eliteCount = 6 } = {}) {
    const autonomyBase = AutonomyPolicy.merged(baseSettings || {});

    let population = Array.from({ length: populationSize }, () => this.randomGenome(autonomyBase, biases));

    let best = null;
    for (let gen = 0; gen < generations; gen++) {
      const scored = population
        .map((g) => this.fitness({ genome: g, baseSettings, insights, weights }))
        .sort((a, b) => b.score - a.score);

      best = best ? (scored[0].score > best.score ? scored[0] : best) : scored[0];

      const elites = scored.slice(0, eliteCount).map((s) => s.genome);
      const next = [...elites];

      while (next.length < populationSize) {
        const a = elites[Math.floor(Math.random() * elites.length)];
        const b = elites[Math.floor(Math.random() * elites.length)];
        let child = this.crossover(a, b, autonomyBase);
        child = this.mutate(child, autonomyBase, 0.25);
        next.push(child);
      }
      population = next;
    }

    return best;
  }
}

export default GeneticAlgorithm;
