import GoalModel from '../models/GoalModel.js';

/**
 * Is this goal visible to this user? Goals belong to exactly one owner:
 * the account that created them, or, in a team scope, the scope's resource
 * owner (ScopeApiMiddleware rewrites req.user to it, so the comparison is
 * the same in both cases).
 */
export function isGoalOwnedBy(goal, userId) {
  return Boolean(goal && userId && goal.user_id === userId);
}

/** The goal if this user owns it, else null. Another user's goal is "not found". */
export async function findOwnedGoal(goalId, userId) {
  if (!goalId || !userId) return null;
  const goal = await GoalModel.findOne(goalId);
  return isGoalOwnedBy(goal, userId) ? goal : null;
}

/**
 * Route middleware: the goal named by `req.params[param]` must belong to the
 * authenticated user, or the request ends as 404 before the handler runs.
 * Place it after authenticateToken. The loaded goal is left on req.goal.
 *
 * Every goal-id route must use it; GoalRoutes.ownership.test.js enforces that.
 */
export function requireOwnedGoal(param = 'id') {
  const middleware = async (req, res, next) => {
    try {
      const goal = await findOwnedGoal(req.params[param], req.user?.userId);
      if (!goal) return res.status(404).json({ error: 'Goal not found' });
      req.goal = goal;
      next();
    } catch (error) {
      console.error('[Goal ownership] Lookup failed:', error.message);
      res.status(500).json({ error: 'Failed to load goal' });
    }
  };
  middleware.ownsGoalParam = param;
  return middleware;
}
