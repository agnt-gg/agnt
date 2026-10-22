/**
 * The free plan connects FREE_LIMITS.connections accounts (OAuth or key).
 *
 * Called by AuthManager before it saves a key or a token. Refreshing or
 * replacing an account that is already connected is never refused, and AI
 * model keys never count: "your own models" is part of the free plan.
 */
import db from '../../models/database/index.js';
import { FREE_LIMITS } from './planLimits.js';
import { isEnforcing, canRunScheduledGoals } from './planEntitlements.js';
import { credentialUserId } from './tenantOwnership.js';

let aiProviders = null;
async function aiProviderIds() {
  if (!aiProviders) {
    // Lazy: providerConfigs is large and sits beside AuthManager in the import graph.
    const { getAllProviderKeys } = await import('../ai/providerConfigs.js');
    aiProviders = new Set(getAllProviderKeys().map((id) => String(id).toLowerCase()));
  }
  return aiProviders;
}

const all = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows || []))));

/** Distinct non-AI accounts this user has connected. */
export async function connectedAccountIds(userId) {
  const rows = await all(
    'SELECT provider_id FROM api_keys WHERE user_id = ? UNION SELECT provider_id FROM oauth_tokens WHERE user_id = ?',
    [userId, userId]
  );
  const ai = await aiProviderIds();
  return [...new Set(rows.map((row) => String(row.provider_id).toLowerCase()))].filter((id) => !ai.has(id));
}

export class PlanLimitError extends Error {
  constructor(message, limit) {
    super(message);
    this.code = 'PLAN_LIMIT';
    this.limit = limit;
    this.status = 403;
  }
}

/** Throws PlanLimitError when a free account would connect one account too many. */
export async function assertCanConnect(userId, providerId, { hasPaidPlan = (id) => canRunScheduledGoals(credentialUserId(id)) } = {}) {
  if (!isEnforcing() || !userId || !providerId) return;
  const id = String(providerId).toLowerCase();
  if ((await aiProviderIds()).has(id)) return;
  const connected = await connectedAccountIds(userId);
  if (connected.includes(id) || connected.length < FREE_LIMITS.connections) return;
  if (await hasPaidPlan(userId)) return;
  throw new PlanLimitError(`The free plan connects ${FREE_LIMITS.connections} accounts. Disconnect one, or upgrade to connect more.`, 'connections');
}
