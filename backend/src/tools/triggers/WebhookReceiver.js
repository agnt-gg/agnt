import axios from 'axios';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { authHeader } from '../../services/auth/sessionTokenCache.js';
import WebhookModel from '../../models/WebhookModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';

/**
 * Constant-time string comparison for secrets.
 *
 * `a !== b` on a credential short-circuits at the first differing byte, which
 * leaks the length and a prefix through response timing. timingSafeEqual needs
 * equal-length buffers, so both sides are hashed first: SHA-256 is fixed width,
 * so the comparison is constant time with respect to the inputs and the hash
 * itself is computed over data the caller already supplied.
 *
 * Returns false for any non-string input rather than coercing — coercion is
 * exactly how `undefined` became the password on this code path.
 */
function safeEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

class LocalWebhookReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.remoteUrl = process.env.REMOTE_URL;
    this.pollInterval = null;
    this.webhooks = new Map();

    // Only the Workflow Process should poll for triggers
    // Main process has IS_WORKFLOW_PROCESS undefined, child process has it set to 'true'
    // This prevents duplicate polling and race conditions
    this.externalPollingDisabled = process.env.AGNT_DISABLE_EXTERNAL_POLLING === 'true';
    this.pollingEnabled =
      process.env.IS_WORKFLOW_PROCESS === 'true' &&
      !this.externalPollingDisabled;

    if (!this.pollingEnabled) {
      console.log('LocalWebhookReceiver: Polling disabled (main process or explicit external-polling kill switch).');
    }

    // Preserve normal main-process initialization. Only the explicit kill
    // switch suppresses database loading and remote re-registration.
    if (!this.externalPollingDisabled) {
      this.initializeWebhooks();
    }
    console.log('LocalWebhookReceiver instantiated.');
  }

  /**
   * Initialize webhooks on startup - loads from DB and auto-starts polling if needed
   */
  async initializeWebhooks() {
    if (this.externalPollingDisabled) return;
    try {
      // First load webhooks from local database into memory
      await this.loadWebhooksFromDatabase();

      // Check if any of these webhooks belong to active workflows
      if (this.webhooks.size > 0) {
        const activeWorkflowIds = await this._getActiveWebhookWorkflowIds();

        if (activeWorkflowIds.length > 0) {
          console.log(`LocalWebhookReceiver: Found ${activeWorkflowIds.length} active webhook workflows on startup. Auto-starting polling...`);

          // Re-register webhooks with remote server for active workflows
          for (const workflowId of activeWorkflowIds) {
            const webhook = this.webhooks.get(workflowId);
            if (webhook) {
              try {
                await this._reregisterWebhookOnRemote(workflowId, webhook);
              } catch (error) {
                console.error(`LocalWebhookReceiver: Error re-registering webhook for workflow ${workflowId}:`, error.message);
              }
            }
          }

          // Start polling for webhook triggers
          this.startPolling();
        } else {
          console.log('LocalWebhookReceiver: No active webhook workflows found on startup. Polling will start when a workflow is activated.');
        }
      } else {
        console.log('LocalWebhookReceiver: No webhooks found in database.');
      }
    } catch (error) {
      console.error('LocalWebhookReceiver: Error initializing webhooks:', error);
    }
  }

  /**
   * Get workflow IDs that have webhooks AND are in an active state
   */
  async _getActiveWebhookWorkflowIds() {
    try {
      const workflowIds = Array.from(this.webhooks.keys());
      if (workflowIds.length === 0) return [];

      // Get workflows that are in active states
      const activeWorkflows = await WorkflowModel.findByStatusBatch(['listening', 'running', 'queued'], 1000, 0);
      const activeIds = new Set(activeWorkflows.map((w) => w.id));

      // Return only webhook workflow IDs that are active
      return workflowIds.filter((id) => activeIds.has(id));
    } catch (error) {
      console.error('LocalWebhookReceiver: Error getting active webhook workflow IDs:', error);
      return [];
    }
  }

  /**
   * Re-register a webhook with the remote server (for server restart recovery)
   */
  async _reregisterWebhookOnRemote(workflowId, webhook) {
    try {
      const response = await axios.post(
        `${this.remoteUrl}/webhooks/register`,
        {
          workflowId,
          userId: webhook.userId || null,
          method: webhook.method || null,
          authType: webhook.authType || null,
          authToken: webhook.authToken || null,
          username: webhook.username || null,
          password: webhook.password || null,
          responseMode: webhook.responseMode || 'Immediate',
        },
        { headers: authHeader() }
      );

      if (response.data.success) {
        console.log(`LocalWebhookReceiver: Re-registered webhook on remote for workflow ${workflowId}`);
      } else {
        console.warn(`LocalWebhookReceiver: Remote re-registration returned: ${response.data.error}`);
      }
    } catch (error) {
      console.error(`LocalWebhookReceiver: Error re-registering webhook on remote: ${error.message}`);
      // Don't throw - polling will still work even if remote registration fails
    }
  }

  async registerWebhook(workflowId, userId, method, authType, authToken, username, password, responseMode = 'Immediate') {
    // Generate webhook URL (remote server handles webhooks at /webhook/:workflowId)
    const webhookUrl = `${this.remoteUrl}/webhook/${workflowId}`;

    console.log(`Registering webhook for workflow ${workflowId}: ${webhookUrl}`);

    // Store the webhook configuration locally in memory.
    // `userId` is kept so unregister can scope its delete without a lookup.
    this.webhooks.set(workflowId, {
      userId,
      method,
      authType,
      authToken,
      username,
      password,
      workflowId,
      responseMode,
    });

    // Register webhook on remote server so it persists across remote restarts
    try {
      // This body carries the webhook's OWN credentials (authToken / username /
      // password), so it is not merely a read that needs identifying — it is a
      // secret-bearing write that was going out unauthenticated.
      const response = await axios.post(
        `${this.remoteUrl}/webhooks/register`,
        {
          workflowId,
          userId,
          method: method || null,
          authType: authType || null,
          authToken: authToken || null,
          username: username || null,
          password: password || null,
          responseMode: responseMode || 'Immediate',
        },
        { headers: authHeader() }
      );

      if (response.data.success) {
        console.log(`Webhook registered on remote server for workflow ${workflowId}`);
      } else {
        console.warn(`Remote webhook registration returned: ${response.data.error}`);
      }
    } catch (remoteError) {
      console.error(`Error registering webhook on remote server: ${remoteError.message}`);
      // Continue even if remote registration fails - polling will still work
    }

    // Check if webhook already exists in local database
    try {
      const existing = await WebhookModel.findByWorkflowId(workflowId);

      if (!existing) {
        // Only create if it doesn't exist
        await WebhookModel.create({
          workflow_id: workflowId,
          user_id: userId,
          webhook_url: webhookUrl,
          method: method || null,
          auth_type: authType || null,
        });
        console.log(`Webhook persisted to local database for workflow ${workflowId}`);
      } else {
        console.log(`Webhook already exists in local database for workflow ${workflowId}`);
      }
    } catch (dbError) {
      console.error(`Error persisting webhook to local database: ${dbError.message}`);
      // Continue even if DB save fails
    }

    return webhookUrl;
  }
  startPolling() {
    // Only allow polling in the Workflow Process to prevent duplicate triggers
    if (!this.pollingEnabled) {
      console.log('LocalWebhookReceiver: Polling disabled in main process, skipping.');
      return;
    }

    // Prevent duplicate polling intervals
    if (this.pollInterval) {
      console.log('LocalWebhookReceiver: Polling already active, skipping duplicate start.');
      return;
    }
    console.log('LocalWebhookReceiver: Starting polling...');
    this.pollInterval = setInterval(() => {
      this.pollForTriggers();
    }, 10000); // Poll every 10 seconds
  }
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('LocalWebhookReceiver: Polling stopped.');
    }
  }
  // async pollForTriggers() {
  //   console.log(
  //     "LocalWebhookReceiver: Polling remote server for webhook triggers..."
  //   );
  //   try {
  //     const response = await axios.get(`${this.remoteUrl}/webhooks/poll`);
  //     console.log("LocalWebhookReceiver: Poll response:", response.data);
  //     const { triggers } = response.data;
  //     console.log(
  //       `LocalWebhookReceiver: Received ${triggers.length} webhook triggers`
  //     );
  //     for (const trigger of triggers) {
  //       console.log("LocalWebhookReceiver: Trigger data:", trigger);
  //       await this._triggerWorkflow(trigger.workflowId, trigger.triggerData);
  //     }
  //   } catch (error) {
  //     console.error(
  //       "LocalWebhookReceiver: Error polling for webhook triggers:",
  //       error
  //     );
  //   }
  // }
  async pollForTriggers() {
    if (!this.pollingEnabled) return;
    let claimedTriggerIds = []; // Track claimed triggers for release on error

    try {
      // Security: Only request triggers for workflows we own
      const workflowIds = Array.from(this.webhooks.keys());

      // Don't poll if no webhooks registered locally
      if (workflowIds.length === 0) {
        return;
      }

      // POST with workflowIds for security filtering - server only returns our triggers
      // Server atomically claims these triggers (sets status='processing') to prevent race conditions
      const response = await axios.post(
        `${this.remoteUrl}/webhooks/poll`,
        { workflowIds: workflowIds },
        { headers: authHeader() }
      );
      const { triggers } = response.data;

      // Only log if there are triggers to process
      if (!triggers || triggers.length === 0) return;

      console.log(`LocalWebhookReceiver: Received and claimed ${triggers.length} webhook triggers`);

      // Track all claimed trigger IDs (server has already claimed them)
      claimedTriggerIds = triggers.map((t) => t.id);

      const processedTriggerIds = [];
      const results = {};
      const failedTriggerIds = []; // Triggers that couldn't be processed

      for (const trigger of triggers) {
        // Identifiers only. `trigger` carries the entire inbound HTTP request,
        // including triggerData.headers.authorization — the caller's webhook
        // credential in plaintext — straight into the process log and any
        // support bundle taken from it.
        console.log(`LocalWebhookReceiver: processing trigger ${trigger.id} for workflow ${trigger.workflowId}`);
        const result = await this._processWebhookTrigger(trigger.workflowId, trigger.triggerData);

        // Only mark as processed if the workflow was actually triggered
        if (result && !result.pendingRetry) {
          processedTriggerIds.push(trigger.id);
          results[trigger.id] = result;
        } else if (result === null) {
          // Workflow not ready - release this trigger back to pending for retry
          console.log(`LocalWebhookReceiver: Workflow ${trigger.workflowId} not ready, releasing trigger for retry`);
          failedTriggerIds.push(trigger.id);
        }
      }

      // Confirm processed triggers
      if (processedTriggerIds.length > 0) {
        try {
          await axios.post(
            `${this.remoteUrl}/webhooks/confirm-processed`,
            { processedTriggerIds, results },
            { headers: authHeader() }
          );
          console.log(`LocalWebhookReceiver: Confirmed processing of ${processedTriggerIds.length} triggers`);
        } catch (confirmError) {
          console.error('LocalWebhookReceiver: Error confirming processed triggers:', confirmError);
        }
      }

      // Release failed triggers back to pending state
      if (failedTriggerIds.length > 0) {
        try {
          await axios.post(
            `${this.remoteUrl}/webhooks/release`,
            { triggerIds: failedTriggerIds },
            { headers: authHeader() }
          );
          console.log(`LocalWebhookReceiver: Released ${failedTriggerIds.length} triggers back to pending`);
        } catch (releaseError) {
          console.error('LocalWebhookReceiver: Error releasing triggers:', releaseError);
        }
      }
    } catch (error) {
      console.error('LocalWebhookReceiver: Error polling for webhook triggers:', error);

      // If we claimed triggers but failed to process, release them
      if (claimedTriggerIds.length > 0) {
        try {
          await axios.post(
            `${this.remoteUrl}/webhooks/release`,
            { triggerIds: claimedTriggerIds },
            { headers: authHeader() }
          );
          console.log(`LocalWebhookReceiver: Released ${claimedTriggerIds.length} triggers after error`);
        } catch (releaseError) {
          console.error('LocalWebhookReceiver: Error releasing triggers after failure:', releaseError);
        }
      }
    }
  }
  async _processWebhookTrigger(workflowId, triggerData) {
    const webhook = this.webhooks.get(workflowId);
    if (!webhook) {
      // Return null instead of 404 - this allows the Workflow Process to handle it
      // The main process may not have the webhook in memory, but the Workflow Process does
      console.log(`LocalWebhookReceiver: Webhook not found in local memory for workflow ${workflowId}, deferring to other process`);
      return null;
    }

    if (webhook.method && triggerData.method !== webhook.method) {
      console.log(`LocalWebhookReceiver: Method not allowed: ${triggerData.method} for webhook ${workflowId}`);
      return { status: 405, message: 'Method not allowed' };
    }

    if (webhook.authType && webhook.authType.toLowerCase() !== 'none') {
      const authTypeLower = webhook.authType.toLowerCase();

      // FAIL CLOSED WHEN THE EXPECTED SECRET IS ABSENT.
      //
      // loadWebhooksFromDatabase() restores only { method, authType,
      // workflowId } — credentials are deliberately not persisted — so after a
      // restart a webhook can declare an authType while holding no secret.
      //
      // Never compare against an absent secret. String interpolation turns one
      // into a fixed, guessable literal, which is the opposite of a check. Ask
      // whether the secret exists FIRST, and refuse if it does not.
      //
      // Refusing costs nothing that worked: with no secret in memory a
      // legitimate sender could not have matched either. Fail-open becomes
      // fail-closed. Re-saving the workflow restores the credential.
      const expectedSecret =
        authTypeLower === 'basic' ? webhook.username || webhook.password : webhook.authToken;
      if (!expectedSecret) {
        console.warn(
          `LocalWebhookReceiver: webhook ${workflowId} declares ${webhook.authType} auth but holds no credential ` +
            `(not restored after restart) — refusing. Re-save the workflow to restore its webhook credential.`
        );
        return { status: 401, message: 'Unauthorized' };
      }

      if (authTypeLower === 'basic') {
        const authHeader = triggerData.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          console.log(`LocalWebhookReceiver: Unauthorized - Basic auth failed for webhook ${workflowId}`);
          return { status: 401, message: 'Unauthorized - Basic auth failed' };
        }
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const separator = credentials.indexOf(':');
        const username = separator === -1 ? credentials : credentials.slice(0, separator);
        const password = separator === -1 ? '' : credentials.slice(separator + 1);
        if (!safeEqual(username, webhook.username) || !safeEqual(password, webhook.password)) {
          console.log(`LocalWebhookReceiver: Unauthorized - Invalid credentials for webhook ${workflowId}`);
          return { status: 401, message: 'Unauthorized - Invalid credentials' };
        }
      } else if (authTypeLower === 'bearer' || authTypeLower === 'webhook') {
        const providedToken = triggerData.headers['authorization'] || triggerData.headers['x-webhook-token'];
        if (!providedToken || !safeEqual(providedToken, `Bearer ${webhook.authToken}`)) {
          console.log(`LocalWebhookReceiver: Unauthorized - Invalid token for webhook ${workflowId}`);
          return { status: 401, message: 'Unauthorized - Invalid token' };
        }
      }
    }

    const result = await this._triggerWorkflow(workflowId, triggerData, webhook.responseMode === 'Wait for Result');

    // If result is null, workflow isn't ready - return null to signal retry
    if (result === null) {
      return null;
    }

    if (webhook.responseMode === 'Wait for Result' && result) {
      // Resolve the response body template
      const activeEngine = this.processManager.activeWorkflows.get(workflowId);
      let responseBody = result; // Default to full result if no template

      if (webhook.responseBody && activeEngine) {
        try {
          responseBody = activeEngine.parameterResolver.resolveTemplate(webhook.responseBody);
          // Try to parse as JSON if the content type implies JSON
          if (webhook.responseContentType === 'application/json' && typeof responseBody === 'string') {
            try {
              responseBody = JSON.parse(responseBody);
            } catch (e) {
              // Keep as string if parsing fails
            }
          }
        } catch (error) {
          console.error(`Error resolving response body template for workflow ${workflowId}:`, error);
        }
      }

      return {
        status: 200,
        headers: {
          'Content-Type': webhook.responseContentType || 'application/json',
        },
        body: responseBody,
        outputs: result.outputs, // Keep raw outputs for polling confirmation if needed
      };
    }

    if (result === null) {
      return null;
    }
    return result || { status: 200, message: 'Webhook processed successfully' };
  }
  async _triggerWorkflow(workflowId, triggerData, waitForCompletion = false) {
    console.log(`LocalWebhookReceiver: Attempting trigger for workflow ID: ${workflowId}, Wait: ${waitForCompletion}`);
    const activeEngine = this.processManager.activeWorkflows.get(workflowId);
    if (activeEngine && (activeEngine.isListening || activeEngine.isRunning)) {
      console.log(`LocalWebhookReceiver: Triggering workflow ${workflowId}`);
      return await activeEngine.processWorkflowTrigger(triggerData, { waitForCompletion });
    } else {
      console.log(`LocalWebhookReceiver: Workflow ${workflowId} not found locally or not in listening state.`);
      console.log(`Active Workflows: ${Array.from(this.processManager.activeWorkflows.keys()).join(', ')}`);
      if (this.processManager.activeWorkflows.has(workflowId)) {
        const engine = this.processManager.activeWorkflows.get(workflowId);
        console.log(`Engine state for ${workflowId}: isListening=${engine.isListening}, isRunning=${engine.isRunning}`);
      }
      return null;
    }
  }
  async unregisterWebhook(workflowId, ownerIdHint = null) {
    console.log(`LocalWebhookReceiver: Unregistering webhook for workflow ${workflowId}`);

    // Read the owner BEFORE dropping the in-memory entry, so the scoped delete
    // below can avoid a database round trip when we already know it.
    ownerIdHint = ownerIdHint || this.webhooks.get(workflowId)?.userId || null;

    // Remove from local memory
    this.webhooks.delete(workflowId);

    // Unregister from remote server
    try {
      const response = await axios.post(
        `${this.remoteUrl}/webhooks/unregister`,
        { workflowId },
        { headers: authHeader() }
      );
      if (response.data.success) {
        console.log(`LocalWebhookReceiver: Successfully unregistered webhook on remote for workflow ${workflowId}`);
      } else {
        console.warn(`LocalWebhookReceiver: Remote unregister returned: ${response.data.error}`);
      }
    } catch (error) {
      console.error(`LocalWebhookReceiver: Error unregistering webhook on remote for workflow ${workflowId}:`, error.message);
      // Continue even if remote unregister fails
    }

    // Remove from local database.
    //
    // Ownership is already established upstream (deactivateWorkflow takes a
    // userId), but the delete is still scoped: resolving the owner here keeps
    // WebhookModel's "every delete names its tenant" invariant intact without
    // an unscoped escape hatch that the next caller would inherit.
    try {
      const ownerId = ownerIdHint || (await WebhookModel.findOwnerId(workflowId));
      if (!ownerId) {
        console.log(`No local webhook row to remove for workflow ${workflowId}`);
      } else {
        await WebhookModel.deleteByWorkflowId(workflowId, ownerId);
        console.log(`Webhook removed from local database for workflow ${workflowId}`);
      }
    } catch (dbError) {
      console.error(`Error removing webhook from local database: ${dbError.message}`);
    }
  }

  async loadWebhooksFromDatabase() {
    try {
      const webhooks = await WebhookModel.loadAll();
      console.log(`Loading ${webhooks.length} webhooks from database`);

      for (const webhook of webhooks) {
        this.webhooks.set(webhook.workflow_id, {
          method: webhook.method,
          authType: webhook.auth_type,
          workflowId: webhook.workflow_id,
          // Note: We don't store sensitive auth credentials in DB, only metadata
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
