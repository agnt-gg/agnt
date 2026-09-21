import { EventEmitter } from 'events';
import { listInbound } from '../../services/agntMail.js';
import { serviceFailure } from '../../services/agntServices.js';

/**
 * Inbound email trigger, served by mail.agnt.gg.
 *
 * The account has one hosted inbox; every workflow with a "Built-in Email"
 * receive-email trigger listens on it. This receiver polls the inbox since a
 * cursor and offers each new message to every listening engine. The cursor
 * advances only past messages that at least one engine accepted, so a message
 * arriving while a workflow is still starting is seen again on the next poll.
 *
 * Hosted mail is part of AGNT Pro. A free account's poll gets a plan refusal,
 * which is logged once per poll; nothing is queued locally for it.
 */
class EmailReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.pollInterval = null;
    this.activeTriggers = new Set();
    this.since = Date.now();
    this.polling = false;
    this.lastDenial = 0;
    this.pollingEnabled = process.env.AGNT_DISABLE_EXTERNAL_POLLING !== 'true';

    if (this.pollingEnabled) {
      this.startPolling();
      console.log('Local EmailReceiver instantiated and polling started.');
    } else {
      console.log('Local EmailReceiver instantiated with external polling disabled.');
    }
  }

  startPolling() {
    if (!this.pollingEnabled || this.pollInterval) return;
    console.log('Local EmailReceiver: Starting polling...');
    this.pollInterval = setInterval(() => this.pollForTriggers(), 10000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Local EmailReceiver: Polling stopped.');
    }
  }

  /** Engines currently listening on the built-in inbox. */
  _listeningWorkflows() {
    const out = [];
    for (const [workflowId, engine] of this.processManager.activeWorkflows) {
      if (!(engine.isListening || engine.isRunning)) continue;
      const nodes = engine.workflow?.nodes || engine.nodes || [];
      const usesBuiltIn = nodes.some((n) => n.type === 'receive-email' && (n.parameters?.emailConfig || 'Built-in Email') === 'Built-in Email');
      if (usesBuiltIn) out.push(workflowId);
    }
    return out;
  }

  async pollForTriggers() {
    if (this.polling) return;
    const workflowIds = this._listeningWorkflows();
    if (workflowIds.length === 0) return; // nobody listening: do not spend a request
    this.polling = true;
    try {
      let inbox, messages;
      try {
        ({ inbox, messages } = await listInbound({ since: this.since }));
      } catch (error) {
        const failure = serviceFailure(error);
        if (Date.now() - this.lastDenial > 60000) {
          console.error(`Local EmailReceiver: ${failure.message || failure.error}`);
          this.lastDenial = Date.now();
        }
        return;
      }
      if (!messages.length) return;
      console.log(`Local EmailReceiver: ${messages.length} new message(s) on ${inbox.address}`);

      let advanced = this.since;
      for (const message of messages) {
        let accepted = false;
        for (const workflowId of workflowIds) {
          if (await this._triggerWorkflowByEmail(workflowId, message)) accepted = true;
        }
        if (!accepted) break; // engines not ready: leave the cursor here
        advanced = Math.max(advanced, message.createdAt || advanced);
      }
      this.since = advanced;
    } catch (error) {
      console.error('Local EmailReceiver: Error polling for inbound mail:', error);
    } finally {
      this.polling = false;
    }
  }

  async _triggerWorkflowByEmail(workflowId, message) {
    if (this.activeTriggers.has(workflowId)) return false;
    const activeEngine = this.processManager.activeWorkflows.get(workflowId);
    if (!activeEngine || !(activeEngine.isListening || activeEngine.isRunning)) return false;

    // Sender and subject are enough to trace a delivery; the body stays out of the log.
    console.log(`Local EmailReceiver: triggering ${workflowId} with mail from=${message.from ?? '<unknown>'} subject=${JSON.stringify(message.subject ?? '')}`);
    const triggerData = {
      type: 'email',
      id: message.id,
      from: message.from,
      to: message.to,
      subject: message.subject,
      body: message.text ?? '',
      html: undefined, // the service returns plain text; html is not carried
      attachments: message.attachments || [],
      messageId: message.messageId,
      replyTo: message.replyTo,
      receivedAt: message.createdAt,
    };

    this.activeTriggers.add(workflowId);
    try {
      await activeEngine.processWorkflowTrigger(triggerData);
      return true;
    } catch (error) {
      console.error(`Local EmailReceiver: Error triggering workflow ${workflowId}:`, error);
      return false;
    } finally {
      this.activeTriggers.delete(workflowId);
    }
  }

  shutdown() {
    this.stopPolling();
    console.log('Local EmailReceiver: Shut down.');
  }
}

export default EmailReceiver;
