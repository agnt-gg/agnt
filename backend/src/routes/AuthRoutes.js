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
import AuthManager from '../services/auth/AuthManager.js';
import { broadcast, RealtimeEvents } from '../utils/realtimeSync.js';
import { extractToken, requireAuthHeader, verifyAuthToken } from '../utils/authGuard.js';

const router = express.Router();

const PROVIDER_NOTIFY_EVENT = {
  created: RealtimeEvents.PROVIDER_CREATED,
  updated: RealtimeEvents.PROVIDER_UPDATED,
  deleted: RealtimeEvents.PROVIDER_DELETED,
};

// Soft identity: a VERIFIED user id, or null. Deliberately never 401s —
// env-sourced providers are install-global and worth returning to any caller,
// so an anonymous request still gets a useful answer, just without the
// per-user rows.
//
// This used to fall back to `jwt.decode` when verification failed, on the
// reasoning that remote-issued tokens cannot be verified locally. The cost was
// that the "user id" became whatever the caller typed, so a forged token
// returned another user's connected-provider list. `verifyAuthToken` is the
// routine every guarded route already uses, and it succeeds for a genuine
// cloud token on a hosted tenant through the issuer-verified path — so the
// decode fallback was buying a case that is already covered, at the price of
// accepting anything at all.
//
// The token itself is returned even when no identity could be established:
// getConnectedApps forwards it to the remote API, which does its own check.
function extractUserIdSoft(req) {
  const token = extractToken(req);
  if (!token) return { userId: null, token: null };
  const result = verifyAuthToken(token);
  return { userId: result.ok ? result.user.id : null, token };
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

// POST /api/auth/providers/notify-changed
//   body: { event: 'created' | 'updated' | 'deleted', providerId?: string }
//
// The UI form (and any other client-side caller) posts to the cloud API
// directly for provider CRUD, so the local backend never sees the write.
// This endpoint lets the client tell the local backend "I just changed a
// provider — fan it out" so every connected tab refreshes via Socket.IO.
router.post('/providers/notify-changed', requireAuthHeader, (req, res) => {
  const { event, providerId } = req.body || {};
  const realtimeEvent = PROVIDER_NOTIFY_EVENT[event];
  if (!realtimeEvent) {
    return res.status(400).json({ success: false, error: "event must be 'created', 'updated', or 'deleted'." });
  }
  broadcast(realtimeEvent, { providerId: providerId || null });
  return res.json({ success: true });
});

export default router;
