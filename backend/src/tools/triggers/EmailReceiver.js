import axios from 'axios';
import { EventEmitter } from 'events';
import { authHeader } from '../../services/auth/sessionTokenCache.js';

/**
 * Inbound email trigger poller.
 *
 * IDENTIFIES ITSELF. Every call below carries the user's session token when one
 * is known. The remote /email/poll returns pending triggers and
 * /email/confirm-processed deletes them, and until now both went out with no
 * credential at all — so the server had to serve anonymous callers, which meant
 * it could not scope results to an owner and anyone could read or delete any
 * user's inbound mail.
 *
 * The header is inert today: the matching server routes are behind an
 * enforcement gate that is in shadow, so it is accepted and counted but not
 * required. That is the point — the client learns to identify itself first,
 * the server starts insisting only once the counters show adoption.
 *
 * If no token is known yet (fresh start, nobody has opened the UI), the header
 * is simply absent and the call behaves exactly as it does today.
 */
class EmailReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.remoteUrl = process.env.REMOTE_URL;
    this.pollInterval = null;
    this.activeTriggers = new Set(); // Track active triggers
    this.pollingEnabled = process.env.AGNT_DISABLE_EXTERNAL_POLLING !== 'true';

    if (this.pollingEnabled) {
      this.startPolling();
      console.log('Local EmailReceiver instantiated and polling started.');
    } else {
      console.log('Local EmailReceiver instantiated with external polling disabled.');
    }
  }

  startPolling() {
    if (!this.pollingEnabled) return;
    console.log('Local EmailReceiver: Starting polling...');
    this.pollInterval = setInterval(() => {
      this.pollForTriggers();
    }, 10000); // Poll every 10 seconds
  }
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Local EmailReceiver: Polling stopped.');
    }
  }
  async pollForTriggers() {
    try {
      const response = await axios.get(`${this.remoteUrl}/email/poll`, { headers: authHeader() });
      const { triggers } = response.data;

      // Only log if there are triggers to process
      if (triggers.length === 0) return;

      console.log(`Local EmailReceiver: Received ${triggers.length} workflow triggers`);

      const processedTriggerIds = [];

      for (const trigger of triggers) {
        // Identifiers only — `trigger` carries the whole inbound email.
        console.log(`Local EmailReceiver: processing trigger ${trigger.id} for workflow ${trigger.workflowId}`);
        const success = await this._triggerWorkflowByEmail(trigger.workflowId, trigger.triggerData);
        // Only confirm if the workflow was actually triggered
        // If workflow not found in this process, let the other process handle it
        if (success) {
          processedTriggerIds.push(trigger.id);
        } else {
          console.log(`Local EmailReceiver: Workflow ${trigger.workflowId} not ready, will retry on next poll`);
        }
      }

      // Confirm processed triggers
      if (processedTriggerIds.length > 0) {
        try {
          await axios.post(
            `${this.remoteUrl}/email/confirm-processed`,
            { processedTriggerIds },
            { headers: authHeader() }
          );
          console.log(`Local EmailReceiver: Confirmed processing of ${processedTriggerIds.length} triggers`);
        } catch (confirmError) {
          console.error('Local EmailReceiver: Error confirming processed triggers:', confirmError);
        }
      }
    } catch (error) {
      console.error('Local EmailReceiver: Error polling for workflow triggers:', error);
    }
  }
  async _triggerWorkflowByEmail(workflowId, email) {
    console.log('Local EmailReceiver: Attempting trigger for workflow id:', workflowId);
    // The sender and subject are enough to trace a delivery. The full `email`
    // object carries the body, the HTML part and every attachment, which then
    // sat in the process log and in any support bundle collected from it.
    console.log(`Local EmailReceiver: email from=${email?.from ?? '<unknown>'} subject=${JSON.stringify(email?.subject ?? '')}`);
    console.log('Local EmailReceiver: Active workflows:', Array.from(this.processManager.activeWorkflows.keys()));

    // Check if the workflow is already being triggered
    if (this.activeTriggers.has(workflowId)) {
      console.log(`Local EmailReceiver: Workflow ${workflowId} is already being triggered. Skipping.`);
      return false;
    }

    const activeEngine = this.processManager.activeWorkflows.get(workflowId);
    if (activeEngine && (activeEngine.isListening || activeEngine.isRunning)) {
      console.log(`Local EmailReceiver: Triggering workflow ${workflowId}`);
      const triggerData = {
        type: 'email',
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        html: email.html,
        attachments: email.attachments,
      };

      // Add to active triggers
      this.activeTriggers.add(workflowId);

      try {
        await activeEngine.processWorkflowTrigger(triggerData);
        return true;
      } catch (error) {
        console.error(`Local EmailReceiver: Error processing workflow ${workflowId}:`, error);
        return false;
      } finally {
        // Remove from active triggers
        this.activeTriggers.delete(workflowId);
      }
    } else {
      console.log(`Local EmailReceiver: Workflow ${workflowId} not found in active workflows or not in listening state. Ignoring email trigger.`);
      return false;
    }
  }
}

export default EmailReceiver;
