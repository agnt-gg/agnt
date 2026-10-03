import crypto from 'crypto';
import { EventEmitter } from 'events';
import { createEndpoint, retireEndpoint, pullEvents, eventToTrigger } from '../../services/agntWebhooks.js';
import { serviceFailure, neverReached, serverNow } from '../../services/agntServices.js';
import { legacyWebhooks } from '../../services/legacyRelay.js';
import WebhookModel from '../../models/WebhookModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';

/**
 * Inbound webhooks for workflows, served by webhooks.agnt.gg.
 *
 * Each active webhook workflow owns one hosted endpoint
 * (https://webhooks.agnt.gg/in/{slug}). The service stores every event before
 * it acknowledges the sender; this receiver pulls events since a per-endpoint
 * cursor and hands them to the running engine. There is no claim/release
 * protocol any more: the cursor only advances past events the engine actually
 * accepted, so an event whose workflow was not ready is simply seen again.
 *
 * Hosted webhooks are part of AGNT Pro. A free account gets a plan refusal at
 * registration time, which the workflow surfaces as a node error with the
 * upgrade message, rather than a URL that will never fire.
 *
 * THE OLD URL KEEPS WORKING. Senders configured before the move post to
 * api.agnt.gg/webhook/<workflowId>. Every active workflow is registered there
 * too, and both sources are polled every tick, independently: one being down
 * never stops the other. If webhooks.agnt.gg cannot be reached at all when a
 * workflow starts, it runs on the old URL alone and gets its hosted URL the
 * next time it starts.
 */

/** Constant-time comparison for the webhook's own auth secret. */
function safeEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/** Only the newest event per poll matters for the cursor; keep it monotonic. */
const later = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

class LocalWebhookReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.pollInterval = null;
    /** workflowId -> { endpointId, slug, url, since, method, authType, ... } */
    this.webhooks = new Map();

    // Only the Workflow Process polls, so a trigger fires once.
    this.externalPollingDisabled = process.env.AGNT_DISABLE_EXTERNAL_POLLING === 'true';
    this.pollingEnabled = process.env.IS_WORKFLOW_PROCESS === 'true' && !this.externalPollingDisabled;

    if (!this.pollingEnabled) {
      console.log('LocalWebhookReceiver: Polling disabled (main process or explicit external-polling kill switch).');
    }
    if (!this.externalPollingDisabled) {
      this.initializeWebhooks();
    }
    console.log('LocalWebhookReceiver instantiated.');
  }

  async initializeWebhooks() {
    if (this.externalPollingDisabled) return;
    try {
      await this.loadWebhooksFromDatabase();
      if (this.webhooks.size === 0) {
        console.log('LocalWebhookReceiver: No webhook workflows found on startup. Polling will start when a workflow is activated.');
        return;
      }
      const activeWorkflowIds = await this._getActiveWebhookWorkflowIds();
      if (activeWorkflowIds.length > 0) {
        console.log(`LocalWebhookReceiver: Found ${activeWorkflowIds.length} active webhook workflows on startup. Auto-starting polling...`);
        this.startPolling();
      }
    } catch (error) {
      console.error('LocalWebhookReceiver: Error initializing webhooks:', error);
    }
  }

  async _getActiveWebhookWorkflowIds() {
    try {
      const workflowIds = Array.from(this.webhooks.keys());
      if (workflowIds.length === 0) return [];
      const activeWorkflows = await WorkflowModel.findByStatusBatch(['listening', 'running', 'queued'], 1000, 0);
      const activeIds = new Set(activeWorkflows.map((w) => w.id));
      return workflowIds.filter((id) => activeIds.has(id));
    } catch (error) {
      console.error('LocalWebhookReceiver: Error getting active webhook workflow IDs:', error);
      return [];
    }
  }

  /**
   * Register a workflow's inbound webhook and return its public URL.
   *
   * Reuses the hosted endpoint recorded for this workflow when there is one, so
   * the URL a customer pasted into a third-party system survives restarts and
   * re-activations. Throws with the plan message when the account is not
   * entitled — the caller turns that into a node error.
   */
  async registerWebhook(workflowId, userId, method, authType, authToken, username, password, responseMode = 'Immediate', responseBody, responseContentType) {
    const existing = await WebhookModel.findByWorkflowId(workflowId).catch(() => null);
    let endpoint = existing?.endpoint_id
      ? { id: existing.endpoint_id, slug: existing.slug, url: existing.webhook_url }
      : null;

    const legacy = { workflowId, method, authType, authToken, username, password, responseMode };
    const legacyRegistered = await this._registerLegacy(legacy);

    if (!endpoint) {
      try {
        endpoint = await createEndpoint(workflowId, `workflow-${String(workflowId).slice(0, 8)}`);
      } catch (error) {
        // Unreachable, and the old relay took the registration: run on the old
        // URL now. Anything else (no plan, bad request) is the user's answer.
        if (!(neverReached(error) && legacyRegistered)) {
          const failure = serviceFailure(error);
          throw new Error(failure.message || failure.error);
        }
        console.warn(`LocalWebhookReceiver: webhooks.agnt.gg unreachable; ${workflowId} listens on the legacy URL only for now`);
        this.webhooks.set(workflowId, { ...legacy, userId, url: legacyWebhooks.url(workflowId), endpointId: null, since: serverNow(), legacyRegistered, responseBody, responseContentType });
        this.startPolling();
        return legacyWebhooks.url(workflowId);
      }
    }

    // Service clock, never this machine's: the cursor is compared with the
    // service's receivedAt (see agntServices.serverNow).
    const since = this.webhooks.get(workflowId)?.since ?? existing?.cursor ?? serverNow();
    this.webhooks.set(workflowId, {
      userId,
      endpointId: endpoint.id,
      slug: endpoint.slug,
      url: endpoint.url,
      since,
      method,
      authType,
      authToken,
      username,
      password,
      workflowId,
      responseMode,
      responseBody,
      responseContentType,
      legacyRegistered,
    });

    try {
      if (!existing) {
        await WebhookModel.create({
          workflow_id: workflowId,
          user_id: userId,
          webhook_url: endpoint.url,
          method: method || null,
          auth_type: authType || null,
          endpoint_id: endpoint.id,
          slug: endpoint.slug,
        });
      } else if (!existing.endpoint_id) {
        // A row from the retired relay: adopt the hosted endpoint in place.
        await WebhookModel.attachEndpoint(workflowId, userId, { endpoint_id: endpoint.id, slug: endpoint.slug, webhook_url: endpoint.url });
      }
    } catch (dbError) {
      console.error(`Error persisting webhook to local database: ${dbError.message}`);
    }

    // THE STARTING POINT IS DURABLE. The cursor used to be saved only after
    // the first delivered event, so an endpoint that had never received one
    // restarted at "now" on every boot - and a hosted instance the fleet woke
    // to collect an event skipped it, because the event was older than the
    // boot. Measured on charlie 2026-09-27. Record it on first registration.
    if (existing?.cursor == null) await this._persistCursor(workflowId, since);

    console.log(`Webhook registered for workflow ${workflowId}: ${endpoint.url}`);
    return endpoint.url;
  }

  startPolling() {
    if (!this.pollingEnabled) {
      console.log('LocalWebhookReceiver: Polling disabled in main process, skipping.');
      return;
    }
    if (this.pollInterval) return;
    console.log('LocalWebhookReceiver: Starting polling...');
    this.pollInterval = setInterval(() => this.pollForTriggers(), 10000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('LocalWebhookReceiver: Polling stopped.');
    }
  }

  /** Register on the old relay so the old URL keeps delivering. Never fatal. */
  async _registerLegacy(webhook) {
    try {
      await legacyWebhooks.register(webhook);
      return true;
    } catch (error) {
      console.warn(`LocalWebhookReceiver: ${webhook.workflowId}: old URL not registered (${error.message})`);
      return false;
    }
  }

  async pollForTriggers() {
    if (!this.pollingEnabled || this.polling) return;
    this.polling = true;
    try {
      // Independent sources: a failure in one is logged and the other runs.
      const results = await Promise.allSettled([this._pollHosted(), this._pollLegacy()]);
      for (const result of results) {
        if (result.status === 'rejected') console.error('LocalWebhookReceiver: Error polling for webhook triggers:', result.reason);
      }
    } finally {
      this.polling = false;
    }
  }

  /** Workflows whose engine is up and listening right now. */
  _listening() {
    const out = [];
    for (const [workflowId] of this.webhooks) {
      const engine = this.processManager.activeWorkflows.get(workflowId);
      if (engine && (engine.isListening || engine.isRunning)) out.push(workflowId);
    }
    return out;
  }

  /**
   * Events posted to the old api.agnt.gg/webhook/<id> URL. The server claims
   * what it returns; each one is confirmed once its workflow took it, and
   * released (back to pending) if not, so nothing is lost or delivered twice.
   */
  async _pollLegacy() {
    const workflowIds = this._listening();
    if (workflowIds.length === 0) return;
    let triggers;
    try {
      triggers = await legacyWebhooks.poll(workflowIds);
    } catch (error) {
      if (error.code !== 'paused' && Date.now() - (this.lastLegacyError || 0) > 60000) {
        console.warn(`LocalWebhookReceiver: old webhook URLs not polled: ${error.message}`);
        this.lastLegacyError = Date.now();
      }
      return;
    }
    if (!triggers.length) return;
    const processed = [];
    const unprocessed = [];
    for (const trigger of triggers) {
      // { id, workflowId, triggerData: { method, headers, body, query } }, already parsed by the server.
      const { workflowId } = trigger;
      const data = trigger.triggerData || {};
      let result = null;
      try {
        result = await this._processWebhookTrigger(workflowId, { ...data, method: String(data?.method || 'POST').toUpperCase(), headers: data?.headers || {} });
      } catch (error) {
        console.error(`LocalWebhookReceiver: ${workflowId}: legacy event ${trigger.id} failed:`, error.message);
      }
      // Refused (method/credentials) counts as handled, exactly as on the hosted path.
      (result === null ? unprocessed : processed).push(trigger.id);
    }
    if (processed.length) await legacyWebhooks.confirm(processed).catch((e) => console.error('LocalWebhookReceiver: legacy confirm failed:', e.message));
    if (unprocessed.length) await legacyWebhooks.release(unprocessed).catch((e) => console.error('LocalWebhookReceiver: legacy release failed:', e.message));
  }

  async _pollHosted() {
    for (const [workflowId, webhook] of this.webhooks) {
      if (!webhook.endpointId) continue;
      const engine = this.processManager.activeWorkflows.get(workflowId);
      if (!engine || !(engine.isListening || engine.isRunning)) continue;

      let events;
      try {
        events = await pullEvents(webhook.endpointId, webhook.since);
      } catch (error) {
        const failure = serviceFailure(error);
        if (failure.status === 404 || failure.code === 'endpoint_not_found' || failure.error === 'endpoint_not_found') {
          // The hosted endpoint is gone (retired, or the service forgot it).
          // The workflow is still listening, so it gets a new one now rather
          // than logging the same line every ten seconds until someone
          // re-activates it by hand.
          await this._replaceEndpoint(workflowId, webhook);
          continue;
        }
        // A plan refusal here means the subscription lapsed under a live
        // workflow. Say so once per poll; the endpoint keeps storing events.
        console.error(`LocalWebhookReceiver: ${workflowId}: ${failure.message || failure.error}`);
        continue;
      }
      if (!events.length) continue;

      let advanced = webhook.since;
      for (const event of events) {
        const trigger = eventToTrigger(event);
        const result = await this._processWebhookTrigger(workflowId, trigger);
        if (result === null) break; // engine not ready: stop here, see it again next poll
        if (result?.status >= 400) {
          // Refused (wrong method or credentials) and the cursor moves past it,
          // exactly as the sender was refused on the relay; say why so the
          // workflow owner can see it rather than wonder why nothing fired.
          console.warn(`LocalWebhookReceiver: ${workflowId}: refused hosted event ${event.id} (${result.status} ${result.message})`);
        }
        advanced = later(advanced, event.receivedAt);
      }
      if (advanced !== webhook.since) {
        webhook.since = advanced;
        WebhookModel.saveCursor(workflowId, advanced).catch((e) => console.error('LocalWebhookReceiver: cursor save failed:', e.message));
      }
    }
  }

  /** Save a read position; never fatal (the in-memory one still works this run). */
  async _persistCursor(workflowId, cursor) {
    try {
      await WebhookModel.saveCursor(workflowId, cursor);
    } catch (error) {
      console.error(`LocalWebhookReceiver: ${workflowId}: could not save the event cursor: ${error.message}`);
    }
  }

  /** Swap a dead hosted endpoint for a live one and record the new URL. */
  async _replaceEndpoint(workflowId, webhook) {
    try {
      const endpoint = await createEndpoint(workflowId);
      Object.assign(webhook, { endpointId: endpoint.id, slug: endpoint.slug, url: endpoint.url, since: serverNow() });
      await WebhookModel.attachEndpoint(workflowId, webhook.userId, { endpoint_id: endpoint.id, slug: endpoint.slug, webhook_url: endpoint.url });
      await this._persistCursor(workflowId, webhook.since);
      console.log(`LocalWebhookReceiver: ${workflowId}: hosted endpoint was gone; now ${endpoint.url}`);
    } catch (error) {
      const failure = serviceFailure(error);
      console.error(`LocalWebhookReceiver: ${workflowId}: could not replace hosted endpoint: ${failure.message || failure.error}`);
    }
  }

  async _processWebhookTrigger(workflowId, triggerData) {
    const webhook = this.webhooks.get(workflowId);
    if (!webhook) return null;

    if (webhook.method && triggerData.method !== webhook.method) {
      console.log(`LocalWebhookReceiver: Method not allowed: ${triggerData.method} for webhook ${workflowId}`);
      return { status: 405, message: 'Method not allowed' };
    }

    if (webhook.authType && webhook.authType.toLowerCase() !== 'none') {
      const authTypeLower = webhook.authType.toLowerCase();
      // Fail closed when the expected secret is absent (credentials are not
      // persisted; a restart restores only metadata until the workflow is re-saved).
      const expectedSecret = authTypeLower === 'basic' ? webhook.username || webhook.password : webhook.authToken;
      if (!expectedSecret) {
        console.warn(`LocalWebhookReceiver: webhook ${workflowId} declares ${webhook.authType} auth but holds no credential — refusing. Re-save the workflow to restore it.`);
        return { status: 401, message: 'Unauthorized' };
      }
      const headers = triggerData.headers || {};
      if (authTypeLower === 'basic') {
        const header = headers.authorization;
        if (!header || !header.startsWith('Basic ')) return { status: 401, message: 'Unauthorized - Basic auth failed' };
        const credentials = Buffer.from(header.split(' ')[1], 'base64').toString('ascii');
        const separator = credentials.indexOf(':');
        const username = separator === -1 ? credentials : credentials.slice(0, separator);
        const password = separator === -1 ? '' : credentials.slice(separator + 1);
        if (!safeEqual(username, webhook.username) || !safeEqual(password, webhook.password)) return { status: 401, message: 'Unauthorized - Invalid credentials' };
      } else if (authTypeLower === 'bearer' || authTypeLower === 'webhook') {
        const providedToken = headers.authorization || headers['x-webhook-token'];
        if (!providedToken || !safeEqual(providedToken, `Bearer ${webhook.authToken}`)) return { status: 401, message: 'Unauthorized - Invalid token' };
      }
    }

    const result = await this._triggerWorkflow(workflowId, triggerData, webhook.responseMode === 'Wait for Result');
    if (result === null) return null;
    return result || { status: 200, message: 'Webhook processed successfully' };
  }

  async _triggerWorkflow(workflowId, triggerData, waitForCompletion = false) {
    const activeEngine = this.processManager.activeWorkflows.get(workflowId);
    if (activeEngine && (activeEngine.isListening || activeEngine.isRunning)) {
      return await activeEngine.processWorkflowTrigger(triggerData, { waitForCompletion });
    }
    return null;
  }

  async unregisterWebhook(workflowId, ownerIdHint = null) {
    console.log(`LocalWebhookReceiver: Unregistering webhook for workflow ${workflowId}`);
    const entry = this.webhooks.get(workflowId);
    ownerIdHint = ownerIdHint || entry?.userId || null;
    this.webhooks.delete(workflowId);

    // The old URL stops with the workflow, as it always did.
    await legacyWebhooks.unregister(workflowId).catch((error) => console.warn(`LocalWebhookReceiver: ${workflowId}: old URL not unregistered (${error.message})`));

    // The hosted endpoint is retired with the workflow. Deactivating a workflow
    // and re-activating it later gets a fresh URL; that is the same rule the
    // retired relay had, and it keeps orphaned endpoints from counting against
    // the account's endpoint allowance.
    try {
      const row = await WebhookModel.findByWorkflowId(workflowId).catch(() => null);
      const endpointId = entry?.endpointId || row?.endpoint_id;
      if (endpointId) await retireEndpoint(endpointId);
    } catch (error) {
      console.error(`LocalWebhookReceiver: Error retiring hosted endpoint for workflow ${workflowId}:`, serviceFailure(error).error);
    }

    try {
      const ownerId = ownerIdHint || (await WebhookModel.findOwnerId(workflowId));
      if (ownerId) await WebhookModel.deleteByWorkflowId(workflowId, ownerId);
    } catch (dbError) {
      console.error(`Error removing webhook from local database: ${dbError.message}`);
    }
  }

  async loadWebhooksFromDatabase() {
    try {
      const webhooks = await WebhookModel.loadAll();
      for (const webhook of webhooks) {
        // Metadata only; credentials are restored when the workflow is re-saved.
        this.webhooks.set(webhook.workflow_id, {
          userId: webhook.user_id,
          endpointId: webhook.endpoint_id || null,
          slug: webhook.slug || null,
          url: webhook.webhook_url,
          since: webhook.cursor ?? serverNow(),
          method: webhook.method,
          authType: webhook.auth_type,
          workflowId: webhook.workflow_id,
        });
      }
      console.log(`Loaded ${webhooks.length} webhooks into memory`);
    } catch (error) {
      console.error('Error loading webhooks from database:', error);
    }
  }

  shutdown() {
    this.stopPolling();
    console.log('LocalWebhookReceiver: Shut down.');
  }
}

export default LocalWebhookReceiver;
