import express from 'express';
import { authenticateToken } from './Middleware.js';
import WebhookModel from '../models/WebhookModel.js';
import { defaultInbox } from '../services/agntMail.js';
import { workflowAddress } from '../services/mailAddressing.js';
import { legacyWebhooks } from '../services/legacyRelay.js';
import { serviceAllowed, SERVICES, serviceFailure, callService, hostedInstanceSlug } from '../services/agntServices.js';
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
    mobile: (u) => [
      { key: 'texts', label: 'Texts', used: u.usedUnits, included: u.includedUnits, unit: 'texts' },
      { key: 'phones', label: 'Phones', used: undefined, included: u.maxInboxes, unit: 'phones' },
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

// ?workflowId= returns that workflow's own address (inbox+wf-<id>@...), which
// only that workflow receives. Without it, the bare inbox, which all receive.
AgntServicesRoutes.get('/inbox', authenticateToken, async (req, res) => {
  try {
    if (!(await serviceAllowed('mail'))) return res.json({ pro: false, address: null });
    const inbox = await defaultInbox();
    const workflowId = typeof req.query.workflowId === 'string' && req.query.workflowId ? req.query.workflowId : null;
    res.json({ pro: true, address: workflowId ? workflowAddress(inbox.address, workflowId) : inbox.address, inboxAddress: inbox.address, inboxId: inbox.id });
  } catch (error) {
    const failure = serviceFailure(error);
    res.status(failure.code === 'pro_required' ? 200 : 502).json({ pro: failure.code !== 'pro_required', address: null, error: failure.error });
  }
});

/**
 * Text Annie (mobile.agnt.gg), for Settings -> Phone Access. A thin proxy: the
 * service owns phones, routing and billing; this keeps the browser on its own
 * origin and the session token on the server. `planGate: false` because the
 * service answers the plan question itself (and offers a $5 standalone plan).
 */
const mobileProxy = (method, path, { body, idempotent = false } = {}) =>
  callService('mobile', path, { method, body, idempotent, planGate: false, timeoutMs: 20000, retries: 2 });
const mobileFailure = (res, error) => {
  const failure = serviceFailure(error);
  // callService folds every 402 into 'pro_required'; keep the service's own
  // reason (hosting_required, insufficient_credit, ...) for the UI.
  const reason = error?.detail?.error || failure.code || 'request_failed';
  res.status(failure.status && failure.status >= 400 && failure.status < 600 ? failure.status : 502).json({ ...failure, reason });
};
AgntServicesRoutes.get('/mobile/status', authenticateToken, async (_req, res) => {
  try {
    const status = await mobileProxy('GET', '/status');
    // A phone that finished linking since the last look: start answering it.
    if ((status.phones || []).some((p) => p.state === 'active')) kickReceiver();
    res.set('Cache-Control', 'no-store').json({ ...status, instance: hostedInstanceSlug() || 'desktop' });
  } catch (error) { mobileFailure(res, error); }
});
// A phone linked or rerouted here should be answered at once, not after the
// receiver's idle back-off.
const kickReceiver = () => import('../services/mobileReceiver.js').then((m) => m.getMobileReceiver()?.kick()).catch(() => {});
AgntServicesRoutes.post('/mobile/phones', authenticateToken, async (req, res) => {
  try {
    res.status(201).json(await mobileProxy('POST', '/phones', { body: { number: req.body?.number, route: req.body?.route || hostedInstanceSlug() || 'desktop' } }));
    kickReceiver();
  } catch (error) { mobileFailure(res, error); }
});
AgntServicesRoutes.post('/mobile/phones/:id/code', authenticateToken, async (req, res) => {
  try { res.json(await mobileProxy('POST', `/phones/${encodeURIComponent(req.params.id)}/code`, { body: {} })); } catch (error) { mobileFailure(res, error); }
});
AgntServicesRoutes.put('/mobile/phones/:id', authenticateToken, async (req, res) => {
  try {
    res.json(await mobileProxy('PUT', `/phones/${encodeURIComponent(req.params.id)}`, { body: { route: req.body?.route } }));
    kickReceiver();
  } catch (error) { mobileFailure(res, error); }
});
AgntServicesRoutes.delete('/mobile/phones/:id', authenticateToken, async (req, res) => {
  try { res.json(await mobileProxy('DELETE', `/phones/${encodeURIComponent(req.params.id)}`)); } catch (error) { mobileFailure(res, error); }
});

AgntServicesRoutes.get('/webhook/:workflowId', authenticateToken, async (req, res) => {
  try {
    if (!(await serviceAllowed('webhooks'))) return res.json({ pro: false, url: null });
    const row = await WebhookModel.findByWorkflowId(req.params.workflowId, req.user.id);
    const url = row?.endpoint_id ? row.webhook_url : null;
    // The pre-0.6.7 URL is registered alongside the hosted one while the
    // workflow is active, so senders that still use it keep delivering.
    res.json({ pro: true, url, legacyUrl: row ? legacyWebhooks.url(req.params.workflowId) : null, state: url ? 'active' : 'pending' });
  } catch (error) {
    res.status(500).json({ pro: true, url: null, error: serviceFailure(error).error });
  }
});

export default AgntServicesRoutes;
