import axios from 'axios';
import { EventEmitter } from 'events';

class EmailReceiver extends EventEmitter {
  constructor(processManager) {
    super();
    this.processManager = processManager;
    this.remoteUrl = process.env.REMOTE_URL;
    this.pollInterval = null;
    this.activeTriggers = new Set(); // Track active triggers

    this.startPolling();
    console.log('Local EmailReceiver instantiated and polling started.');
  }
  startPolling() {
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
      const response = await axios.get(`${this.remoteUrl}/email/poll`);
      const { triggers } = response.data;

      // Only log if there are triggers to process
      if (triggers.length === 0) return;

      console.log(`Local EmailReceiver: Received ${triggers.length} workflow triggers`);

      const processedTriggerIds = [];

      for (const trigger of triggers) {
        console.log('Local EmailReceiver: Trigger data:', trigger);
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
          await axios.post(`${this.remoteUrl}/email/confirm-processed`, { processedTriggerIds });
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
    console.log('Local EmailReceiver: Email:', email);
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
