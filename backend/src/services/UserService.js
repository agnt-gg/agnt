import UserModel from '../models/UserModel.js';
import { getUserTokenFromSession } from '../routes/Middleware.js';
import AuthManager from '../services/auth/AuthManager.js';
import CodexAuthManager from './auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from './auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from './auth/GeminiCliAuthManager.js';

async function _getLocalCliHealthProviders() {
  const providers = [];
  const [codexResult, ccResult, gcResult] = await Promise.allSettled([
    CodexAuthManager.checkApiUsable(),
    ClaudeCodeAuthManager.checkApiUsable(),
    GeminiCliAuthManager.checkApiUsable(),
  ]);

  if (codexResult.status === 'fulfilled' && codexResult.value?.available) {
    providers.push({
      status: 'healthy',
      provider: 'openai-codex-cli',
      lastChecked: new Date().toISOString(),
      details: { source: codexResult.value.source || 'local' },
    });
  }
  if (ccResult.status === 'fulfilled' && ccResult.value?.available) {
    providers.push({
      status: 'healthy',
      provider: 'claude-code',
      lastChecked: new Date().toISOString(),
      details: { source: ccResult.value.source || 'local' },
    });
  }
  if (gcResult.status === 'fulfilled' && gcResult.value?.available) {
    providers.push({
      status: 'healthy',
      provider: 'gemini-cli',
      lastChecked: new Date().toISOString(),
      details: { source: gcResult.value.source || 'local' },
    });
  }

  return providers;
}

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
      const userId = req.user?.id || 'local-user';
      const authHeader = req.headers.authorization || '';
      const authToken = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

      // Check local CLI tools in parallel (fast, <100ms)
      const localProviders = await _getLocalCliHealthProviders();

      if (!authToken) {
        // Local-only mode: only show CLI tools
        const healthyCount = localProviders.filter((p) => p.status === 'healthy').length;
        const totalCount = localProviders.length;
        const overall =
          totalCount === 0 ? 'no_connections' : healthyCount === totalCount ? 'healthy' : healthyCount === 0 ? 'critical' : 'degraded';

        return res.json({
          success: true,
          data: {
            overall,
            healthyConnections: healthyCount,
            totalConnections: totalCount,
            providers: localProviders,
            timestamp: new Date().toISOString(),
            localOnly: true,
          },
        });
      }

      // Remote mode: get remote health, then merge in local CLI tools
      const healthStatus = await AuthManager.checkConnectionHealth(userId, authToken);

      // Merge local CLI tools that aren't already in remote results
      for (const lp of localProviders) {
        if (!healthStatus.providers.some((p) => p.provider === lp.provider)) {
          healthStatus.providers.push(lp);
        }
      }

      // Recalculate totals
      healthStatus.healthyConnections = healthStatus.providers.filter((p) => p.status === 'healthy').length;
      healthStatus.totalConnections = healthStatus.providers.length;
      if (healthStatus.healthyConnections === 0 && healthStatus.totalConnections > 0) {
        healthStatus.overall = 'critical';
      } else if (healthStatus.healthyConnections < healthStatus.totalConnections) {
        healthStatus.overall = 'degraded';
      } else if (healthStatus.totalConnections > 0) {
        healthStatus.overall = 'healthy';
      }

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

      // Check local CLI tools in parallel with the remote stream
      const localProvidersPromise = _getLocalCliHealthProviders();

      // Capture the last summary from the remote stream
      let lastSummary = null;

      // Stream remote health check updates
      await AuthManager.checkConnectionHealthStream(userId, authToken, (update) => {
        if (update.type === 'summary') {
          lastSummary = update.data;
        }
        res.write(`data: ${JSON.stringify(update)}\n\n`);
        res.flushHeaders();
      });

      // Merge local CLI tools into the results
      const localProviders = await localProvidersPromise;
      if (localProviders.length > 0) {
        const existingProviderIds = new Set((lastSummary?.providers || []).map((p) => p.provider));
        const newLocalProviders = localProviders.filter((lp) => !existingProviderIds.has(lp.provider));

        if (newLocalProviders.length > 0) {
          // Send each local provider update
          for (const lp of newLocalProviders) {
            res.write(`data: ${JSON.stringify({ type: 'provider', provider: lp })}\n\n`);
            res.flushHeaders();
          }

          // Send corrected summary with local providers included
          const mergedProviders = [...(lastSummary?.providers || []), ...newLocalProviders];
          const healthyCount = mergedProviders.filter((p) => p.status === 'healthy').length;
          const totalCount = mergedProviders.length;
          let overall = 'healthy';
          if (healthyCount === 0 && totalCount > 0) overall = 'critical';
          else if (healthyCount < totalCount) overall = 'degraded';

          res.write(
            `data: ${JSON.stringify({
              type: 'summary',
              data: {
                overall,
                healthyConnections: healthyCount,
                totalConnections: totalCount,
                providers: mergedProviders,
                timestamp: new Date().toISOString(),
              },
            })}\n\n`
          );
          res.flushHeaders();
        }
      }

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
