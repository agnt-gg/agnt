import db from '../../models/database/index.js';
import generateUUID from '../../utils/generateUUID.js';
import { decrypt, encrypt } from '../../utils/encryption.js';

class LocalApiKeyManager {
  async getApiKey(userId, providerId) {
    if (!userId || !providerId) return null;

    return new Promise((resolve, reject) => {
      db.get(
        'SELECT api_key FROM api_keys WHERE user_id = ? AND provider_id = ?',
        [userId, providerId],
        (err, row) => {
          if (err) {
            console.error('[LocalApiKeyManager] Failed to read API key:', err);
            return reject(err);
          }
          if (!row?.api_key) return resolve(null);

          try {
            const decrypted = decrypt(row.api_key);
            return resolve(decrypted || null);
          } catch (decryptError) {
            console.error('[LocalApiKeyManager] Failed to decrypt API key:', decryptError);
            return reject(new Error('Failed to decrypt API key'));
          }
        }
      );
    });
  }

  async hasApiKey(userId, providerId) {
    const key = await this.getApiKey(userId, providerId);
    return Boolean(key);
  }

  async saveApiKey(userId, providerId, apiKey) {
    if (!userId || !providerId) {
      throw new Error('userId and providerId are required to save an API key.');
    }
    if (!apiKey || !String(apiKey).trim()) {
      throw new Error('API key is required.');
    }

    const encrypted = encrypt(String(apiKey).trim());

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO api_keys
         (id, user_id, provider_id, api_key, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [generateUUID(), userId, providerId, encrypted],
        (err) => {
          if (err) {
            console.error('[LocalApiKeyManager] Failed to save API key:', err);
            return reject(err);
          }
          resolve({ success: true });
        }
      );
    });
  }

  async deleteApiKey(userId, providerId) {
    if (!userId || !providerId) return { success: false };

    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM api_keys WHERE user_id = ? AND provider_id = ?',
        [userId, providerId],
        (err) => {
          if (err) {
            console.error('[LocalApiKeyManager] Failed to delete API key:', err);
            return reject(err);
          }
          resolve({ success: true });
        }
      );
    });
  }
}

export default new LocalApiKeyManager();
