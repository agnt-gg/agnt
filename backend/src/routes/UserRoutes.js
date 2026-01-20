import express from 'express';
import { authenticateToken, sessionMiddleware, getUserTokenFromSession } from './Middleware.js';
import UserService from '../services/UserService.js';

// Set up new route
const UserRoutes = express.Router();

// Set up middleware
UserRoutes.use(sessionMiddleware);

// Custom middleware for SSE token auth
const authenticateSSEToken = async (req, res, next) => {
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // Manually set the authorization header for the authenticateToken middleware
  req.headers.authorization = `Bearer ${token}`;

  // Call the existing authenticateToken middleware
  authenticateToken(req, res, next);
};

// Define routes
UserRoutes.get('/health', UserService.healthCheck);
UserRoutes.get('/user-stats', authenticateToken, UserService.getUserStats);

// User settings routes
UserRoutes.get('/settings', authenticateToken, UserService.getUserSettings);
UserRoutes.put('/settings', authenticateToken, UserService.updateUserSettings);

// Token management routes
UserRoutes.post('/sync-token', authenticateToken, UserService.syncToken);
UserRoutes.get('/token-status', UserService.getTokenStatus);

// Connection health routes
UserRoutes.get('/connection-health', authenticateToken, UserService.getConnectionHealth);
UserRoutes.get('/connection-health/:providerId', authenticateToken, UserService.getSingleProviderHealth);

// Add SSE endpoint with custom auth
UserRoutes.get('/connection-health-stream', authenticateSSEToken, UserService.getConnectionHealthStream);

console.log(`User Routes Started...`);

export default UserRoutes;
