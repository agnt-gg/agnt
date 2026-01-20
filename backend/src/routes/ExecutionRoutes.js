import express from 'express';
import { authenticateToken } from './Middleware.js';
import RunService from '../services/RunService.js';

const ExecutionRoutes = express.Router();

// Workflow executions
ExecutionRoutes.get('/', authenticateToken, RunService.getExecutions);
ExecutionRoutes.post('/activity', authenticateToken, RunService.getAgentActivityData);
ExecutionRoutes.get('/:id', authenticateToken, RunService.getExecutionDetails);

// Agent/Orchestrator executions
ExecutionRoutes.get('/agents/list', authenticateToken, RunService.getAgentExecutions);
ExecutionRoutes.get('/agents/:id', authenticateToken, RunService.getAgentExecutionDetails);
ExecutionRoutes.delete('/agents/:id', authenticateToken, RunService.deleteAgentExecution);
ExecutionRoutes.post('/agents/clear-completed', authenticateToken, RunService.clearCompletedAgentExecutions);

export default ExecutionRoutes;
