import express from 'express';
import GoalRunRecovery from '../services/goal/GoalRunRecovery.js';
import GoalService from '../services/GoalService.js';
import { authenticateToken } from './Middleware.js';

const GoalRoutes = express.Router();

GoalRoutes.get('/health', GoalService.healthCheck);
GoalRoutes.get('/', authenticateToken, GoalService.getAllGoals);
GoalRoutes.get('/summary', authenticateToken, GoalService.getAllGoalsSummary);
GoalRoutes.post('/create', authenticateToken, GoalService.createGoal);
GoalRoutes.post('/:goalId/execute', authenticateToken, GoalService.executeGoal);
GoalRoutes.get('/:id', authenticateToken, GoalService.getGoal);
GoalRoutes.get('/:id/recovery', authenticateToken, async (req,res) => {
  try { res.json(await GoalRunRecovery.inspect(req.params.id,req.user.userId || req.user.id)); }
  catch { res.status(404).json({error:'Goal recovery unavailable'}); }
});
GoalRoutes.post('/:id/recovery/resolve', authenticateToken, async (req,res) => {
  try {
    const body=req.body || {};
    res.json(await GoalRunRecovery.resolve(req.params.id,req.user.userId || req.user.id,body.runId,body));
  } catch { res.status(409).json({error:'Recovery resolution refused: verify ownership, run generation and evidence for every uncertain task'}); }
});
GoalRoutes.get('/:id/status', authenticateToken, GoalService.getGoalStatus);
GoalRoutes.post('/:id/pause', authenticateToken, GoalService.pauseGoal);
GoalRoutes.post('/:id/resume', authenticateToken, GoalService.resumeGoal);
GoalRoutes.delete('/:id', authenticateToken, GoalService.deleteGoal);

// AGI Loop endpoints
GoalRoutes.post('/:goalId/execute-autonomous', authenticateToken, GoalService.executeGoalAutonomous);
GoalRoutes.get('/:goalId/iterations', authenticateToken, GoalService.getIterations);
GoalRoutes.get('/:goalId/world-state', authenticateToken, GoalService.getWorldState);
GoalRoutes.post('/:goalId/revert/:iteration', authenticateToken, GoalService.revertToIteration);

// Review endpoint (approve/reject needs_review goals)
GoalRoutes.post('/:id/review', authenticateToken, GoalService.reviewGoal);

// Evaluation endpoints
GoalRoutes.post('/:id/evaluate', authenticateToken, GoalService.evaluateGoal);
GoalRoutes.get('/:id/evaluation', authenticateToken, GoalService.getEvaluationReport);

// Golden standards endpoints
GoalRoutes.post('/:id/golden-standard', authenticateToken, GoalService.saveAsGoldenStandard);
GoalRoutes.get('/golden-standards/list', authenticateToken, GoalService.getGoldenStandards);

console.log(`Goal Routes Started...`);

export default GoalRoutes;
