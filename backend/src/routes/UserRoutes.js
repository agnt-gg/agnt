import express from 'express';
import { authenticateToken, sessionMiddleware, getUserTokenFromSession } from './Middleware.js';
import UserService from '../services/UserService.js';
import { requireAuth } from '../utils/authGuard.js';

// Set up new route
const UserRoutes = express.Router();

// Set up middleware
UserRoutes.use(sessionMiddleware);

// SSE token auth. EventSource cannot set an Authorization header, so the
// token rides in the query string.
//
// The previous hand-rolled version rejected a MISSING token but then handed an
// INVALID one to authenticateToken, which decorates rather than guards — so any
// garbage token authenticated as anonymous and the stream opened anyway.
// requireAuth verifies the signature and 401s on anything that does not.
const authenticateSSEToken = requireAuth({ allowQuery: true });

// Define routes
UserRoutes.get('/health', UserService.healthCheck);
UserRoutes.get('/user-stats', authenticateToken, UserService.getUserStats);

// User settings routes
UserRoutes.get('/settings', authenticateToken, UserService.getUserSettings);
UserRoutes.put('/settings', authenticateToken, UserService.updateUserSettings);

// Cross-device UI preferences (theme, font, panel geometry). Separate from
// /settings because the write semantics differ: partial merge, last-write-wins
// on global keys, and a per-device scope for anything measured in pixels.
UserRoutes.get('/preferences', authenticateToken, UserService.getPreferences);
UserRoutes.put('/preferences', authenticateToken, UserService.updatePreferences);
UserRoutes.get('/security-policy', authenticateToken, UserService.getSecurityPolicy);
UserRoutes.put('/security-policy', authenticateToken, UserService.updateSecurityPolicy);
UserRoutes.delete('/security-policy', authenticateToken, UserService.resetSecurityPolicy);
UserRoutes.get('/security-audit', authenticateToken, UserService.getSecurityAudit);

// THE session gate. The desktop client asks THIS server — the one that serves
// its data — whether the session is real, instead of asking a remote auth
// server that may be unreachable or may disagree. Behind authenticateToken on
// purpose: the answer has to come from the same verification every data route
// uses, or the gate and the data can disagree (they did).
UserRoutes.get('/auth/status', authenticateToken, UserService.getAuthStatus);

// Token management routes
UserRoutes.post('/sync-token', authenticateToken, UserService.syncToken);
// Session-cookie based and deliberately unauthenticated — a DIAGNOSTIC, not a
// gate. It answers "is there a server-side session?", which is a different
// question from "is this bearer token valid", and the two can disagree. Do not
// route the auth gate through here.
UserRoutes.get('/token-status', UserService.getTokenStatus);

// Connection health routes
UserRoutes.get('/connection-health', authenticateToken, UserService.getConnectionHealth);
UserRoutes.get('/connection-health/:providerId', authenticateToken, UserService.getSingleProviderHealth);

// Add SSE endpoint with custom auth
UserRoutes.get('/connection-health-stream', authenticateSSEToken, UserService.getConnectionHealthStream);

console.log(`User Routes Started...`);

export default UserRoutes;
