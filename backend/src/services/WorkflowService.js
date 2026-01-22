import WorkflowModel from '../models/WorkflowModel.js';
import WebhookModel from '../models/WebhookModel.js';
import WorkflowProcessBridge from '../workflow/WorkflowProcessBridge.js';
import generateUUID from '../utils/generateUUID.js';
import { broadcast, RealtimeEvents } from '../utils/realtimeSync.js';

class WorkflowService {
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }
  async saveWorkflow(req, res) {
    try {
      const { workflow } = req.body;
      const userId = req.user.userId;

      // Generate a new ID if missing
      if (!workflow.id) {
        workflow.id = generateUUID();
      }

      // Find existing row (whether the user owns it or not)
      const existingWorkflow = await WorkflowModel.findOne(workflow.id);

      // Remove ‘status’ so we don't overwrite the DB column
      delete workflow.status;

      // Upsert the workflow changes
      await WorkflowModel.createOrUpdate(workflow.id, JSON.stringify(workflow), userId, workflow.isShareable);

      /**
       *  If the workflow was already active (listening/running/queued),
       *  we can automatically restart it to pull the updated version from DB.
       *  This means it will lose any ephemeral state from before —
       *  it's a 'stop' + 're-activate'.
       */
      try {
        const currentState = await WorkflowProcessBridge.fetchWorkflowState(workflow.id, userId);
        if (['running', 'listening', 'queued'].includes(currentState.status)) {
          console.log(`Detected active workflow with status: ${currentState.status}`);
          await WorkflowProcessBridge.deactivateWorkflow(workflow.id, userId);

          // Re-fetch the updated record
          const updatedRecord = await WorkflowModel.findOne(workflow.id);
          const updatedWorkflow = JSON.parse(updatedRecord.workflow_data);
          updatedWorkflow.id = workflow.id;

          // Now activate the updated workflow
          console.log('Automatically restarting workflow with new changes…');
          await WorkflowProcessBridge.activateWorkflow(updatedWorkflow, userId);
        }
      } catch (error) {
        // If workflow process is not ready yet, skip the restart check
        console.log('Workflow process not ready yet, skipping restart check');
      }

      // Broadcast real-time update to all connected clients
      broadcast(existingWorkflow ? RealtimeEvents.WORKFLOW_UPDATED : RealtimeEvents.WORKFLOW_CREATED, {
        id: workflow.id,
        name: workflow.name,
        userId: userId,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({
        message: existingWorkflow ? 'Workflow updated' : 'New workflow created',
        workflowId: workflow.id,
      });
    } catch (error) {
      console.error('Error saving workflow:', error);
      res.status(500).json({ error: 'Failed to save workflow', details: error.message });
    }
  }
  async updateWorkflow(req, res) {
    try {
      const workflowData = JSON.stringify(req.body.workflow);
      const result = await WorkflowModel.update(req.params.id, workflowData, req.user.userId);

      // Broadcast real-time update to all connected clients
      broadcast(RealtimeEvents.WORKFLOW_UPDATED, {
        id: req.params.id,
        name: req.body.workflow.name,
        userId: req.user.userId,
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: result === 1 ? 'Workflow updated' : 'New workflow created',
        workflowId: req.params.id,
      });
    } catch (error) {
      console.error('Error updating workflow:', error);
      res.status(500).json({ error: 'Failed to update workflow', details: error.message });
    }
  }
  async getAllWorkflows(req, res) {
    try {
      const workflows = await WorkflowModel.findAllByUserId(req.user.userId);
      const mappedWorkflows = workflows.map((row) => {
        const data = JSON.parse(row.workflow_data);
        return {
          ...data,
          id: row.id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          status: row.status,
        };
      });
      res.json({ workflows: mappedWorkflows });
    } catch (error) {
      console.error('Error retrieving workflows:', error);
      res.status(500).json({ error: 'Error retrieving workflows' });
    }
  }
  async getWorkflowById(req, res) {
    try {
      const workflow = await WorkflowModel.findOne(req.params.id);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      if (workflow.is_shareable || workflow.user_id === req.user.userId) {
        res.json({
          id: workflow.id,
          user_id: workflow.user_id,
          workflow: JSON.parse(workflow.workflow_data),
          created_at: workflow.created_at,
          updated_at: workflow.updated_at,
          is_shareable: Boolean(workflow.is_shareable),
        });
      } else {
        res.status(403).json({ error: 'You do not have permission to view this workflow' });
      }
    } catch (error) {
      console.error('Error retrieving workflow:', error);
      res.status(500).json({ error: 'Error retrieving workflow' });
    }
  }
  async renameWorkflow(req, res) {
    try {
      const workflow = await WorkflowModel.findOne(req.params.id, req.user.userId);
      if (!workflow) {
        const newWorkflow = { name: req.body.name, nodes: [], edges: [] };
        await WorkflowModel.create(req.params.id, JSON.stringify(newWorkflow), req.user.userId);
        res.json({
          message: 'New workflow created with name',
          id: req.params.id,
        });
      } else {
        const workflowData = JSON.parse(workflow.workflow_data);
        workflowData.name = req.body.name;
        await WorkflowModel.update(req.params.id, JSON.stringify(workflowData), req.user.userId);
        res.json({
          message: 'Workflow name updated successfully',
          id: req.params.id,
        });
      }
    } catch (error) {
      console.error('Error updating workflow name:', error);
      res.status(500).json({
        error: 'Failed to update workflow name',
        details: error.message,
      });
    }
  }
  async deleteWorkflow(req, res) {
    try {
      // Deactivate workflow (this also unregisters webhook)
      await WorkflowProcessBridge.deactivateWorkflow(req.params.id, req.user.userId);

      // Delete webhook from database
      await WebhookModel.deleteByWorkflowId(req.params.id);

      // Delete workflow from database
      await WorkflowModel.delete(req.params.id, req.user.userId);

      // Broadcast real-time deletion to all connected clients
      broadcast(RealtimeEvents.WORKFLOW_DELETED, {
        id: req.params.id,
        userId: req.user.userId,
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Workflow ${req.params.id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      res.status(500).json({ error: 'Failed to delete workflow', details: error.message });
    }
  }
  async fetchWorkflowState(req, res) {
    try {
      const status = await WorkflowProcessBridge.fetchWorkflowState(req.params.id, req.user.userId);
      res.json(status);
    } catch (error) {
      console.error('Error retrieving workflow status:', error);
      // If workflow process is not ready, return a temporary status
      if (error.message.includes('not ready')) {
        res.json({ status: 'initializing', message: 'Workflow process is starting up' });
      } else {
        res.status(500).json({ error: 'Error retrieving workflow status' });
      }
    }
  }
  async activateWorkflow(req, res) {
    try {
      const workflow = await WorkflowModel.findOne(req.params.id, req.user.userId);
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      const result = await WorkflowProcessBridge.activateWorkflow(JSON.parse(workflow.workflow_data), req.user.userId);
      res.json(result);
    } catch (error) {
      console.error('Error starting workflow:', error);
      res.status(500).json({ error: 'Failed to start workflow', details: error.message });
    }
  }
  async deactivateWorkflow(req, res) {
    try {
      const result = await WorkflowProcessBridge.deactivateWorkflow(req.params.id, req.user.userId);
      res.json(result);
    } catch (error) {
      console.error('Error stopping workflow:', error);
      res.status(500).json({ error: 'Failed to stop workflow', details: error.message });
    }
  }
}

console.log(`Workflow Controller Started...`);

export default new WorkflowService();
