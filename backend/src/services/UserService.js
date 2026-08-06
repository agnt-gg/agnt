import UserModel from '../models/UserModel.js';
import { getUserTokenFromSession } from '../routes/Middleware.js';
import AuthManager from '../services/auth/AuthManager.js';
import { getCliProviderIds, getAuthEntry } from './auth/AuthDispatcher.js';
import SecurityPolicyService from './security/SecurityPolicyService.js';

async function _getLocalCliHealthProviders() {
  const ids = getCliProviderIds();
  const results = await Promise.allSettled(
    ids.map((id) => getAuthEntry(id).manager.checkApiUsable()),
  );
  return results
    .map((r, i) =>
      r.status === 'fulfilled' && r.value?.available
        ? {
            status: 'healthy',
            provider: ids[i],
            lastChecked: new Date().toISOString(),
            details: { source: r.value.source || 'local' },
          }
        : null,
    )
    .filter(Boolean);
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
  async getSecurityPolicy(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const value = await SecurityPolicyService.getUserPolicy(userId);
      res.json({ ...value, rules: SecurityPolicyService.getRuleCatalog() });
    } catch (error) {
      console.error('Error fetching security policy:', error);
      res.status(500).json({ error: 'Error fetching security policy' });
    }
  }

  async updateSecurityPolicy(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const value = await SecurityPolicyService.updateUserPolicy(userId, req.body);
      res.json(value);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async resetSecurityPolicy(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      res.json(await SecurityPolicyService.resetUserPolicy(userId));
    } catch (error) {
      res.status(500).json({ error: 'Error resetting security policy' });
    }
  }

  async getSecurityAudit(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const events = await SecurityPolicyService.getAuditEvents({
        userId,
        limit: Number(req.query.limit) || 100,
        decision: req.query.decision,
      });
      res.json({ events });
    } catch (error) {
      res.status(500).json({ error: 'Error fetching security audit events' });
    }
  }

  async updateUserSettings(req, res) {
    try {
      const { selectedProvider, selectedModel, customInstructions, asyncToolsEnabled, toolOutputCap, maxToolRounds, fallbackProviders, fallbackEnabled, subscriptionCosts } = req.body;

      if (
        selectedProvider === undefined &&
        selectedModel === undefined &&
        customInstructions === undefined &&
        asyncToolsEnabled === undefined &&
        toolOutputCap === undefined &&
        maxToolRounds === undefined &&
        fallbackProviders === undefined &&
        fallbackEnabled === undefined &&
        subscriptionCosts === undefined
      ) {
        return res.status(400).json({ error: 'At least one setting (selectedProvider, selectedModel, customInstructions, asyncToolsEnabled, toolOutputCap, maxToolRounds, fallbackProviders, fallbackEnabled, or subscriptionCosts) is required' });
      }

      if (customInstructions !== undefined && typeof customInstructions === 'string' && customInstructions.length > 10000) {
        return res.status(400).json({ error: 'customInstructions must be 10000 characters or fewer' });
      }

      if (asyncToolsEnabled !== undefined && typeof asyncToolsEnabled !== 'boolean') {
        return res.status(400).json({ error: 'asyncToolsEnabled must be a boolean' });
      }

      if (toolOutputCap !== undefined) {
        if (!Number.isInteger(toolOutputCap) || toolOutputCap < 25000 || toolOutputCap > 500000) {
          return res.status(400).json({ error: 'toolOutputCap must be an integer between 25000 and 500000' });
        }
      }

      if (maxToolRounds !== undefined) {
        if (!Number.isInteger(maxToolRounds) || maxToolRounds < 1 || maxToolRounds > 999999) {
          return res.status(400).json({ error: 'maxToolRounds must be an integer between 1 and 999999' });
        }
      }

      // Automatic provider-failover chain. An array of up to 3
      // { provider, model } tiers (model optional). The model layer further
      // sanitizes (trims, drops provider-less entries, caps at 3).
      if (fallbackProviders !== undefined) {
        if (!Array.isArray(fallbackProviders)) {
          return res.status(400).json({ error: 'fallbackProviders must be an array of { provider, model } objects' });
        }
        if (fallbackProviders.length > 3) {
          return res.status(400).json({ error: 'fallbackProviders may contain at most 3 entries' });
        }
        for (const entry of fallbackProviders) {
          if (!entry || typeof entry !== 'object' || typeof entry.provider !== 'string' || !entry.provider.trim()) {
            return res.status(400).json({ error: 'Each fallbackProviders entry must have a non-empty string "provider"' });
          }
          if (entry.model !== undefined && entry.model !== null && typeof entry.model !== 'string') {
            return res.status(400).json({ error: 'fallbackProviders entry "model" must be a string or null' });
          }
        }
      }

      if (fallbackEnabled !== undefined && typeof fallbackEnabled !== 'boolean') {
        return res.status(400).json({ error: 'fallbackEnabled must be a boolean' });
      }

      // What each flat-rate seat costs per month, as { providerKey: monthlyUsd }.
      // Only the SHAPE is checked here; the model drops non-finite, zero and
      // negative amounts, because a zero fee would become the denominator of
      // the leverage figure and yield an infinite multiple.
      if (subscriptionCosts !== undefined) {
        if (subscriptionCosts === null || typeof subscriptionCosts !== 'object' || Array.isArray(subscriptionCosts)) {
          return res.status(400).json({ error: 'subscriptionCosts must be an object of { providerKey: monthlyUsd }' });
        }
      }

      const result = await UserModel.updateUserSettings(req.user.id, {
        selectedProvider,
        selectedModel,
        customInstructions,
        asyncToolsEnabled,
        toolOutputCap,
        maxToolRounds,
        fallbackProviders,
        fallbackEnabled,
        subscriptionCosts,
      });

      res.json({
        success: true,
        message: result.created ? 'User settings created successfully' : 'User settings updated successfully',
        settings: {
          selectedProvider,
          selectedModel,
          customInstructions,
          asyncToolsEnabled,
          toolOutputCap,
          maxToolRounds,
          fallbackProviders,
          fallbackEnabled,
          subscriptionCosts,
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
  /**
   * THE session oracle for this backend.
   *
   * -------------------------------------------------------------------------
   * WHY THIS EXISTS
   * -------------------------------------------------------------------------
   * The app used to ask https://api.agnt.gg whether a session was valid, while
   * reading its agents, conversations and outputs from THIS server. Two
   * different authorities for one question, and nobody ever asked the one that
   * actually holds the data. When the remote was unreachable the client fell
   * back to DECODING the JWT locally and called that a session — so an
   * unverified token rendered a full, populated app.
   *
   * This route closes that gap by construction: it sits behind the very same
   * `authenticateToken` that guards every data route, so its answer and the
   * data routes' answers are produced by ONE code path. "The gate says yes but
   * every request 401s" stops being expressible.
   *
   * It cannot be reached unauthenticated — the middleware 401s first, with
   * { error: 'Authentication required', reason: 'missing' | 'invalid' }. That
   * rejection shape is the client's logout trigger, so it is pinned by
   * backend/src/routes/authStatus.contract.test.js.
   */
  getAuthStatus(req, res) {
    // Reaching this handler means authenticateToken verified the signature.
    // Assert it anyway: if a future refactor moves this route behind the
    // permissive `authenticateTokenOptional`, silently answering "yes, no user"
    // would be exactly the confident-wrong answer this route exists to kill.
    if (!req.user?.isAuthenticated || !req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        reason: 'invalid',
      });
    }

    res.json({
      isAuthenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email ?? null,
        auth_type: req.user.auth_type ?? 'local',
      },
    });
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
