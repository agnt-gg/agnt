import db from './database/index.js';
import { parseFallbackChain, serializeFallbackChain } from '../services/orchestrator/fallbackChain.js';
import {
  parsePreferences,
  mergePreferences,
  serializePreferences,
} from '../utils/userPreferences.js';

/**
 * Serializes preference read-modify-write per user.
 *
 * THE BUG THIS PREVENTS
 * ─────────────────────
 * Preferences are ONE JSON column, so an update is read → merge → write. Two
 * requests interleaving between the read and the write both start from the
 * same snapshot and the second write erases the first. That is not
 * theoretical here: the frontend saves theme and panel geometry from separate
 * watchers, so a single user action (switch theme while a panel animates)
 * fires two PUTs milliseconds apart. The loser vanishes with no error on
 * either side — the exact failure mode this whole feature exists to fix.
 *
 * A promise chain per user is sufficient because the backend is a single
 * process sharing one sqlite connection. It would NOT be sufficient across
 * processes; if AGNT ever forks workers, this has to become a real
 * `BEGIN IMMEDIATE` transaction. Documented rather than pre-solved, because a
 * transaction on node-sqlite3's shared connection serializes every other
 * writer too, and that is a real cost to pay for a hypothetical.
 */
const preferenceWriteQueues = new Map();

function withPreferenceLock(userId, task) {
  const prev = preferenceWriteQueues.get(userId) || Promise.resolve();
  // Swallow the predecessor's rejection: one failed write must not poison
  // every subsequent write for that user.
  const next = prev.catch(() => {}).then(task);
  preferenceWriteQueues.set(userId, next);
  // Drop the entry once drained so a long-lived process does not accumulate
  // one resolved promise per user forever.
  next.catch(() => {}).finally(() => {
    if (preferenceWriteQueues.get(userId) === next) preferenceWriteQueues.delete(userId);
  });
  return next;
}

/**
 * What each subscription seat costs per month (PRD-122), as
 * `{ providerKey: monthlyUsd }`.
 *
 * Tolerant on read and strict on write: a malformed or legacy value becomes
 * `{}` rather than throwing, because this is optional enrichment for one
 * dashboard panel and must never be able to break loading a user's settings.
 * Non-finite and negative amounts are dropped — a negative subscription fee is
 * not a thing, and letting one through would invert every figure derived from
 * it.
 */
