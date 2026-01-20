import express from 'express';
import { authenticateToken } from './Middleware.js';
import WorkflowService from '../services/WorkflowService.js';

// Set up new route
const WorkflowRoutes = express.Router();

// Define routes
WorkflowRoutes.get('/health', WorkflowService.healthCheck);
WorkflowRoutes.get('/', authenticateToken, WorkflowService.getAllWorkflows);
WorkflowRoutes.post('/save', authenticateToken, WorkflowService.saveWorkflow);
WorkflowRoutes.get('/:id', authenticateToken, WorkflowService.getWorkflowById);
WorkflowRoutes.put('/:id', authenticateToken, WorkflowService.updateWorkflow);
WorkflowRoutes.delete('/:id', authenticateToken, WorkflowService.deleteWorkflow);
WorkflowRoutes.put('/:id/name', authenticateToken, WorkflowService.renameWorkflow);
WorkflowRoutes.get('/:id/status', authenticateToken, WorkflowService.fetchWorkflowState);
WorkflowRoutes.post('/:id/start', authenticateToken, WorkflowService.activateWorkflow);
WorkflowRoutes.post('/:id/stop', authenticateToken, WorkflowService.deactivateWorkflow);

console.log(`Workflow Routes Started...`);

export default WorkflowRoutes;
