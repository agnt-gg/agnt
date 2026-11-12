import express from 'express';
import GoalService from '../services/GoalService.js';
import { authenticateToken } from './Middleware.js';
import { requireOwnedGoal } from './goalOwnership.js';
import db from '../models/database/index.js';
import { GoalObjectiveModel } from '../models/GoalObjectiveModel.js';

const GoalRoutes = express.Router();

// Every route that names a goal checks that the caller owns it first.
const ownGoal = requireOwnedGoal('id');
const ownGoalById = requireOwnedGoal('goalId');

GoalRoutes.get('/health', GoalService.healthCheck);
GoalRoutes.get('/', authenticateToken, GoalService.getAllGoals);
GoalRoutes.get('/summary', authenticateToken, GoalService.getAllGoalsSummary);

// Objectives: the few outcomes a person's goals serve. Registered before /:id, which would otherwise
// read "objectives" as a goal id.
const objectives = new GoalObjectiveModel(db);
const objectiveHandler = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, req.user.userId));
  } catch (error) {
    if (!error.status) console.error('[Goal objectives]', error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Objectives are unavailable right now' });
  }
};
GoalRoutes.get('/objectives', authenticateToken, objectiveHandler((req, userId) => objectives.list(userId)));
GoalRoutes.post('/objectives', authenticateToken, objectiveHandler((req, userId) => objectives.create(userId, req.body || {})));
GoalRoutes.put('/objectives/:objectiveId', authenticateToken, objectiveHandler((req, userId) => objectives.update(userId, req.params.objectiveId, req.body || {})));
GoalRoutes.delete('/objectives/:objectiveId', authenticateToken, objectiveHandler((req, userId) => objectives.archive(userId, req.params.objectiveId)));
GoalRoutes.post('/create', authenticateToken, GoalService.createGoal);
GoalRoutes.post('/:goalId/execute', authenticateToken, ownGoalById, GoalService.executeGoal);
GoalRoutes.get('/:id', authenticateToken, ownGoal, GoalService.getGoal);
GoalRoutes.get('/:id/status', authenticateToken, ownGoal, GoalService.getGoalStatus);
GoalRoutes.post('/:id/pause', authenticateToken, ownGoal, GoalService.pauseGoal);
GoalRoutes.post('/:id/resume', authenticateToken, ownGoal, GoalService.resumeGoal);
GoalRoutes.delete('/:id', authenticateToken, ownGoal, GoalService.deleteGoal);
// Which objective a goal serves (null: none).
GoalRoutes.put('/:id/objective', authenticateToken, ownGoal, objectiveHandler((req, userId) => objectives.link(userId, req.params.id, req.body?.objectiveId ?? null)));

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
