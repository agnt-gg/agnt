import express from 'express';
import RunService from '../services/RunService.js';
import { authenticateToken } from './Middleware.js';

// Set up new route
const ContentOutputRoutes = express.Router();

// Define routes
ContentOutputRoutes.get('/health', RunService.healthCheck);
ContentOutputRoutes.get('/', authenticateToken, RunService.getAllContentOutputs);
ContentOutputRoutes.post('/save', authenticateToken, RunService.saveOrUpdateContentOutput);
ContentOutputRoutes.get('/:id', authenticateToken, RunService.getContentOutput);
ContentOutputRoutes.put('/:id', authenticateToken, RunService.saveOrUpdateContentOutput);
ContentOutputRoutes.patch('/:id/rename', authenticateToken, RunService.renameContentOutput);
ContentOutputRoutes.delete('/:id', authenticateToken, RunService.deleteContentOutput);

// Additional routes specific to content outputs
ContentOutputRoutes.get('/workflow/:workflowId', authenticateToken, RunService.getContentOutputsByWorkflow);
ContentOutputRoutes.get('/tool/:toolId', authenticateToken, RunService.getContentOutputsByTool);

console.log(`Content Output Routes Started...`);

export default ContentOutputRoutes;
