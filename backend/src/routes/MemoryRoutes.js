import express from 'express';
import MemorySearchService from '../services/MemorySearchService.js';
import { authenticateToken } from './Middleware.js';

const MemoryRoutes = express.Router();

// Method-not-allowed responder. Express's default for an unmatched method on
// a matched path is an HTML "Cannot POST /api/..." page. JSON keeps API
// clients (and LLMs probing the surface) inside the documented contract.
function methodNotAllowed(allowedMethod, hint) {
  return (req, res) => {
    res.set('Allow', allowedMethod);
    res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed. Use ${allowedMethod} ${req.baseUrl}${req.path}${hint ? ' — ' + hint : ''}`,
    });
  };
}

/**
 * GET /api/memory/search
 *   ?q=keyword            (optional — if absent, returns recent rows by date)
 *     Accepts `query` as an alias for `q`. If both are sent, `q` wins.
 *   &since=ISO            (optional)
 *   &until=ISO            (optional)
 *   &sources=conversations,executions,outputs,insights,memory,versions
 *   &limit=50
 *
 * Returns: { success, results: [{ kind, id, timestamp, title, snippet, score?, meta }] }
 */
MemoryRoutes.get('/search', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { q, query, since, until, sources, limit } = req.query;
    // Accept either `q` (canonical) or `query` (natural alias most LLMs try).
    // `q` wins when both are provided so callers can disambiguate explicitly.
    const keyword = q ?? query;
    const sourceList = typeof sources === 'string' && sources.length > 0
      ? sources.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const results = await MemorySearchService.search({
      userId,
      q: keyword,
      since,
      until,
      sources: sourceList,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
    });
    res.json({ success: true, results, count: results.length });
  } catch (err) {
    console.error('[MemoryRoutes] search error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
MemoryRoutes.all('/search', methodNotAllowed('GET', 'pass q, since, until, sources, limit as query params'));

/**
 * GET /api/memory/recent
 *   ?days=7    (default 7)
 *   &kind=executions|conversations|outputs|insights|memory|versions   (optional)
 *   &limit=100
 *
 * Direct "what happened recently?" lookup — no keyword required.
 */
MemoryRoutes.get('/recent', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { days, kind, limit } = req.query;
    const results = await MemorySearchService.listRecent({
      userId,
      days: Math.max(parseInt(days, 10) || 7, 1),
      kind: kind || undefined,
      limit: Math.min(parseInt(limit, 10) || 100, 500),
    });
    res.json({ success: true, results, count: results.length });
  } catch (err) {
    console.error('[MemoryRoutes] recent error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
MemoryRoutes.all('/recent', methodNotAllowed('GET', 'pass days, kind, limit as query params'));

/**
 * GET /api/memory/trace/:executionId
 *   Full detail for one agent_executions row plus its tool_executions.
 */
MemoryRoutes.get('/trace/:executionId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const trace = await MemorySearchService.getTrace({
      executionId: req.params.executionId,
      userId,
    });
    if (!trace) {
      return res.status(404).json({ success: false, error: 'Trace not found' });
    }
    res.json({ success: true, trace });
  } catch (err) {
    console.error('[MemoryRoutes] trace error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
MemoryRoutes.all('/trace/:executionId', methodNotAllowed('GET'));

export default MemoryRoutes;
