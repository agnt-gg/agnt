import express from 'express';
import GoalService from '../services/GoalService.js';
import { authenticateToken } from './Middleware.js';
import { requireOwnedGoal } from './goalOwnership.js';

const GoalRoutes = express.Router();

// Every route that names a goal checks that the caller owns it first.
const ownGoal = requireOwnedGoal('id');
const ownGoalById = requireOwnedGoal('goalId');

GoalRoutes.get('/health', GoalService.healthCheck);
GoalRoutes.get('/', authenticateToken, GoalService.getAllGoals);
GoalRoutes.get('/summary', authenticateToken, GoalService.getAllGoalsSummary);
GoalRoutes.post('/create', authenticateToken, GoalService.createGoal);
GoalRoutes.post('/:goalId/execute', authenticateToken, ownGoalById, GoalService.executeGoal);
GoalRoutes.get('/:id', authenticateToken, ownGoal, GoalService.getGoal);
GoalRoutes.get('/:id/status', authenticateToken, ownGoal, GoalService.getGoalStatus);
GoalRoutes.post('/:id/pause', authenticateToken, ownGoal, GoalService.pauseGoal);
GoalRoutes.post('/:id/resume', authenticateToken, ownGoal, GoalService.resumeGoal);
GoalRoutes.delete('/:id', authenticateToken, ownGoal, GoalService.deleteGoal);

// AGI Loop endpoints
GoalRoutes.post('/:goalId/execute-autonomous', authenticateToken, ownGoalById, GoalService.executeGoalAutonomous);
GoalRoutes.get('/:goalId/iterations', authenticateToken, ownGoalById, GoalService.getIterations);
GoalRoutes.get('/:goalId/world-state', authenticateToken, ownGoalById, GoalService.getWorldState);
GoalRoutes.post('/:goalId/revert/:iteration', authenticateToken, ownGoalById, GoalService.revertToIteration);

// Review endpoint (approve/reject needs_review goals)
GoalRoutes.post('/:id/review', authenticateToken, ownGoal, GoalService.reviewGoal);

// Evaluation endpoints
GoalRoutes.post('/:id/evaluate', authenticateToken, ownGoal, GoalService.evaluateGoal);
GoalRoutes.get('/:id/evaluation', authenticateToken, ownGoal, GoalService.getEvaluationReport);

// Golden standards endpoints
GoalRoutes.post('/:id/golden-standard', authenticateToken, ownGoal, GoalService.saveAsGoldenStandard);
GoalRoutes.get('/golden-standards/list', authenticateToken, GoalService.getGoldenStandards);

console.log(`Goal Routes Started...`);

export default GoalRoutes;