function parseSubscriptionCosts(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [provider, amount] of Object.entries(parsed)) {
      const n = Number(amount);
      if (Number.isFinite(n) && n > 0) out[String(provider).toLowerCase()] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeSubscriptionCosts(value) {
  const clean = parseSubscriptionCosts(value);
  // An empty map is stored as NULL, so "never told us" and "told us nothing"
  // are the same state rather than two.
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

class UserModel {
  static getUserStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
          w.totalWorkflows,
          t.totalCustomTools,
          a.totalAgents,
          COALESCE(we.totalExecutions, 0) as totalExecutions,
          COALESCE(we.successfulExecutions, 0) as successfulExecutions,
          COALESCE(we.failedExecutions, 0) as failedExecutions,
          COALESCE(we.startedExecutions, 0) as startedExecutions,
          COALESCE(ne.totalNodeExecutions, 0) as totalNodeExecutions,
          COALESCE(ne.successfulNodeExecutions, 0) as successfulNodeExecutions,
          COALESCE(ne.failedNodeExecutions, 0) as failedNodeExecutions
        FROM
          (SELECT COUNT(*) as totalWorkflows FROM workflows WHERE user_id = ?) w,
          (SELECT COUNT(*) as totalCustomTools FROM tools WHERE created_by = ?) t,
          (SELECT COUNT(*) as totalAgents FROM agents WHERE created_by = ? AND id != 'orchestrator') a,
          (SELECT
            COUNT(*) as totalExecutions,
            SUM(status = 'completed') as successfulExecutions,
            SUM(status = 'error') as failedExecutions,
            SUM(status = 'started') as startedExecutions
          FROM workflow_executions WHERE user_id = ?) we,
          (SELECT
            COUNT(*) as totalNodeExecutions,
            SUM(ne.status = 'completed') as successfulNodeExecutions,
            SUM(ne.status = 'error') as failedNodeExecutions
          FROM node_executions ne
          JOIN workflow_executions e ON ne.execution_id = e.id
          WHERE e.user_id = ?) ne
        `,
        [userId, userId, userId, userId, userId],
        (err, row) => {
          if (err) reject(err);
          else {
            row.workflowStatuses = {
              complete: row.successfulExecutions,
              error: row.failedExecutions,
              started: row.startedExecutions,
            };
            resolve(row);
          }
        }
      );
    });
  }

  static getUserSettings(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT default_provider as selectedProvider, default_model as selectedModel, custom_instructions as customInstructions, async_tools_enabled as asyncToolsEnabled, tool_output_cap as toolOutputCap, max_tool_rounds as maxToolRounds, fallback_providers as fallbackProviders, fallback_enabled as fallbackEnabled, subscription_costs as subscriptionCosts
         FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve({
              selectedProvider: row.selectedProvider || 'Anthropic',
              selectedModel: row.selectedModel || 'claude-3-5-sonnet-20240620',
              customInstructions: row.customInstructions || '',
              // Stored as INTEGER (0/1) in SQLite. Coerce to boolean for the
              // API layer. NULL (legacy rows that pre-date the column) is
              // treated as the documented default — false (off) — since
              // async tool execution is an experimental opt-in capability.
              asyncToolsEnabled: row.asyncToolsEnabled === null || row.asyncToolsEnabled === undefined
                ? false
                : Boolean(row.asyncToolsEnabled),
              // Legacy rows that pre-date the column come back as null —
              // fall back to the documented default (100k chars).
              toolOutputCap: Number.isFinite(row.toolOutputCap) ? row.toolOutputCap : 100000,
              // Legacy rows return null — fall back to the documented default (100).
              maxToolRounds: Number.isFinite(row.maxToolRounds) ? row.maxToolRounds : 100,
              // Cross-provider failover chain. Stored as a JSON array of
              // { provider, model } tiers (TEXT). Legacy/NULL rows → [].
              // Malformed JSON is tolerated and treated as no fallbacks.
              fallbackProviders: parseFallbackChain(row.fallbackProviders),
              // Stored as INTEGER (0/1). NULL (legacy) → false (feature off).
              fallbackEnabled: row.fallbackEnabled === null || row.fallbackEnabled === undefined
                ? false
                : Boolean(row.fallbackEnabled),
              // Optional: what each flat-rate seat costs per month. {} means
              // the user has not said, which is a normal state — every seat
              // figure still renders, just without a cost comparison.
              subscriptionCosts: parseSubscriptionCosts(row.subscriptionCosts),
            });
          } else {
            // User not found, return defaults
            resolve({
              selectedProvider: 'Anthropic',
              selectedModel: 'claude-3-5-sonnet-20240620',
              customInstructions: '',
              asyncToolsEnabled: false,
              toolOutputCap: 100000,
              maxToolRounds: 100,
              fallbackProviders: [],
              fallbackEnabled: false,
              subscriptionCosts: {},
            });
          }
        }
      );
    });
  }

  static updateUserSettings(userId, settings) {
    return new Promise((resolve, reject) => {
      const { selectedProvider, selectedModel, customInstructions, asyncToolsEnabled, toolOutputCap, maxToolRounds, fallbackProviders, fallbackEnabled, subscriptionCosts } = settings;

      const fields = [];
      const params = [];

      if (selectedProvider !== undefined) {
        // If provider is being changed, always update model too (even to null)
        // to prevent stale model from a different provider lingering in the DB.
        fields.push('default_provider = ?');
        params.push(selectedProvider);
        fields.push('default_model = ?');
        params.push(selectedModel ?? null);
      } else if (selectedModel !== undefined) {
        fields.push('default_model = COALESCE(?, default_model)');
        params.push(selectedModel);
      }

      if (customInstructions !== undefined) {
        fields.push('custom_instructions = ?');
        params.push(customInstructions ? String(customInstructions).trim() : null);
      }

      if (asyncToolsEnabled !== undefined) {
        fields.push('async_tools_enabled = ?');
        params.push(asyncToolsEnabled ? 1 : 0);
      }

      if (toolOutputCap !== undefined) {
        fields.push('tool_output_cap = ?');
        params.push(toolOutputCap);
      }

      if (maxToolRounds !== undefined) {
        fields.push('max_tool_rounds = ?');
        params.push(maxToolRounds);
      }

      if (fallbackProviders !== undefined) {
        // Persist as a JSON string; accept either an array or a pre-stringified
        // value. Invalid input collapses to an empty array so we never write junk.
        fields.push('fallback_providers = ?');
        params.push(serializeFallbackChain(fallbackProviders));
      }

      if (fallbackEnabled !== undefined) {
        fields.push('fallback_enabled = ?');
        params.push(fallbackEnabled ? 1 : 0);
      }

      if (subscriptionCosts !== undefined) {
        fields.push('subscription_costs = ?');
        params.push(serializeSubscriptionCosts(subscriptionCosts));
      }

      if (fields.length === 0) {
        return resolve({ changes: 0 });
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);

      const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

      db.run(query, params,
        function (err) {
          if (err) {
            reject(err);
          } else if (this.changes === 0) {
            // User doesn't exist, create with settings
            db.run(
              `INSERT INTO users (id, default_provider, default_model, custom_instructions, async_tools_enabled, tool_output_cap, max_tool_rounds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                userId,
                selectedProvider || 'Anthropic',
                selectedModel || 'claude-3-5-sonnet-20240620',
                customInstructions ? String(customInstructions).trim() : null,
                // New rows default to async OFF (experimental opt-in).
                asyncToolsEnabled === undefined ? 0 : (asyncToolsEnabled ? 1 : 0),
                toolOutputCap === undefined ? 100000 : toolOutputCap,
                maxToolRounds === undefined ? 100 : maxToolRounds,
              ],
              function (insertErr) {
                if (insertErr) {
                  reject(insertErr);
                } else {
                  resolve({ changes: this.changes, created: true });
                }
              }
            );
          } else {
            resolve({ changes: this.changes, updated: true });
          }
        }
      );
    });
  }

  /**
   * Read a user's stored UI preferences.
   *
   * Returns the parsed structure (never null). A user row that does not exist
   * and a user with nothing stored are the same answer — empty preferences —
   * because a preferences GET has no business 404ing a browser that is simply
   * booting for the first time.
   */
  static getPreferences(userId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT preferences FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(parsePreferences(row ? row.preferences : null));
      });
    });
  }

  /**
   * Merge a patch into a user's stored preferences.
   *
   * @returns { preferences, result } — `result` reports which keys were
   *   applied, deleted or rejected, so the caller can hand that back to the
   *   client instead of a bare 200 that hides a dropped key.
   */
  static updatePreferences(userId, patch) {
    return withPreferenceLock(userId, async () => {
      const stored = await UserModel.getPreferences(userId);
      const { next, result } = mergePreferences(stored, patch);
      const serialized = serializePreferences(next);

      const changes = await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [serialized, userId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          },
        );
      });

      // No row updated means no such user. Surfaced explicitly rather than
      // reported as a silent success — a write that stored nothing must not
      // look identical to one that stored everything.
      if (changes === 0) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      return { preferences: next, result };
    });
  }
}

export default UserModel;
