import db from '../../models/database/index.js';
import CryptoJS from 'crypto-js';
import axios from 'axios';
import generateUUID from '../../utils/generateUUID.js';
import { decrypt, encrypt } from '../../utils/encryption.js';

// Add this import
import { getUserTokenFromSession } from '../../routes/Middleware.js';

// THIS IS NEEDED ON THE REMOTE SERVER FOR THE OAUTH SETUP
class AuthManager {
  constructor() {
    this.providers = new Map();
    this.tokenRefreshIntervals = new Map();
    this.remoteUrl = process.env.REMOTE_URL;
  }

  // PUBLIC METHODS
  async getAuthorizationUrl(providerId, userId, state = null) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error('Provider not found');
    return provider.getAuthorizationUrl(state || CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex));
  }
  async handleCallback(providerId, userId, code) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error('Provider not found');

    const tokens = await provider.exchangeCodeForTokens(code);
    await this._saveTokens(userId, providerId, tokens);
    this._scheduleTokenRefresh(userId, providerId, tokens);
    return tokens;
  }
  // LOCAL VERSION THAT USES REMOTE AUTH SERVICE
  async getValidAccessToken(userId, providerId) {
    try {
      const response = await axios.get(`${this.remoteUrl}/auth/valid-token`, {
        params: { userId, providerId },
      });
      return response.data.access_token;
    } catch (error) {
      console.error('Error proxying getValidAccessToken:', error.message);
      throw new Error('Failed to retrieve access token from remote auth service.');
    }
  }
  async getConnectedApps(userId, authToken) {
    // Desktop version: proxy to remote server to get connected apps
    try {
      const response = await axios.get(`${this.remoteUrl}/auth/connected`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Failed to fetch connected apps from remote');
      }

      return response.data;
    } catch (error) {
      console.error('Error fetching connected apps from remote:', error.message);
      throw new Error('Failed to retrieve connected apps from remote auth service.');
    }
  }
  async disconnectProviderAndRemoveApiKey(providerId, userId) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            console.error('Error beginning transaction:', err);
            return reject(err);
          }

          db.run('DELETE FROM oauth_tokens WHERE user_id = ? AND provider_id = ?', [userId, providerId], (err) => {
            if (err) {
              console.error('Error deleting OAuth tokens:', err);
              return db.run('ROLLBACK', () => reject(err));
            }

            db.run('DELETE FROM api_keys WHERE user_id = ? AND provider_id = ?', [userId, providerId], (err) => {
              if (err) {
                console.error('Error deleting API keys:', err);
                return db.run('ROLLBACK', () => reject(err));
              }

              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing transaction:', err);
                  return db.run('ROLLBACK', () => reject(err));
                }
                resolve();
              });
            });
          });
        });
      });
    });
  }

  async checkConnectionHealth(userId, authToken) {
    try {
      // Fetch connected apps from remote
      const response = await axios.get(`${this.remoteUrl}/auth/connected`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Failed to fetch connected apps from remote');
      }

      // Filter out google-login from the health check
      const connectedProviderIds = response.data.filter((providerId) => providerId !== 'google-login');
      const results = [];

      for (const providerId of connectedProviderIds) {
        try {
          let healthStatus;

          // Get token from remote using getValidAccessToken
          const token = await this.getValidAccessToken(userId, providerId);

          if (!token) {
            results.push({
              status: 'error',
              provider: providerId,
              lastChecked: new Date().toISOString(),
              error: 'No valid token available',
            });
            continue;
          }

          // Check health based on provider type
          switch (providerId) {
            case 'github':
              healthStatus = await checkGitHubHealth(token);
              break;
            case 'slack':
              healthStatus = await checkSlackHealth(token);
              break;
            case 'google':
            case 'google-login':
              healthStatus = await checkGoogleHealth(token);
              break;
            case 'twitter':
              healthStatus = await checkTwitterHealth(token);
              break;
            case 'openai':
              healthStatus = await checkOpenAIHealth(token);
              break;
            case 'anthropic':
              healthStatus = await checkAnthropicHealth(token);
              break;
            case 'claude-code':
              healthStatus = await checkClaudeCodeHealth(token);
              break;
            case 'stripe':
              healthStatus = await checkStripeHealth(token);
              break;
            case 'discord':
              healthStatus = await checkDiscordHealth(token);
              break;
            case 'dropbox':
              healthStatus = await checkDropboxHealth(token);
              break;
            default:
              // For other API key based services, just verify we have a token
              healthStatus = {
                status: 'healthy',
                provider: providerId,
                lastChecked: new Date().toISOString(),
                details: { hasValidToken: true },
              };
          }

          results.push(healthStatus);
        } catch (error) {
          results.push({
            status: 'error',
            provider: providerId,
            lastChecked: new Date().toISOString(),
            error: error.message || 'Health check failed',
          });
        }
      }

      const healthyCount = results.filter((r) => r.status === 'healthy').length;
      const totalCount = results.length;

      let overallStatus = 'healthy';
      if (healthyCount === 0 && totalCount > 0) {
        overallStatus = 'critical';
      } else if (healthyCount < totalCount) {
        overallStatus = 'degraded';
      }

      return {
        overall: overallStatus,
        healthyConnections: healthyCount,
        totalConnections: totalCount,
        providers: results,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error checking connection health:', error);
      return {
        overall: 'error',
        healthyConnections: 0,
        totalConnections: 0,
        providers: [],
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  async checkSingleProviderHealth(userId, providerId) {
    try {
      const provider = this.providers.get(providerId);
      if (!provider) {
        throw new Error('Provider not found');
      }

      const token = await this.getValidAccessToken(userId, providerId);
      if (!token) {
        throw new Error('No valid access token available');
      }

      return await provider.checkHealth(token);
    } catch (error) {
      return {
        status: 'error',
        provider: providerId,
        lastChecked: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  async checkConnectionHealthStream(userId, authToken, onUpdate) {
    try {
      // Fetch connected apps from remote
      const response = await axios.get(`${this.remoteUrl}/auth/connected`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Failed to fetch connected apps from remote');
      }

      // Filter out google-login from the health check
      const connectedProviderIds = response.data.filter((providerId) => providerId !== 'google-login');
      const results = [];
      let healthyCount = 0;
      let processedCount = 0;

      // Send initial status
      onUpdate({
        type: 'init',
        totalProviders: connectedProviderIds.length,
        providers: connectedProviderIds,
      });

      // Add a small delay to ensure the initial message is sent
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process each provider and send updates
      for (const providerId of connectedProviderIds) {
        try {
          let healthStatus;

          // Get token from remote using getValidAccessToken
          const token = await this.getValidAccessToken(userId, providerId);

          if (!token) {
            healthStatus = {
              status: 'error',
              provider: providerId,
              lastChecked: new Date().toISOString(),
              error: 'No valid token available',
            };
          } else {
            // Check health based on provider type
            switch (providerId) {
              case 'github':
                healthStatus = await checkGitHubHealth(token);
                break;
              case 'slack':
                healthStatus = await checkSlackHealth(token);
                break;
              case 'google':
              case 'google-login':
                healthStatus = await checkGoogleHealth(token);
                break;
              case 'twitter':
                healthStatus = await checkTwitterHealth(token);
                break;
              case 'openai':
                healthStatus = await checkOpenAIHealth(token);
                break;
              case 'anthropic':
                healthStatus = await checkAnthropicHealth(token);
                break;
              case 'claude-code':
                healthStatus = await checkClaudeCodeHealth(token);
                break;
              case 'stripe':
                healthStatus = await checkStripeHealth(token);
                break;
              case 'discord':
                healthStatus = await checkDiscordHealth(token);
                break;
              case 'dropbox':
                healthStatus = await checkDropboxHealth(token);
                break;
              default:
                // For other API key based services, just verify we have a token
                healthStatus = {
                  status: 'healthy',
                  provider: providerId,
                  lastChecked: new Date().toISOString(),
                  details: { hasValidToken: true },
                };
            }
          }

          results.push(healthStatus);
          if (healthStatus.status === 'healthy') healthyCount++;
          processedCount++;

          // Send update for this provider
          onUpdate({
            type: 'provider',
            provider: healthStatus,
            progress: {
              processed: processedCount,
              total: connectedProviderIds.length,
              healthy: healthyCount,
            },
          });

          // Small delay to ensure updates are sent (optional, remove if not needed)
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          const errorStatus = {
            status: 'error',
            provider: providerId,
            lastChecked: new Date().toISOString(),
            error: error.message || 'Health check failed',
          };
          results.push(errorStatus);
          processedCount++;

          // Send error update
          onUpdate({
            type: 'provider',
            provider: errorStatus,
            progress: {
              processed: processedCount,
              total: connectedProviderIds.length,
              healthy: healthyCount,
            },
          });
        }
      }

      // Calculate final status
      const totalCount = results.length;
      let overallStatus = 'healthy';
      if (healthyCount === 0 && totalCount > 0) {
        overallStatus = 'critical';
      } else if (healthyCount < totalCount) {
        overallStatus = 'degraded';
      }

      // Send final summary
      onUpdate({
        type: 'summary',
        data: {
          overall: overallStatus,
          healthyConnections: healthyCount,
          totalConnections: totalCount,
          providers: results,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Error checking connection health:', error);
      throw error;
    }
  }

  // PRIVATE METHODS
  _registerProvider(provider) {
    this.providers.set(provider.id, provider);
  }
  _scheduleTokenRefresh(userId, providerId, tokens) {
    const refreshInterval = 600000; // 10 minutes in milliseconds

    console.log(`Scheduling token refresh for ${providerId} every ${refreshInterval / 1000} seconds`);

    const intervalId = setInterval(async () => {
      console.log(`Attempting to refresh token for ${providerId}`);
      try {
        const newTokens = await this._refreshToken(userId, providerId);
        if (newTokens) {
          console.log(`Successfully refreshed token for ${providerId}`);
        } else {
          console.log(`Failed to refresh token for ${providerId}`);
        }
      } catch (error) {
        console.error(`Error refreshing token for ${providerId}:`, error);
      }
    }, refreshInterval);

    const key = `${userId}:${providerId}`;
    if (this.tokenRefreshIntervals.has(key)) {
      console.log(`Clearing existing refresh interval for ${providerId}`);
      clearInterval(this.tokenRefreshIntervals.get(key));
    }
    this.tokenRefreshIntervals.set(key, intervalId);
  }
  async _fetchAllUsers() {
    return new Promise((resolve, reject) => {
      db.all('SELECT id FROM users', [], (err, rows) => {
        if (err) {
          console.error('Error fetching users:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
  async _getApiKey(userId, providerId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT api_key FROM api_keys WHERE user_id = ? AND provider_id = ?', [userId, providerId], (err, row) => {
        if (err) reject(err);
        if (row && row.api_key) {
          try {
            const decryptedApiKey = decrypt(row.api_key);
            console.log(`API key for ${providerId}: Found and decrypted`);
            resolve(decryptedApiKey);
          } catch (decryptError) {
            console.error(`Error decrypting API key for ${providerId}:`, decryptError);
            reject(new Error('Failed to decrypt API key'));
          }
        } else {
          console.log(`API key for ${providerId}: Not found`);
          resolve(null);
        }
      });
    });
  }
  async _getTokens(userId, providerId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM oauth_tokens WHERE user_id = ? AND provider_id = ?', [userId, providerId], (err, row) => {
        if (err) reject(err);
        if (row) {
          try {
            // Decrypt the tokens before returning
            const decryptedTokens = {
              ...row,
              access_token: decrypt(row.access_token),
              refresh_token: row.refresh_token ? decrypt(row.refresh_token) : null,
            };
            console.log(`Tokens for ${providerId}:`, {
              ...decryptedTokens,
              access_token: '[REDACTED]',
              refresh_token: '[REDACTED]',
            });
            resolve(decryptedTokens);
          } catch (decryptError) {
            console.error(`Error decrypting tokens for ${providerId}:`, decryptError);
            reject(new Error('Failed to decrypt tokens'));
          }
        } else {
          console.log(`Tokens for ${providerId}: Not found`);
          resolve(null);
        }
      });
    });
  }
  async _saveTokens(userId, providerId, tokens) {
    console.log('Saving tokens:', {
      userId,
      providerId,
      tokens: {
        ...tokens,
        access_token: '[REDACTED]',
        refresh_token: tokens.refresh_token ? '[PRESENT]' : '[NOT PRESENT]',
        expires_at: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null,
      },
    });
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO oauth_tokens 
        (id, user_id, provider_id, access_token, refresh_token, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [generateUUID(), userId, providerId, encrypt(tokens.access_token), encrypt(tokens.refresh_token) || null, tokens.expires_at || null],
        (err) => {
          if (err) {
            console.error('Error saving tokens:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
  async _setupTokenRefreshForUser(userId, authToken) {
    // Desktop version: Token refresh is handled by remote server
    // This method is kept for compatibility but does nothing
    console.log('Desktop: Token refresh is handled by remote server');
    return;
  }
  async _refreshToken(userId, providerId) {
    try {
      const currentTokens = await this._getTokens(userId, providerId);
      if (!currentTokens || !currentTokens.refresh_token) {
        console.log(`No refresh token available for user ${userId} and provider ${providerId}. Skipping refresh.`);
        return null;
      }

      console.log(`Refreshing token for ${providerId}`);
      const provider = this.providers.get(providerId);
      const newTokens = await provider.refreshTokens(currentTokens.refresh_token);
      console.log('New tokens after refresh:', {
        ...newTokens,
        access_token: '[REDACTED]',
        refresh_token: '[REDACTED]',
      });
      await this._saveTokens(userId, providerId, newTokens);
      return newTokens;
    } catch (error) {
      console.error(`Failed to refresh token for user ${userId} and provider ${providerId}:`, error);
      // If refresh fails, we might want to clear the tokens or mark them as invalid
      await this._invalidateTokens(userId, providerId);
      return null;
    }
  }
  async _invalidateTokens(userId, providerId) {
    console.log(`Invalidating tokens for user ${userId} and provider ${providerId}`);
    await this._saveTokens(userId, providerId, {
      access_token: null,
      refresh_token: null,
      expires_at: null,
    });
  }
}

// TODO: move these to their own provider files:

// Provider-specific health check functions
async function checkGitHubHealth(token) {
  try {
    const response = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: 'healthy',
      provider: 'github',
      lastChecked: new Date().toISOString(),
      details: {
        username: response.data.login,
        plan: response.data.plan?.name,
      },
    };
  } catch (error) {
    throw new Error('GitHub token validation failed');
  }
}

async function checkSlackHealth(token) {
  try {
    const response = await axios.post('https://slack.com/api/auth.test', null, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: response.data.ok ? 'healthy' : 'error',
      provider: 'slack',
      lastChecked: new Date().toISOString(),
      details: response.data.ok
        ? {
            team: response.data.team,
            user: response.data.user,
          }
        : { error: response.data.error },
    };
  } catch (error) {
    throw new Error('Slack token validation failed');
  }
}

async function checkGoogleHealth(token) {
  try {
    const response = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: 'healthy',
      provider: 'google',
      lastChecked: new Date().toISOString(),
      details: {
        email: response.data.email,
        verified: response.data.verified_email,
      },
    };
  } catch (error) {
    throw new Error('Google token validation failed');
  }
}

async function checkTwitterHealth(token) {
  try {
    console.log('Checking Twitter health with token:', token);
    const response = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: 'healthy',
      provider: 'twitter',
      lastChecked: new Date().toISOString(),
      details: {
        username: response.data.data.username,
        id: response.data.data.id,
      },
    };
  } catch (error) {
    console.error('Twitter token validation failed:', error);
    throw new Error('Twitter token validation failed');
  }
}

async function checkOpenAIHealth(token) {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      status: 'healthy',
      provider: 'openai',
      lastChecked: new Date().toISOString(),
      details: {
        hasAccess: true,
        modelsAvailable: response.data.data.length,
      },
    };
  } catch (error) {
    throw new Error('OpenAI token validation failed');
  }
}

// Add missing provider health checks
async function checkAnthropicHealth(token) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      },
      {
        headers: {
          'x-api-key': token,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );
    return {
      status: 'healthy',
      provider: 'anthropic',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true },
    };
  } catch (error) {
    // If it's a 401, token is invalid. Other errors might be rate limits, etc.
    if (error.response?.status === 401) {
      throw new Error('Anthropic token validation failed');
    }
    // For other errors, we might still have a valid token
    return {
      status: 'healthy',
      provider: 'anthropic',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true, note: 'Token valid but API returned error' },
    };
  }
}

async function checkClaudeCodeHealth(token) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );
    return {
      status: 'healthy',
      provider: 'claude-code',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true },
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Claude Code token validation failed');
    }
    return {
      status: 'healthy',
      provider: 'claude-code',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true, note: 'Token valid but API returned error' },
    };
  }
}

