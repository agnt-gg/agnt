import express from 'express';
import { authenticateToken } from './Middleware.js';
import WorkflowService from '../services/WorkflowService.js';
import WorkflowVersionService from '../services/WorkflowVersionService.js';

// Set up new route
const WorkflowRoutes = express.Router();

// Define routes
WorkflowRoutes.get('/health', WorkflowService.healthCheck);
WorkflowRoutes.get('/', authenticateToken, WorkflowService.getAllWorkflows);
WorkflowRoutes.post('/save', authenticateToken, WorkflowService.saveWorkflow);
WorkflowRoutes.post('/analyze-dependencies', authenticateToken, (req, res) => WorkflowService.analyzeDependencies(req, res));
WorkflowRoutes.get('/:id', authenticateToken, WorkflowService.getWorkflowById);
WorkflowRoutes.put('/:id', authenticateToken, WorkflowService.updateWorkflow);
WorkflowRoutes.delete('/:id', authenticateToken, WorkflowService.deleteWorkflow);
WorkflowRoutes.put('/:id/name', authenticateToken, WorkflowService.renameWorkflow);
WorkflowRoutes.get('/:id/status', authenticateToken, WorkflowService.fetchWorkflowState);
WorkflowRoutes.post('/:id/start', authenticateToken, WorkflowService.activateWorkflow);
WorkflowRoutes.post('/:id/stop', authenticateToken, WorkflowService.deactivateWorkflow);

// ============================================================================
// WORKFLOW VERSION CONTROL ROUTES
// ============================================================================

// GET /api/workflows/:id/versions - List versions
WorkflowRoutes.get('/:workflowId/versions', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { limit, offset, checkpointsOnly } = req.query;

    const versions = await WorkflowVersionService.getVersionHistory(workflowId, {
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      checkpointsOnly: checkpointsOnly === 'true',
    });

    res.json({ success: true, versions });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error listing versions:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workflows/:id/versions/:versionId - Get specific version
WorkflowRoutes.get('/:workflowId/versions/:versionId', authenticateToken, async (req, res) => {
  try {
    const { workflowId, versionId } = req.params;
    const version = await WorkflowVersionService.getVersion(workflowId, parseInt(versionId));

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    res.json({ success: true, version });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error getting version:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workflows/:id/revert - Revert to version
WorkflowRoutes.post('/:workflowId/revert', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      return res.status(400).json({ error: 'versionId is required' });
    }

    const result = await WorkflowVersionService.revertToVersion(workflowId, parseInt(versionId));

    // Broadcast update to all clients
    if (req.app.get('io')) {
      req.app.get('io').emit('workflow:reverted', {
        workflowId,
        versionNumber: result.revertedToVersion,
        workflowState: result.workflowState,
      });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error reverting workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workflows/:id/checkpoint - Create checkpoint
WorkflowRoutes.post('/:workflowId/checkpoint', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { name, currentWorkflowState } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Checkpoint name is required' });
    }

    if (!currentWorkflowState) {
      return res.status(400).json({ error: 'Current workflow state is required' });
    }

    const result = await WorkflowVersionService.createCheckpoint(workflowId, name, currentWorkflowState);

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error creating checkpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workflows/:id/versions/compare - Compare versions
WorkflowRoutes.get('/:workflowId/versions/compare', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { versionA, versionB } = req.query;

    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'Both versionA and versionB are required' });
    }

    const diff = await WorkflowVersionService.compareVersions(workflowId, parseInt(versionA), parseInt(versionB));

    res.json({ success: true, diff });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error comparing versions:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workflows/:id/versions/stats - Storage stats
WorkflowRoutes.get('/:workflowId/versions/stats', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    const stats = await WorkflowVersionService.getStorageStats(workflowId);

    res.json({ success: true, stats });
  } catch (error) {
    console.error('[WorkflowVersionRoutes] Error getting version stats:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log(`Workflow Routes Started...`);

export default WorkflowRoutes;
