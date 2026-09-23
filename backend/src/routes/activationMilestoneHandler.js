import { syncActivationMilestones } from '../services/ActivationMilestoneService.js';

export function activationMilestoneHandler({ db, appVersion, sync = syncActivationMilestones, logger = console }) {
  return async (req, res) => {
    const userId = req.user?.userId || req.user?.id;
    if (!req.user?.isAuthenticated || !userId) return res.status(401).json({ error: 'Authentication required' });
    const bearer = req.headers.authorization || '';
    if (!bearer.startsWith('Bearer ')) return res.status(401).json({ error:'Authentication required' });
    if (req.headers.dnt === '1' || req.body?.enabled !== true) return res.json({ success:true, enabled:false, sent:0 });
    try {
      const result = await sync({ db, userId, token:bearer.slice(7), appVersion, enabled:true });
      res.json({ success:true, ...result });
    } catch (error) {
      logger.error('[activation-sync] Delivery deferred:', error.message);
      res.status(503).json({ error:'Activation delivery deferred; a later sync will retry.' });
    }
  };
}
