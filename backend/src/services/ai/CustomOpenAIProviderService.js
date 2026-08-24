import db from '../../models/database/index.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import generateUUID from '../../utils/generateUUID.js';
import fetch from 'node-fetch';

/**
 * Normalise a user-supplied model list into a JSON array string, or null.
 *
 * Accepts what the UI actually produces (a textarea: one id per line) as well
 * as a real array from an API caller, because both call the same service.
 * Returns null for "nothing declared", which is the signal to auto-discover —
 * so clearing the box restores the default behaviour rather than pinning an
 * empty catalog and leaving the picker permanently blank.
 *
 * @param {string|string[]|null|undefined} models
 * @returns {string|null} JSON array string, or null when nothing was declared
 */
export function serializeModelList(models) {
  if (models === null || models === undefined) return null;

  const list = Array.isArray(models) ? models : String(models).split(/[\r\n,]+/);

  const cleaned = [...new Set(list.map((m) => String(m).trim()).filter(Boolean))];

  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

/**
 * Inverse of serializeModelList. Never throws: a row hand-edited into invalid
 * JSON must degrade to auto-discovery, not break the model picker.
 *
 * @param {string|null} stored
 * @returns {string[]} declared model ids, empty when none
 */
export function parseModelList(stored) {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((m) => typeof m === 'string' && m) : [];
  } catch {
    console.warn('[CustomProvider] Ignoring unparseable stored model list');
    return [];
  }
}

class CustomOpenAIProviderService {
  /**
   * Test connection to a custom provider
   * @param {string} baseUrl - Provider base URL
   * @param {string} apiKey - Provider API key
   * @returns {Promise<Object>} Test result with status and details
   */
  async testConnection(baseUrl, apiKey) {
    try {
      // Normalize the base URL (trim — trailing space → /v1%20/v1/models)
      let normalizedUrl = String(baseUrl || '').trim();
      normalizedUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;

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

      // A 404 here means the host answered — it simply does not publish a model
      // catalog at this path. That is a real and supported shape of
      // OpenAI-compatible gateway (api.cline.bot is one), so reporting it as a
      // failed connection is wrong: it tells the user their URL or key is bad
      // when both are fine, and leaves them no path forward. Report it as a
      // success that needs a declared model list instead.
      if (response.status === 404) {
        return {
          success: true,
          modelsCount: 0,
          models: [],
          requiresManualModels: true,
          message:
            'Connected, but this provider does not publish a model list. Enter model IDs manually.',
        };
      }

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
        `SELECT id, user_id, provider_name, base_url, models, is_active, created_at, updated_at 
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
        `SELECT id, user_id, provider_name, base_url, models, is_active, created_at, updated_at 
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
    const { provider_name, base_url, api_key, models } = updates;

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
      updateValues.push(String(base_url).trim());
    }

    // Allow updating API key (including setting it to null/empty if passed as empty string)
    if (api_key !== undefined) {
      updateFields.push('api_key = ?');
      updateValues.push(api_key ? encrypt(api_key) : null);
    }

    // Presence, not truthiness: an empty submission is the user CLEARING the
    // list, which must write NULL to restore auto-discovery.
    if (models !== undefined) {
      updateFields.push('models = ?');
      updateValues.push(serializeModelList(models));
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
    const { provider_name, base_url, api_key, models } = providerData;

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
    let normalizedBaseUrl = String(base_url || '').trim();
    normalizedBaseUrl = normalizedBaseUrl.endsWith('/') ? normalizedBaseUrl.slice(0, -1) : normalizedBaseUrl;
    if (!normalizedBaseUrl.endsWith('/v1')) {
      normalizedBaseUrl = `${normalizedBaseUrl}/v1`;
    }

    const id = generateUUID();
    // Encrypt API key if provided, otherwise store null
    const encryptedApiKey = api_key ? encrypt(api_key) : null;
    const serializedModels = serializeModelList(models);

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO custom_openai_providers 
        (id, user_id, provider_name, base_url, api_key, models, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
        [id, userId, provider_name, normalizedBaseUrl, encryptedApiKey, serializedModels],
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
              models: serializedModels,
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

    // A declared list wins outright and skips the network entirely. Providers
    // that need this have no /models endpoint at all, so attempting the fetch
    // first would spend a timeout on every model refresh to reach the same
    // answer — and would log an error for a fully-configured provider.
    const declared = parseModelList(provider.models);
    if (declared.length > 0) {
      console.log(`[CustomProvider] Using ${declared.length} declared models for ${providerId}`);
      return declared;
    }

    try {
      // Normalize the base URL
      let normalizedUrl = String(provider.base_url || '').trim();
      normalizedUrl = normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;

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

      if (response.status === 404) {
        // Reachable, but publishes no catalog. The caller gets an empty list and
        // the UI prompts for a manual list; this is a configuration state, not a
        // fault, so it must not throw — throwing here is what filled tenant logs
        // with red for providers that were working correctly.
        console.log(
          `[CustomProvider] ${providerId} publishes no /models endpoint; a declared model list is required`
        );
        return [];
      }

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
