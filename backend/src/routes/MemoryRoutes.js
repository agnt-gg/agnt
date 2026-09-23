import express from 'express';
import MemorySearchService from '../services/MemorySearchService.js';
import DataExportService from '../services/DataExportService.js';
import { authenticateToken } from './Middleware.js';
import { requireAuth } from '../utils/authGuard.js';

// Header or the path-scoped session cookie; never a token in the query string.
const requireAuthForDownload = requireAuth({ allowCookie: true });

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

/**
 * GET /api/memory/export/categories?since=YYYY-MM-DD&until=YYYY-MM-DD
 *   What can be exported, with a row count per category for the filters.
 */
MemoryRoutes.get('/export/categories', authenticateToken, async (req, res) => {
  try {
    const categories = await DataExportService.countExportCategories(req.user.userId, {
      since: req.query.since || null,
      until: req.query.until || null,
    });
    res.json({ success: true, categories });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, error: err.message });
    console.error('[MemoryRoutes] export categories error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
MemoryRoutes.all('/export/categories', methodNotAllowed('GET'));

/**
 * POST /api/memory/export
 *   body: { categories: ['memories', ...] | 'all', since?, until?, compress? }
 *   Returns a single-use, one-minute download URL. A native download cannot
 *   send an Authorization header, and the session token must never ride in a
 *   URL, so the URL carries this ticket instead.
 */
MemoryRoutes.post('/export', authenticateToken, (req, res) => {
  try {
    const options = DataExportService.normalizeExportOptions(req.body || {});
    const { token, expiresAt } = DataExportService.createExportTicket(req.user.userId, options);
    res.json({
      success: true,
      ticket: token,
      downloadUrl: `${req.baseUrl}/export/download/${token}`,
      expiresAt,
      filename: DataExportService.exportFilename(options),
      options,
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, error: err.message });
    console.error('[MemoryRoutes] export ticket error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/memory/export/download/:ticket
 *   Two locks: the caller must be signed in (the path-scoped session cookie, since a native
 *   download cannot send a header), AND hold a single-use, one-minute ticket minted for that
 *   same user. A leaked ticket is useless to anyone else; a stolen cookie alone downloads nothing.
 *   Streams the export as an attachment.
 */
MemoryRoutes.get('/export/download/:ticket', requireAuthForDownload, async (req, res) => {
  const redeemed = DataExportService.consumeExportTicket(req.params.ticket);
  const callerId = req.user?.userId || req.user?.id;
  if (!redeemed || redeemed.userId !== callerId) {
    return res.status(404).json({ success: false, error: 'This export link has expired or was already used. Start the export again.' });
  }
  try {
    await DataExportService.streamExport({ userId: redeemed.userId, options: redeemed.options, res });
  } catch (err) {
    console.error('[MemoryRoutes] export stream error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else res.end();
  }
});
MemoryRoutes.all('/export/download/:ticket', methodNotAllowed('GET'));
MemoryRoutes.all('/export', methodNotAllowed('POST'));

export default MemoryRoutes;
