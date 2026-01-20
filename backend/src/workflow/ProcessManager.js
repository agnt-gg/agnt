import { EventEmitter } from 'events';
import db from '../models/database/index.js';
import ProcessWorker from './ProcessWorker.js';
import WorkflowModel from '../models/WorkflowModel.js';
import EmailReceiver from '../tools/triggers/EmailReceiver.js';
import WebhookReceiver from '../tools/triggers/WebhookReceiver.js';

class ProcessManager extends EventEmitter {
  constructor(numWorkers = 8, webhookPort = 3001) {
    super();
    this.queue = [];
    this.workers = new Array(numWorkers).fill(null).map(() => new ProcessWorker(this));
    this.activeWorkflows = new Map();
    this.pendingWorkflows = new Set();
    this.enqueuingWorkflows = new Set();
    this.maxConcurrentWorkflows = 100; // Limit total active workflows to prevent resource exhaustion
    this.EmailReceiver = new EmailReceiver(this);
    this.WebhookReceiver = new WebhookReceiver(this, webhookPort);
  }

  // PUBLIC METHODS
  async activateWorkflow(workflow, userId, triggerData) {
    const workflowId = workflow.id;

    if (this._isWorkflowInQueueOrActive(workflowId)) {
      console.log(`Workflow ${workflowId} is already queued, active, pending, or being enqueued`);
      return {
        error: 'Workflow is already queued or running',
        workflowId: workflowId,
      };
    }

    // Check concurrent workflow limit
    if (this.activeWorkflows.size >= this.maxConcurrentWorkflows) {
      console.log(`Max concurrent workflows (${this.maxConcurrentWorkflows}) reached. Queuing workflow ${workflowId}.`);
      // Still queue it, but log the limit for monitoring
    }

    try {
      this.queue.push({ workflow, userId, triggerData });
      console.log(`Workflow ${workflowId} scheduled to queue for execution. Queue length: ${this.queue.length}`);
      await this._updateWorkflowStatus(workflowId, 'queued');
      this.emit('workAdded');
      this.assignWorkToWorkers();
      this.EmailReceiver.startPolling();
      this.WebhookReceiver.startPolling();
      return {
        message: 'Workflow queued for execution',
        workflowId: workflowId,
      };
    } catch (error) {
      console.error(`Error enqueueing workflow ${workflowId}:`, error);
      return { error: 'Failed to enqueue workflow', workflowId: workflowId };
    }
  }
  async deactivateWorkflow(workflowId, userId) {
    console.log(`Attempting to stop workflow ${workflowId}`);

    // Remove from queue if present
    this.queue = this.queue.filter((job) => job.workflow.id !== workflowId);

    // Stop active workflow
    const workflowEngine = this.activeWorkflows.get(workflowId);
    if (workflowEngine) {
      await workflowEngine.stopWorkflowListeners();
      this.activeWorkflows.delete(workflowId);

      // Explicitly unregister webhook
      if (this.WebhookReceiver) {
        await this.WebhookReceiver.unregisterWebhook(workflowId);
      }
    }

    // Stop any worker processing this workflow
    for (const worker of this.workers) {
      if (worker.currentWorkflow && worker.currentWorkflow.id === workflowId) {
        await worker.stopCurrentProcessing();
      }
    }

    // Update workflow status
    await this._updateWorkflowStatus(workflowId, 'stopped');

    // Emit status update
    this.emit('workflowStatusUpdate', workflowId, {
      status: 'stopped',
      isActive: false,
      queueLength: this.queue.length,
      activeWorkflowsCount: this.activeWorkflows.size,
      workersCount: this.workers.length,
      busyWorkersCount: this.workers.filter((w) => w.isBusy).length,
    });

    // Release resources
    this.releaseResources();

    console.log(`Workflow ${workflowId} stopped`);
    return { message: 'Workflow stopped', isActive: false };
  }
  async fetchWorkflowState(workflowId, userId) {
    const workflowEngine = this.activeWorkflows.get(workflowId);
    if (workflowEngine) {
      let status;
      if (workflowEngine.stopRequested) {
        status = 'stopped';
      } else if (workflowEngine.isRunning) {
        status = 'running';
      } else {
        status = 'listening';
      }

      return {
        status: status,
        outputs: workflowEngine.outputs || {},
        errors: workflowEngine.errors || {},
        currentNodeId: workflowEngine.currentNodeId,
        activeEdges: Array.from(workflowEngine.activeEdges || []),
        queueLength: this.queue.length,
        activeWorkflowsCount: this.activeWorkflows.size,
        workersCount: this.workers.length,
        busyWorkersCount: this.workers.filter((w) => w.isBusy).length,
      };
    } else if (this.queue.some((job) => job.workflow.id === workflowId)) {
      return {
        status: 'queued',
        queueLength: this.queue.length,
        activeWorkflowsCount: this.activeWorkflows.size,
        workersCount: this.workers.length,
        busyWorkersCount: this.workers.filter((w) => w.isBusy).length,
      };
    } else {
      return new Promise((resolve, reject) => {
        db.get('SELECT status FROM workflows WHERE id = ? AND user_id = ?', [workflowId, userId], (err, row) => {
          if (err) reject(err);
          else if (!row) resolve({ status: 'Not Found' });
          else
            resolve({
              status: row.status,
              queueLength: this.queue.length,
              activeWorkflowsCount: this.activeWorkflows.size,
              workersCount: this.workers.length,
              busyWorkersCount: this.workers.filter((w) => w.isBusy).length,
            });
        });
      });
    }
  }
  async restartActiveWorkflows() {
    try {
      console.log('Restarting active workflows...');
      const batchSize = 100; // Smaller batches for better responsiveness
      let offset = 0;
      let totalQueued = 0;

      while (true) {
        const activeWorkflows = await WorkflowModel.findByStatusBatch(['listening', 'running', 'queued'], batchSize, offset);
        if (activeWorkflows.length === 0) break;

        for (const workflowData of activeWorkflows) {
          const workflow = JSON.parse(workflowData.workflow_data);
          workflow.id = workflowData.id;

          // Queue the workflow for restart instead of immediately activating
          this.queue.push({ workflow, userId: workflowData.user_id, triggerData: null });
          totalQueued++;
        }

        offset += batchSize;
        console.log(`Queued ${totalQueued} workflows for restart so far...`);

        // Yield after each batch to prevent blocking
        await new Promise((resolve) => setImmediate(resolve));
      }

      console.log(`Queued ${totalQueued} workflows for restart. Beginning processing...`);

      // Start polling for restarted workflows
      if (totalQueued > 0) {
        this.EmailReceiver.startPolling();
        this.WebhookReceiver.startPolling();
      }

      this.assignWorkToWorkers();
    } catch (error) {
      console.error('Error queuing workflows for restart:', error);
    }
  }
  assignWorkToWorkers() {
    console.log(`Processing queue. Queue length: ${this.queue.length}`);
    let assignedCount = 0;

    this.workers.forEach((worker, index) => {
      while (!worker.isBusy && this.queue.length > 0) {
        const job = this.queue.shift();
        console.log(`Worker ${index} processing workflow ${job.workflow.id}`);
        worker.handleWorkflowTrigger(job, this.activeWorkflows);
        assignedCount++;
      }
    });

    console.log(`Assigned ${assignedCount} workflows to workers`);

    // If there are still items in the queue, schedule another round of assignments
    if (this.queue.length > 0) {
      setTimeout(() => this.assignWorkToWorkers(), 1000); // Adjust timeout as needed
    }
  }
  releaseResources() {
    // Only stop polling if there are no active workflows and no queued workflows
    if (this.activeWorkflows.size === 0 && this.queue.length === 0) {
      this.EmailReceiver.stopPolling();
      this.WebhookReceiver.shutdown();
    }
  }

  // PRIVATE METHODS
  async _updateWorkflowStatus(workflowId, status) {
    return new Promise((resolve, reject) => {
      db.run('UPDATE workflows SET status = ? WHERE id = ?', [status, workflowId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  _isWorkflowInQueueOrActive(workflowId) {
    // return (
    //   this.queue.some((job) => job.workflow.id === workflowId) ||
    //   (this.activeWorkflows.has(workflowId) &&
    //     this.activeWorkflows.get(workflowId).isRunning)
    // );
    return (
      this.queue.some((job) => job.workflow.id === workflowId) ||
      this.activeWorkflows.has(workflowId) ||
      this.pendingWorkflows.has(workflowId) ||
      this.enqueuingWorkflows.has(workflowId)
    );
  }
}

export default new ProcessManager();
