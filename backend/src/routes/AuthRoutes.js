/**
 * Local auth-level routes — /api/auth/*
 *
 * Today: a single GET /connected endpoint that returns the local-first
 * union of providers AGNT considers connected (env-sourced + local
 * api_keys + local oauth_tokens + remote fallback merge). This is what
 * lets env vars like OPENAI_API_KEY light the "connected" badge in
 * the right-panel integration grid, the Connectors page, and the chat
 * model picker — all of which read from a single Vuex `connectedApps`
 * array that previously only learned about remote-known providers.
 *
 * Future home for /api/connections façade (PRD-079).
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import AuthManager from '../services/auth/AuthManager.js';

const router = express.Router();

// Soft user-id extraction: tries verify first (local-issued tokens), falls back
// to decode (remote-issued tokens via api.agnt.gg). We do NOT 401 on failure —
// env-sourced providers are install-global and worth returning to any caller.
function extractUserIdSoft(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || token === 'null' || token === 'undefined') return { userId: null, token: null };
  let decoded = null;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { /* fall through */ }
  if (!decoded) {
    try { decoded = jwt.decode(token); } catch { /* fall through */ }
  }
  const userId = decoded?.id || decoded?.userId || decoded?.sub || null;
  return { userId, token };
}

// GET /api/auth/connected
//   → [{ providerId: 'openai', connected: true }, ...]
//
// Shape mirrors the existing remote /auth/connected response so the
// frontend can merge both sources without normalization. Env-sourced
// providers come back even for unauthenticated callers because env vars
// are install-global; per-user DB rows are only included when a userId
// can be resolved from the bearer token.
router.get('/connected', async (req, res) => {
  const { userId, token } = extractUserIdSoft(req);
  try {
    const list = await AuthManager.getConnectedApps(userId, token);
    return res.json(Array.isArray(list) ? list : []);
  } catch (error) {
    console.error('[AuthRoutes] /connected failed:', error.message);
    return res.status(500).json({ success: false, error: error.message || 'Failed to list connected providers' });
  }
});

export default router;
