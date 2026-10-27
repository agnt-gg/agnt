import express from 'express';
import { authenticateToken } from './Middleware.js';
import AuthManager from '../services/auth/AuthManager.js';
import { getProviderConfig } from '../services/ai/providerConfigs.js';
import { isTenantInstance, tenantOwnerId } from '../services/auth/tenantOwnership.js';
import {
  BILLING, SUBSCRIPTION_PROVIDERS, memberAiBilling, setMemberAiBilling, sharedSubscriptions, setSharedSubscriptions,
} from '../services/auth/memberAi.js';

/**
 * Members' AI on a hosted team instance (services/auth/memberAi.js):
 *   billing               who pays for members' AI keys: the team or each member;
 *   sharedSubscriptions   which of the owner's subscriptions (Claude Code, Codex,
 *                         Kimi Code, ...) the whole team may use.
 * Everyone signed in may read it, so a member knows what they are on; only the
 * instance owner may change it.
 */
export function createMemberAiRouter({
  authenticate = authenticateToken,
  listConnected = (userId, token) => AuthManager.getConnectedApps(userId, token),
} = {}) {
  const router = express.Router();
  router.use(authenticate);
  const actor = (req) => req.user?.id || req.user?.userId || null;
  const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

  async function view(req) {
    const hosted = isTenantInstance();
    const isOwner = hosted && actor(req) === tenantOwnerId();
    const shared = sharedSubscriptions();
    let offered = [];
    if (hosted && isOwner) {
      // Offer the subscriptions the owner actually has here, and any already shared.
      const connected = new Set((await listConnected(actor(req), bearer(req)).catch(() => [])).map((entry) => entry.providerId));
      offered = [...SUBSCRIPTION_PROVIDERS].filter((id) => connected.has(id) || shared.has(id));
    } else if (hosted) {
      offered = [...SUBSCRIPTION_PROVIDERS].filter((id) => shared.has(id));
    }
    return {
      hosted,
      isOwner,
      billing: memberAiBilling(),
      subscriptions: offered.map((id) => ({ id, name: getProviderConfig(id)?.name || id, shared: shared.has(id) })),
    };
  }

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await view(req));
  });

  router.put('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isTenantInstance()) return res.status(404).json({ error: 'Only a hosted team instance has members' });
    if (actor(req) !== tenantOwnerId()) return res.status(403).json({ error: 'Only the owner decides how members use the team\u2019s AI' });
    const { billing, sharedSubscriptions: shared } = req.body || {};
    if (billing === undefined && shared === undefined) return res.status(400).json({ error: 'Nothing to change' });
    // Validate everything before saving anything: no half-applied change.
    if (billing !== undefined && !Object.values(BILLING).includes(billing)) return res.status(400).json({ error: 'Choose "team" or "member"' });
    if (shared !== undefined && (!Array.isArray(shared) || shared.some((id) => !SUBSCRIPTION_PROVIDERS.has(id)))) {
      return res.status(400).json({ error: 'Choose subscriptions AGNT knows' });
    }
    try {
      if (billing !== undefined) setMemberAiBilling(billing);
      if (shared !== undefined) setSharedSubscriptions(shared);
      return res.json(await view(req));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the setting' });
    }
  });

  return router;
}
