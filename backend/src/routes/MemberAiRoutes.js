import express from 'express';
import { authenticateToken } from './Middleware.js';
import { isTenantInstance, tenantOwnerId } from '../services/auth/tenantOwnership.js';
import { memberAiBilling, setMemberAiBilling } from '../services/auth/memberAi.js';

/**
 * Who pays for members' AI on a hosted team instance (services/auth/memberAi.js).
 * Everyone signed in may read it, so a member knows whose keys they are on;
 * only the instance owner may change it.
 */
export function createMemberAiRouter({ authenticate = authenticateToken } = {}) {
  const router = express.Router();
  router.use(authenticate);
  const actor = (req) => req.user?.id || req.user?.userId || null;
  const view = (req) => ({
    hosted: isTenantInstance(),
    isOwner: isTenantInstance() && actor(req) === tenantOwnerId(),
    billing: memberAiBilling(),
  });

  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(view(req));
  });

  router.put('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isTenantInstance()) return res.status(404).json({ error: 'Only a hosted team instance has members' });
    if (actor(req) !== tenantOwnerId()) return res.status(403).json({ error: 'Only the owner decides who pays for members\u2019 AI' });
    try {
      setMemberAiBilling(req.body?.billing);
      return res.json(view(req));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the setting' });
    }
  });

  return router;
}
