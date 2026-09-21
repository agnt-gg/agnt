import express from 'express';
import { authenticateToken } from './Middleware.js';
import WebhookModel from '../models/WebhookModel.js';
import { defaultInbox } from '../services/agntMail.js';
import { serviceAllowed, SERVICES, serviceFailure } from '../services/agntServices.js';

/**
 * What the hosted services have given this account: the inbox address every
 * receive-email trigger listens on, and the public URL of a workflow's webhook.
 *
 * The editor shows these next to the trigger node. Neither is derivable on the
 * client any more — the relay URLs were guessable, the hosted ones are not —
 * so the UI asks rather than guesses. A free account gets `pro: false` and no
 * address, which the node renders as the upgrade prompt.
 */
const AgntServicesRoutes = express.Router();

AgntServicesRoutes.get('/entitlements', authenticateToken, async (_req, res) => {
  const out = {};
  for (const name of Object.keys(SERVICES)) out[name] = await serviceAllowed(name).catch(() => false);
  res.json(out);
});

AgntServicesRoutes.get('/inbox', authenticateToken, async (_req, res) => {
  try {
    if (!(await serviceAllowed('mail'))) return res.json({ pro: false, address: null });
    const inbox = await defaultInbox();
    res.json({ pro: true, address: inbox.address, inboxId: inbox.id });
  } catch (error) {
    const failure = serviceFailure(error);
    res.status(failure.code === 'pro_required' ? 200 : 502).json({ pro: failure.code !== 'pro_required', address: null, error: failure.error });
  }
});

AgntServicesRoutes.get('/webhook/:workflowId', authenticateToken, async (req, res) => {
  try {
    if (!(await serviceAllowed('webhooks'))) return res.json({ pro: false, url: null });
    const row = await WebhookModel.findByWorkflowId(req.params.workflowId, req.user.id);
    const url = row?.endpoint_id ? row.webhook_url : null;
    res.json({ pro: true, url, state: url ? 'active' : 'pending' });
  } catch (error) {
    res.status(500).json({ pro: true, url: null, error: serviceFailure(error).error });
  }
});

export default AgntServicesRoutes;
