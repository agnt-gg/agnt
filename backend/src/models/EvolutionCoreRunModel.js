import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * EvolutionCoreRunModel
 *
 * Stores receipts for CoreEvolutionSystem runs so we can trend:
 * - baseline vs best score
 * - delta over time
 * - what genome was recommended/applied
 * - what signal existed (pendingInsightsConsidered, weights/biases)
 */
class EvolutionCoreRunModel {
  static create({
    userId,
    applyRequested = false,
    applied = false,
    lookbackDays = 7,
    pendingInsightsConsidered = 0,
    baselineScore = null,
    bestScore = null,
    delta = null,
    snapshotScore = null,
    weights = null,
    biases = null,
    genome = null,
    counts = null,
    recommendation = null,
    notes = null,
  } = {}) {
    const id = generateUUID();
    const now = new Date().toISOString();

    const toJson = (v) => {
      if (v === undefined) return null;
      if (v === null) return null;
      try { return JSON.stringify(v); } catch { return null; }
    };

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO evolution_core_runs
          (id, user_id, apply_requested, applied, lookback_days, pending_insights_considered,
           baseline_score, best_score, delta, snapshot_score,
           weights_json, biases_json, genome_json, counts_json, recommendation_json,
           notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          id,
          userId,
          applyRequested ? 1 : 0,
          applied ? 1 : 0,
          Number(lookbackDays) || 7,
          Number(pendingInsightsConsidered) || 0,
          typeof baselineScore === 'number' ? baselineScore : null,
          typeof bestScore === 'number' ? bestScore : null,
          typeof delta === 'number' ? delta : null,
          typeof snapshotScore === 'number' ? snapshotScore : null,
          toJson(weights),
          toJson(biases),
          toJson(genome),
          toJson(counts),
          toJson(recommendation),
          notes,
          now,
        ],
        (err) => err ? reject(err) : resolve(id)
      );
    });
  }

  static findRecentByUser(userId, { limit = 200 } = {}) {
    const lim = Math.max(1, Math.min(Number(limit) || 200, 2000));
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM evolution_core_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, lim],
        (err, rows) => {
          if (err) return reject(err);
          const parsed = (rows || []).map((r) => {
            const parse = (k) => {
              try { return r[k] ? JSON.parse(r[k]) : null; } catch { return null; }
            };
            return {
              ...r,
              apply_requested: !!r.apply_requested,
              applied: !!r.applied,
              weights: parse('weights_json'),
              biases: parse('biases_json'),
              genome: parse('genome_json'),
              counts: parse('counts_json'),
              recommendation: parse('recommendation_json'),
            };
          });
          resolve(parsed);
        }
      );
    });
  }
}

export default EvolutionCoreRunModel;
