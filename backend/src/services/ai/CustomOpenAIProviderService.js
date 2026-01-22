import db from '../../models/database/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import generateUUID from '../../utils/generateUUID.js';
import fetch from 'node-fetch';

class CustomOpenAIProviderService {
  /**
   * Test connection to a custom provider
   * @param {string} baseUrl - Provider base URL
   * @param {string} apiKey - Provider API key
   * @returns {Promise<Object>} Test result with status and details
   */
  async testConnection(baseUrl, apiKey) {
    try {
      // Normalize the base URL
      let normalizedUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

      // If the URL doesn't end with /v1, add it (for OpenAI-compatible APIs like LM Studio)
      if (!normalizedUrl.endsWith('/v1')) {
        normalizedUrl = `${normalizedUrl}/v1`;
      }

      const modelsUrl = `${normalizedUrl}/models`;

      console.log(`Testing connection to: ${modelsUrl}`);

      const headers = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(modelsUrl, {
        headers,
        timeout: 10000, // 10 second timeout
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
        };
      }

      const data = await response.json();
      const models = data.data || [];

      console.log(`Found ${models.length} models from ${modelsUrl}`);

      return {
        success: true,
        modelsCount: models.length,
        models: models.slice(0, 5).map((m) => m.id), // Return first 5 model IDs
      };
    } catch (error) {
      console.error('Test connection error:', error);
      return {
        success: false,
        error: error.message || 'Connection test failed',
      };
    }
  }

