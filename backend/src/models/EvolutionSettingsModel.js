import db from './database/index.js';

const DEFAULT_SETTINGS = {
  insightsEnabled: false,
  insightSources: {
    agent_chat: true,
    goal: true,
    workflow: true,
    tool_rollup: true,
  },
  autoApplyMemory: true,
};

class EvolutionSettingsModel {
  static get(userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT settings FROM evolution_settings WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else {
          try {
            const saved = row ? JSON.parse(row.settings) : {};
            // Deep merge insightSources
            const merged = {
              ...DEFAULT_SETTINGS,
              ...saved,
              insightSources: { ...DEFAULT_SETTINGS.insightSources, ...(saved.insightSources || {}) },
            };
            resolve(merged);
          } catch {
            resolve({ ...DEFAULT_SETTINGS });
          }
        }
      });
    });
  }

  static async update(userId, newSettings) {
    const current = await this.get(userId);
    const merged = {
      ...current,
      ...newSettings,
      insightSources: { ...current.insightSources, ...(newSettings.insightSources || {}) },
    };
    const json = JSON.stringify(merged);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO evolution_settings (user_id, settings, updated_at) VALUES (?, ?, datetime('now'))`,
        [userId, json],
        (err) => {
          if (err) reject(err);
          else resolve(merged);
        }
      );
    });
  }

  /**
   * Check if a specific insight source is enabled.
   * Returns true if insights are globally enabled AND the specific source is enabled.
   */
  static async isSourceEnabled(userId, sourceType) {
    const settings = await this.get(userId);
    if (!settings.insightsEnabled) return false;
    // Map source types to settings keys
    const keyMap = { agent_chat: 'agent_chat', goal: 'goal', workflow: 'workflow', tool_call: 'tool_rollup' };
    const key = keyMap[sourceType] || sourceType;
    return settings.insightSources[key] !== false;
  }
}

export default EvolutionSettingsModel;
