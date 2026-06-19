/**
 * VerifierGate — single safety primitive for "is this candidate better than the baseline?"
 * PRD-091 Layer 2.
 *
 * Extracted from ExperimentService.analyzeResults + validateConstraints so the
 * router (Layer 4), the Arena (Layer 6), the SkillEvolver, and ExperimentService
 * all hit one place when promoting a mutation. Change the safety bar here once.
 */

export const DEFAULT_MIN_DELTA = 0.05;

const COMPOSITE_WEIGHTS = { correctness: 0.5, procedureFollowing: 0.3, conciseness: 0.2 };

export function calculateComposite(scores) {
  const raw =
    (COMPOSITE_WEIGHTS.correctness * (scores.correctness || 0)) +
    (COMPOSITE_WEIGHTS.procedureFollowing * (scores.procedureFollowing || 0)) +
    (COMPOSITE_WEIGHTS.conciseness * (scores.conciseness || 0));
  return Math.round(raw * 1000) / 1000;
}

function avgMetrics(runs) {
  if (!runs || !runs.length) {
    return { correctness: 0, procedureFollowing: 0, conciseness: 0, composite: 0 };
  }
  const sum = runs.reduce((acc, r) => {
    const m = r.metrics || r;
    acc.correctness += m.correctness || 0;
    acc.procedureFollowing += m.procedureFollowing || 0;
    acc.conciseness += m.conciseness || 0;
    acc.composite += m.composite || 0;
    return acc;
  }, { correctness: 0, procedureFollowing: 0, conciseness: 0, composite: 0 });
  const n = runs.length;
  return {
    correctness: sum.correctness / n,
    procedureFollowing: sum.procedureFollowing / n,
    conciseness: sum.conciseness / n,
    composite: sum.composite / n,
  };
}

class VerifierGate {
  /**
   * Constraint gates over candidate text (size, growth, structure).
   * Lifted from ExperimentService.validateConstraints; usable on any text-based
   * artifact (skill instructions, system prompts, contract predicates).
   */
  static validateConstraints(candidateText, baselineText, opts = {}) {
    const sizeLimit = opts.sizeLimit ?? 15360;
    const growthLimit = opts.growthLimit ?? 0.2;
    const requireStructure = opts.requireStructure ?? true;
    const results = [];

    if (typeof candidateText === 'string') {
      results.push({
        name: 'size_limit',
        passed: candidateText.length <= sizeLimit,
        message: `${candidateText.length}/${sizeLimit} chars`,
      });

      if (baselineText && typeof baselineText === 'string' && baselineText.length > 0) {
        const growth = (candidateText.length - baselineText.length) / baselineText.length;
        results.push({
          name: 'growth_limit',
          passed: growth <= growthLimit,
          message: `${(growth * 100).toFixed(1)}% growth (max ${(growthLimit * 100).toFixed(0)}%)`,
        });
      }

      results.push({
        name: 'non_empty',
        passed: candidateText.trim().length > 0,
        message: candidateText.trim().length > 0 ? 'Non-empty' : 'Empty candidate',
      });

      if (requireStructure) {
        const hasHeaders = candidateText.includes('#');
        const hasSteps = /\d\.\s/.test(candidateText) || /^-\s/m.test(candidateText);
        results.push({
          name: 'structure',
          passed: hasHeaders && hasSteps,
          message: hasHeaders && hasSteps ? 'Valid structure' : 'Missing headers or steps',
        });
      }
    }

    return results;
  }

  /**
   * Verify a candidate against a baseline.
   *
   * Two input modes:
   *   (a) Pre-computed metrics: pass `controlMetrics` and `treatmentMetrics`
   *       (objects with composite/correctness/procedureFollowing/conciseness).
   *   (b) Per-example runs: pass `controlRuns` and `treatmentRuns` arrays;
   *       each run has `metrics: {...}`. We average then verdict.
   *
   * Optional `candidateText` / `baselineText` runs constraint validation.
   *
   * @returns {{
   *   pass: boolean,
   *   delta: number,
   *   decision: 'keep'|'iterate'|'discard',
   *   confidence: number,
   *   controlAvgSes: number,
   *   treatmentAvgSes: number,
   *   perDimension: object,
   *   constraintResults: Array,
   *   allGatesPass: boolean,
   *   reasoning: string
   * }}
   */
  static verify({
    controlMetrics,
    treatmentMetrics,
    controlRuns,
    treatmentRuns,
    candidateText,
    baselineText,
    minDelta = DEFAULT_MIN_DELTA,
    constraintOpts,
  } = {}) {
    const control = controlMetrics || avgMetrics(controlRuns || []);
    const treatment = treatmentMetrics || avgMetrics(treatmentRuns || []);

    // Ensure composites exist (callers may pass raw dimension scores only).
    if (control.composite === undefined) control.composite = calculateComposite(control);
    if (treatment.composite === undefined) treatment.composite = calculateComposite(treatment);

    const delta = treatment.composite - control.composite;
    const sampleSize = (controlRuns?.length) || (treatmentRuns?.length) || 1;
    const confidence = Math.min(1, sampleSize / 5);

    const perDimension = {
      correctness: { control: control.correctness, treatment: treatment.correctness, delta: treatment.correctness - control.correctness },
      procedure: { control: control.procedureFollowing, treatment: treatment.procedureFollowing, delta: treatment.procedureFollowing - control.procedureFollowing },
      conciseness: { control: control.conciseness, treatment: treatment.conciseness, delta: treatment.conciseness - control.conciseness },
    };

    const constraintResults = candidateText
      ? this.validateConstraints(candidateText, baselineText, constraintOpts || {})
      : [];
    const allGatesPass = constraintResults.length === 0 || constraintResults.every((g) => g.passed);

    let decision;
    if (delta > minDelta && allGatesPass) decision = 'keep';
    else if (delta > minDelta && !allGatesPass) decision = 'iterate';
    else decision = 'discard';

    const pass = decision === 'keep';
    const reasoning = `Delta ${delta.toFixed(3)} vs threshold ${minDelta}. Gates: ${allGatesPass ? 'all passed' : 'some failed'}. Sample size: ${sampleSize}.`;

    return {
      pass,
      delta,
      decision,
      confidence,
      controlAvgSes: control.composite,
      treatmentAvgSes: treatment.composite,
      controlMetrics: control,
      treatmentMetrics: treatment,
      perDimension,
      constraintResults,
      allGatesPass,
      reasoning,
    };
  }
}

export default VerifierGate;