  /**
   * Get all custom providers for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of providers (without API keys)
   */
  async getProvidersByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, user_id, provider_name, base_url, is_active, created_at, updated_at 
        FROM custom_openai_providers 
        WHERE user_id = ? AND is_active = 1
        ORDER BY created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            console.error('Error fetching custom providers:', err);
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get a specific custom provider by ID
   * @param {string} providerId - Provider ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Provider data (without API key)
   */
  async getProviderById(providerId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT id, user_id, provider_name, base_url, is_active, created_at, updated_at 
        FROM custom_openai_providers 
        WHERE id = ? AND user_id = ?`,
        [providerId, userId],
        (err, row) => {
          if (err) {
            console.error('Error fetching custom provider:', err);
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Get provider credentials (including decrypted API key)
   * @param {string} providerId - Provider ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Provider with decrypted API key
   */
  async getProviderCredentials(providerId, userId) {
    return new Promise((resolve, reject) => {
      // First check if provider exists at all (for better error messages)
      db.get(
        `SELECT id, user_id, provider_name, is_active FROM custom_openai_providers WHERE id = ?`,
        [providerId],
        (err, providerCheck) => {
          if (err) {
            console.error('[CustomProvider] Error checking provider:', err);
          } else if (providerCheck) {
            console.log('[CustomProvider] Provider found:', {
              id: providerCheck.id,
              name: providerCheck.provider_name,
              owner_user_id: providerCheck.user_id,
              requested_user_id: userId,
              is_active: providerCheck.is_active,
              user_match: providerCheck.user_id === userId,
            });
          } else {
            console.log('[CustomProvider] Provider does not exist in database:', providerId);
          }
        }
      );

      // Now get the actual credentials
      db.get(
        `SELECT * FROM custom_openai_providers
        WHERE id = ? AND user_id = ? AND is_active = 1`,
        [providerId, userId],
        (err, row) => {
          if (err) {
            console.error('[CustomProvider] Error fetching provider credentials:', err);
            reject(err);
          } else if (!row) {
            console.warn('[CustomProvider] No credentials found for:', {
              providerId,
              userId,
              reason: 'Either user_id mismatch, provider inactive, or provider does not exist',
            });
            resolve(null);
          } else {
            try {
              let decryptedApiKey = null;
              if (row.api_key) {
                decryptedApiKey = decrypt(row.api_key);
              }
              resolve({
                ...row,
                api_key: decryptedApiKey,
              });
            } catch (decryptError) {
              console.error('[CustomProvider] Error decrypting API key:', decryptError);
              reject(new Error('Failed to decrypt API key'));
            }
          }
        }
      );
    });
  }

  /**
   * Update a custom provider
   * @param {string} providerId - Provider ID
   * @param {string} userId - User ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated provider
   */
  async updateProvider(providerId, userId, updates) {
    const { provider_name, base_url, api_key } = updates;

    // Validate URL if provided
    if (base_url) {
      try {
        new URL(base_url);
      } catch (error) {
        throw new Error('Invalid base_url format');
      }
    }

    const updateFields = [];
    const updateValues = [];

    if (provider_name) {
      updateFields.push('provider_name = ?');
      updateValues.push(provider_name);
    }

    if (base_url) {
      updateFields.push('base_url = ?');
      updateValues.push(base_url);
    }

    // Allow updating API key (including setting it to null/empty if passed as empty string)
    if (api_key !== undefined) {
      updateFields.push('api_key = ?');
      updateValues.push(api_key ? encrypt(api_key) : null);
    }

    if (updateFields.length === 0) {
      throw new Error('No fields to update');
    }

    updateFields.push("updated_at = datetime('now')");
    updateValues.push(providerId, userId);

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE custom_openai_providers 
        SET ${updateFields.join(', ')} 
        WHERE id = ? AND user_id = ?`,
        updateValues,
        function (err) {
          if (err) {
            console.error('Error updating custom provider:', err);
            reject(err);
          } else if (this.changes === 0) {
            reject(new Error('Provider not found or unauthorized'));
          } else {
            resolve({ id: providerId, ...updates });
          }
        }
      );
    });
  }

  /**
   * Delete a custom provider (soft delete)
   * @param {string} providerId - Provider ID
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async deleteProvider(providerId, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE custom_openai_providers 
        SET is_active = 0, updated_at = datetime('now') 
        WHERE id = ? AND user_id = ?`,
        [providerId, userId],
        function (err) {
          if (err) {
            console.error('Error deleting custom provider:', err);
            reject(err);
          } else if (this.changes === 0) {
            reject(new Error('Provider not found or unauthorized'));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Create a new custom OpenAI-compatible provider
   * @param {string} userId - User ID
   * @param {Object} providerData - Provider configuration
   * @returns {Promise<Object>} Created provider
   */
  async createProvider(userId, providerData) {
    const { provider_name, base_url, api_key } = providerData;

    // Validate required fields (api_key is optional)
    if (!provider_name || !base_url) {
      throw new Error('Missing required fields: provider_name, base_url');
    }

    // Validate URL format
    try {
      new URL(base_url);
    } catch (error) {
      throw new Error('Invalid base_url format');
    }

    // Normalize base URL - ensure it ends with /v1 for OpenAI compatibility
    let normalizedBaseUrl = base_url.endsWith('/') ? base_url.slice(0, -1) : base_url;
    if (!normalizedBaseUrl.endsWith('/v1')) {
      normalizedBaseUrl = `${normalizedBaseUrl}/v1`;
    }

    const id = generateUUID();
    // Encrypt API key if provided, otherwise store null
    const encryptedApiKey = api_key ? encrypt(api_key) : null;

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO custom_openai_providers 
        (id, user_id, provider_name, base_url, api_key, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
        [id, userId, provider_name, normalizedBaseUrl, encryptedApiKey],
        function (err) {
          if (err) {
            console.error('Error creating custom provider:', err);
            reject(err);
          } else {
            resolve({
              id,
              user_id: userId,
              provider_name,
              base_url: normalizedBaseUrl,
              is_active: 1,
            });
          }
        }
      );
    });
  }

  /**
   * Fetch available models from a custom provider
   * @param {string} providerId - Provider ID
   * @param {string} userId - User ID
   * @returns {Promise<Array>} List of model IDs
   */
  async fetchModels(providerId, userId) {
    const provider = await this.getProviderCredentials(providerId, userId);

    if (!provider) {
      throw new Error('Provider not found');
    }

    try {
      // Normalize the base URL
      let normalizedUrl = provider.base_url.endsWith('/') ? provider.base_url.slice(0, -1) : provider.base_url;

      // If the URL doesn't end with /v1, add it (for OpenAI-compatible APIs like LM Studio)
      if (!normalizedUrl.endsWith('/v1')) {
        normalizedUrl = `${normalizedUrl}/v1`;
      }

      const modelsUrl = `${normalizedUrl}/models`;

      console.log(`Fetching models from: ${modelsUrl}`);

      const headers = {
        'Content-Type': 'application/json',
      };

      if (provider.api_key) {
        headers['Authorization'] = `Bearer ${provider.api_key}`;
      }

      const response = await fetch(modelsUrl, {
        headers,
        timeout: 10000,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`Received models data:`, JSON.stringify(data, null, 2));

      const models = (data.data || []).map((model) => model.id);
      console.log(`Extracted ${models.length} models:`, models);

      return models;
    } catch (error) {
      console.error('Error fetching models from custom provider:', error);
      throw error;
    }
  }

  /**
   * Check if a provider ID is a custom provider
   * @param {string} providerId - Provider ID to check
   * @returns {Promise<boolean>} True if it's a custom provider ID
   */
  async isCustomProvider(providerId) {
    if (!providerId) return false;

    // Check if this provider ID exists in the custom providers table
    return new Promise((resolve) => {
      db.get('SELECT id FROM custom_openai_providers WHERE id = ? AND is_active = 1', [providerId], (err, row) => {
        if (err) {
          console.error('Error checking if provider is custom:', err);
          resolve(false);
        } else {
          resolve(!!row);
        }
      });
    });
  }
}

export default new CustomOpenAIProviderService();
