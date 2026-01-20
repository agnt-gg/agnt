import UserModel from '../models/UserModel.js';
import { getUserTokenFromSession } from '../routes/Middleware.js';
import AuthManager from '../services/auth/AuthManager.js';

class UserService {
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }
  async getUserStats(req, res) {
    try {
      const stats = await UserModel.getUserStats(req.user.userId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching user stats:', error);
      res.status(500).json({ error: 'Error fetching user statistics' });
    }
  }
  async getUserSettings(req, res) {
    try {
      const settings = await UserModel.getUserSettings(req.user.id);
      res.json(settings);
    } catch (error) {
      console.error('Error fetching user settings:', error);
      res.status(500).json({ error: 'Error fetching user settings' });
    }
  }
  async updateUserSettings(req, res) {
    try {
      const { selectedProvider, selectedModel } = req.body;

      if (!selectedProvider && !selectedModel) {
        return res.status(400).json({ error: 'At least one setting (selectedProvider or selectedModel) is required' });
      }

      const result = await UserModel.updateUserSettings(req.user.id, {
        selectedProvider,
        selectedModel,
      });

      res.json({
        success: true,
        message: result.created ? 'User settings created successfully' : 'User settings updated successfully',
        settings: {
          selectedProvider: selectedProvider,
          selectedModel: selectedModel,
        },
      });
    } catch (error) {
      console.error('Error updating user settings:', error);
      res.status(500).json({ error: 'Error updating user settings' });
    }
  }
  async syncToken(req, res) {
    // Sync token from frontend to backend session
    try {
      if (!req.user.isAuthenticated) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Token is already stored in session by authenticateToken middleware
      res.json({
        success: true,
        message: 'Token synchronized successfully',
        user: {
          id: req.user.id,
          email: req.user.email,
          auth_type: req.user.auth_type,
        },
      });
    } catch (error) {
      console.error('Error syncing token:', error);
      res.status(500).json({ error: 'Error synchronizing token' });
    }
  }
  async getConnectionHealth(req, res) {
    try {
      const userId = req.user.id;
      // Get the token from the Authorization header
      const authToken = req.headers.authorization.split(' ')[1];

      const healthStatus = await AuthManager.checkConnectionHealth(userId, authToken);

      res.json({
        success: true,
        data: healthStatus,
      });
    } catch (error) {
      console.error('Error checking connection health:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check connection health',
        error: error.message,
      });
    }
  }
  async getSingleProviderHealth(req, res) {
    try {
      const userId = req.user.id;
      const { providerId } = req.params;

      const healthStatus = await AuthManager.checkSingleProviderHealth(userId, providerId);

      res.json({
        success: true,
        data: healthStatus,
      });
    } catch (error) {
      console.error('Error checking provider health:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check provider health',
        error: error.message,
      });
    }
  }
  async getConnectionHealthStream(req, res) {
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    try {
      // Get token from query param for SSE
      const authToken = req.query.token || req.headers.authorization?.split(' ')[1];

      if (!authToken) {
        throw new Error('No authorization token provided');
      }

      const userId = req.user.id;

      // Send initial message to confirm connection
      res.write(':ok\n\n');

      // Stream health check updates
      await AuthManager.checkConnectionHealthStream(userId, authToken, (update) => {
        res.write(`data: ${JSON.stringify(update)}\n\n`);
        // Force flush to ensure data is sent immediately
        res.flushHeaders();
      });

      // End the stream
      res.write('event: complete\ndata: {}\n\n');
      res.end();
    } catch (error) {
      console.error('Error in health check stream:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
  getTokenStatus(req, res) {
    // Get token status from backend session
    try {
      const sessionData = getUserTokenFromSession(req);

      if (sessionData) {
        res.json({
          isAuthenticated: true,
          hasStoredToken: true,
          user: {
            id: sessionData.user.id,
            email: sessionData.user.email,
            auth_type: sessionData.user.auth_type,
          },
          lastActivity: req.session.lastActivity,
        });
      } else {
        res.json({
          isAuthenticated: false,
          hasStoredToken: false,
          user: null,
        });
      }
    } catch (error) {
      console.error('Error checking token status:', error);
      res.status(500).json({ error: 'Error checking token status' });
    }
  }
}

export default new UserService();