async function checkStripeHealth(token) {
  try {
    const response = await axios.get('https://api.stripe.com/v1/charges?limit=1', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Stripe-Version': '2023-10-16',
      },
    });
    return {
      status: 'healthy',
      provider: 'stripe',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true },
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Stripe token validation failed');
    }
    return {
      status: 'healthy',
      provider: 'stripe',
      lastChecked: new Date().toISOString(),
      details: { hasValidToken: true },
    };
  }
}

async function checkDiscordHealth(token) {
  try {
    const response = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    return {
      status: 'healthy',
      provider: 'discord',
      lastChecked: new Date().toISOString(),
      details: {
        username: response.data.username,
        id: response.data.id,
      },
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Discord token validation failed');
    }
    throw error;
  }
}

async function checkDropboxHealth(token) {
  try {
    console.log('Checking Dropbox health with token length:', token?.length);
    const response = await axios.post('https://api.dropboxapi.com/2/users/get_current_account', null, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return {
      status: 'healthy',
      provider: 'dropbox',
      lastChecked: new Date().toISOString(),
      details: {
        email: response.data.email,
        name: response.data.name.display_name,
      },
    };
  } catch (error) {
    console.error('Dropbox health check error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    if (error.response?.status === 401) {
      throw new Error('Dropbox token validation failed');
    }
    throw error;
  }
}

export default new AuthManager();
