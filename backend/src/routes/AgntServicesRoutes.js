import express from 'express';
import { authenticateToken } from './Middleware.js';
import WebhookModel from '../models/WebhookModel.js';
import { defaultInbox } from '../services/agntMail.js';
import { serviceAllowed, SERVICES, serviceFailure, callService } from '../services/agntServices.js';
import { getFlashAccount, startTopUp } from '../services/agntFlashAccount.js';

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

/**
 * Usage across every hosted service, in one shape the Usage page can render
 * without knowing each service's dialect. Each service answers for itself;
 * one being down does not blank the others.
 */
AgntServicesRoutes.get('/usage', authenticateToken, async (_req, res) => {
  // Models and Search answer flat; Mail, Webhooks and Sandbox nest the plan
  // under `hosting` with the prepaid balance beside it. Counts of inboxes and
  // endpoints are not in usage at all, so they come from their own lists.
  const meters = {
    models: (u) => [{ key: 'credits', label: 'Model credits', used: u.usedCredits ?? u.usedUnits, included: u.includedCredits ?? u.includedUnits, unit: 'credits' }],
    search: (u) => [
      { key: 'searches', label: 'Searches', used: u.usedSearches, included: u.includedSearches, unit: 'searches' },
    ],
    sandbox: (u) => [{ key: 'minutes', label: 'Compute minutes', used: u.usedUnits, included: u.includedUnits, unit: 'min' }],
    mail: (u, extra) => [
      { key: 'units', label: 'Mail units', used: u.usedUnits, included: u.includedUnits, unit: 'units' },
      { key: 'inboxes', label: 'Inboxes', used: extra.count, included: u.maxInboxes, unit: 'inboxes' },
      { key: 'storage', label: 'Storage', used: u.storedBytes, included: u.storageBytes, unit: 'bytes' },
    ],
    webhooks: (u, extra) => [
      { key: 'units', label: 'Webhook units', used: u.usedUnits, included: u.includedUnits, unit: 'units' },
      { key: 'endpoints', label: 'Endpoints', used: extra.count, included: u.maxInboxes ?? u.maxEndpoints, unit: 'endpoints' },
    ],
  };
  const extras = {
    mail: async () => ({ count: ((await callService('mail', '/inboxes')).inboxes || []).filter((i) => i.state === 'active').length }),
    webhooks: async () => ({ count: ((await callService('webhooks', '/endpoints')).endpoints || []).filter((e) => e.state === 'active').length }),
  };
  const services = await Promise.all(
    Object.keys(SERVICES).map(async (name) => {
      try {
        const raw = await callService(name, '/usage');
        const u = raw.hosting ? { ...raw.hosting, balance: { available: raw.available, credit: raw.credit } } : raw;
        const extra = extras[name] ? await extras[name]().catch(() => ({})) : {};
        return {
          service: name,
          ok: true,
          eligible: u.eligible !== false,
          plan: u.planName || u.tier || null,
          period: u.period || null,
          resetAt: u.resetAt || null,
          meters: meters[name](u, extra).filter((m) => m.included !== undefined || m.used !== undefined).map((m) => ({ ...m, used: Number(m.used) || 0, included: m.included == null ? null : Number(m.included) })),
          balanceMicroUSD: u.balance?.available ?? null,
          allowOverage: !!u.allowOverage,
        };
      } catch (error) {
        const failure = serviceFailure(error);
        return { service: name, ok: false, error: failure.message || failure.error, code: failure.code, meters: [] };
      }
    })
  );
  res.set('Cache-Control', 'no-store').json({ services, fetchedAt: Date.now() });
});

/** AGNT Flash credits left for the signed-in account: the chat's credit chip. */
AgntServicesRoutes.get('/models/account', authenticateToken, async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await getFlashAccount());
  } catch (error) {
    const failure = serviceFailure(error);
    res.status(failure.status === 401 ? 401 : 502).json(failure);
  }
});

/** One click to a Stripe checkout for prepaid AGNT Flash credit. */
AgntServicesRoutes.post('/models/top-up', authenticateToken, async (req, res) => {
  try {
    res.json(await startTopUp(Number(req.body?.amountCents)));
  } catch (error) {
    const failure = serviceFailure(error);
    res.status(failure.status === 400 ? 400 : failure.status === 401 ? 401 : 502).json(failure);
  }
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
