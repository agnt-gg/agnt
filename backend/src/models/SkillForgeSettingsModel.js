import db from './database/index.js';

const DEFAULT_SETTINGS = {
  // ON by default. This flag gates skill evolution on goal completion, and the
  // only component that ever rendered a toggle for it (screens/SkillForge) was
  // orphaned when SkillForge was folded into the Skills screen — no route, no
  // import, no reference. Defaulting it off therefore meant "permanently off for
  // every user, unreachable except by hand-POSTing /skillforge/settings", which
  // is indistinguishable from the feature not existing. The guards below
  // (minScore, minTasks, minConfidence) are the real safety net.
  autoAnalyze: true,
  abTestTimeBudgetMs: 300000,
  minConfidence: 0.7,
  minDelta: 2.0,
  goldStandardThreshold: 90,
  minTasks: 1,
  minIterations: 0,
  minScore: 30,
};

class SkillForgeSettingsModel {
  static get(userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT settings FROM skillforge_settings WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else {
          try {
            const saved = row ? JSON.parse(row.settings) : {};
            resolve({ ...DEFAULT_SETTINGS, ...saved });
          } catch {
            resolve({ ...DEFAULT_SETTINGS });
          }
        }
      });
    });
  }

  static async update(userId, newSettings) {
    const current = await this.get(userId);
    const merged = { ...current, ...newSettings };
    const json = JSON.stringify(merged);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO skillforge_settings (user_id, settings, updated_at) VALUES (?, ?, datetime('now'))`,
        [userId, json],
        (err) => {
          if (err) reject(err);
          else resolve(merged);
        }
      );
    });
  }
}

export default SkillForgeSettingsModel;
