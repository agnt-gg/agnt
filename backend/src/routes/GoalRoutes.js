import express from 'express';
import GoalService from '../services/GoalService.js';
import { authenticateToken } from './Middleware.js';

const GoalRoutes = express.Router();

GoalRoutes.get('/health', GoalService.healthCheck);
GoalRoutes.get('/', authenticateToken, GoalService.getAllGoals);
GoalRoutes.post('/create', authenticateToken, GoalService.createGoal);
GoalRoutes.post('/:goalId/execute', authenticateToken, GoalService.executeGoal);
GoalRoutes.get('/:id', authenticateToken, GoalService.getGoal);
GoalRoutes.get('/:id/status', authenticateToken, GoalService.getGoalStatus);
GoalRoutes.post('/:id/pause', authenticateToken, GoalService.pauseGoal);
GoalRoutes.post('/:id/resume', authenticateToken, GoalService.resumeGoal);
GoalRoutes.delete('/:id', authenticateToken, GoalService.deleteGoal);

// Evaluation endpoints
GoalRoutes.post('/:id/evaluate', authenticateToken, GoalService.evaluateGoal);
GoalRoutes.get('/:id/evaluation', authenticateToken, GoalService.getEvaluationReport);

// Golden standards endpoints
GoalRoutes.post('/:id/golden-standard', authenticateToken, GoalService.saveAsGoldenStandard);
GoalRoutes.get('/golden-standards/list', authenticateToken, GoalService.getGoldenStandards);

console.log(`Goal Routes Started...`);

export default GoalRoutes;
