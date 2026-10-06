/**
 * Legacy evidence stays readable. Behaviour changes have one owner: Learning.
 *
 * The pre-Learning surfaces (SkillForge, Experiments, Insights) keep their
 * reads, but their writes answer 410 so nothing changes behaviour outside the
 * supervised lifecycle. Insights keeps exactly the writes something current
 * still owns, listed here so a new caller fails a test, not the user:
 *   - /memory/*            agent memory editing
 *   - /escalated/apply     Learning → "Waiting for you": Accept (one, N, all)
 *   - /escalated/reject    Learning → "Waiting for you": Reject (one, N, all)
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const INSIGHT_WRITES_OWNED_ELSEWHERE = [/^\/memory(\/|$)/, /^\/escalated\/(apply|reject)\/?$/];

export function learningOnlyWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  return res.status(410).json({ error: 'learning_lifecycle_required', replacement: '/api/learning' });
}

export function insightWritesGuard(req, res, next) {
  if (INSIGHT_WRITES_OWNED_ELSEWHERE.some((pattern) => pattern.test(req.path))) return next();
  return learningOnlyWrites(req, res, next);
}
