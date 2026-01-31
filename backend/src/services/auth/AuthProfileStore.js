/**
 * AuthProfileStore - Manages auth-profiles.json storage
 *
 * Handles reading, writing, and managing authentication profiles
 * with support for multiple profiles per provider.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import { createEmptyStore, createAuthProfile, isTokenExpired } from './types.js';
import { createAuthLogger } from '../../utils/auth-logger.js';
import encryptedStorage from '../../utils/encrypted-storage.js';

const logger = createAuthLogger('profile-store');

// Default filename
const AUTH_PROFILES_FILENAME = 'auth-profiles.json';

class AuthProfileStore {
  constructor() {
    this._store = null;
    this._filePath = null;
  }

  /**
   * Get the path to auth-profiles.json
   * @returns {string}
   */
  getFilePath() {
    if (this._filePath) {
      return this._filePath;
    }

    // Try to get Electron userData path, fallback to home directory
    let userDataPath;
    try {
      userDataPath = app?.getPath('userData');
    } catch {
      // Not running in Electron or app not ready
      userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.agnt');
    }

    this._filePath = path.join(userDataPath, AUTH_PROFILES_FILENAME);
    return this._filePath;
  }

  /**
   * Load the store from disk
   * @returns {import('./types.js').AuthProfileStore}
   */
  load() {
    const filePath = this.getFilePath();

    try {
      if (!fs.existsSync(filePath)) {
        logger.logEvent('credentials_loaded', { exists: false, path: filePath });
        this._store = createEmptyStore();
        return this._store;
      }

      const raw = fs.readFileSync(filePath, 'utf8');

      // Check if file is encrypted (non-macOS)
      let data;
      if (encryptedStorage.shouldUse() && raw.match(/^[A-Za-z0-9+/]+=*$/)) {
        // Looks like base64 encrypted data
        try {
          data = encryptedStorage.decryptJson(raw);
        } catch {
          // Not encrypted, try parsing as JSON
          data = JSON.parse(raw);
        }
      } else {
        data = JSON.parse(raw);
      }

      // Validate and migrate if needed
      this._store = this._validateAndMigrate(data);
      logger.logEvent('credentials_loaded', {
        exists: true,
        profileCount: Object.keys(this._store.profiles).length,
      });

      return this._store;
    } catch (error) {
      console.error('[AuthProfileStore] Failed to load store:', error.message);
      logger.error('LOAD_FAILED', error.message);
      this._store = createEmptyStore();
      return this._store;
    }
  }

  /**
   * Save the store to disk (atomic write)
   * @param {import('./types.js').AuthProfileStore} [store] - Store to save (uses current if not provided)
   * @returns {boolean}
   */
  save(store = null) {
    if (store) {
      this._store = store;
    }

    if (!this._store) {
      console.error('[AuthProfileStore] No store to save');
      return false;
    }

    const filePath = this.getFilePath();
    const tempPath = `${filePath}.tmp`;

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Serialize data
      let dataToWrite;
      if (encryptedStorage.shouldUse()) {
        // Encrypt on non-macOS platforms
        dataToWrite = encryptedStorage.encrypt(this._store);
      } else {
        dataToWrite = JSON.stringify(this._store, null, 2);
      }

      // Atomic write: write to temp file, then rename
      fs.writeFileSync(tempPath, dataToWrite, 'utf8');
      fs.renameSync(tempPath, filePath);

      logger.logEvent('credentials_saved', {
        profileCount: Object.keys(this._store.profiles).length,
      });

      return true;
    } catch (error) {
      console.error('[AuthProfileStore] Failed to save store:', error.message);
      logger.error('SAVE_FAILED', error.message);

      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {}

      return false;
    }
  }

  /**
   * Add or update a profile
   * @param {string} profileId - Profile ID
   * @param {Partial<import('./types.js').AuthProfile>} credential - Credential data
   * @returns {import('./types.js').AuthProfile}
   */
  upsertProfile(profileId, credential) {
    if (!this._store) {
      this.load();
    }

    const existing = this._store.profiles[profileId];
    const now = Date.now();

    const profile = createAuthProfile({
      ...existing,
      ...credential,
      id: profileId,
      updatedAt: now,
      createdAt: existing?.createdAt || now,
    });

    this._store.profiles[profileId] = profile;

    // Update order array for provider
    const provider = profile.provider;
    if (!this._store.order[provider]) {
      this._store.order[provider] = [];
    }
    if (!this._store.order[provider].includes(profileId)) {
      this._store.order[provider].push(profileId);
    }

    // Set as lastGood if it's the first profile for this provider
    if (!this._store.lastGood[provider]) {
      this._store.lastGood[provider] = profileId;
    }

    this.save();
    return profile;
  }

  /**
   * Get a single profile by ID
   * @param {string} profileId - Profile ID
   * @returns {import('./types.js').AuthProfile | null}
   */
  getProfile(profileId) {
    if (!this._store) {
      this.load();
    }
    return this._store.profiles[profileId] || null;
  }

  /**
   * Get all profiles for a provider
   * @param {string} provider - Provider name
   * @returns {import('./types.js').AuthProfile[]}
   */
  getProfilesForProvider(provider) {
    if (!this._store) {
      this.load();
    }

    const profileIds = this._store.order[provider] || [];
    return profileIds
      .map(id => this._store.profiles[id])
      .filter(Boolean);
  }

  /**
   * Get the default (lastGood) profile for a provider
   * @param {string} provider - Provider name
   * @returns {import('./types.js').AuthProfile | null}
   */
  getDefaultProfile(provider) {
    if (!this._store) {
      this.load();
    }

    const lastGoodId = this._store.lastGood[provider];
    if (lastGoodId && this._store.profiles[lastGoodId]) {
      return this._store.profiles[lastGoodId];
    }

    // Fallback to first profile for provider
    const profiles = this.getProfilesForProvider(provider);
    return profiles[0] || null;
  }

  /**
   * Set the default profile for a provider
   * @param {string} provider - Provider name
   * @param {string} profileId - Profile ID to set as default
   */
  setDefaultProfile(provider, profileId) {
    if (!this._store) {
      this.load();
    }

    if (this._store.profiles[profileId]) {
      this._store.lastGood[provider] = profileId;
      this.save();
    }
  }

  /**
   * Delete a profile
   * @param {string} profileId - Profile ID to delete
   * @returns {boolean}
   */
  deleteProfile(profileId) {
    if (!this._store) {
      this.load();
    }

    const profile = this._store.profiles[profileId];
    if (!profile) {
      return false;
    }

    const provider = profile.provider;

    // Remove from profiles
    delete this._store.profiles[profileId];

    // Remove from order
    if (this._store.order[provider]) {
      this._store.order[provider] = this._store.order[provider].filter(id => id !== profileId);
    }

    // Update lastGood if needed
    if (this._store.lastGood[provider] === profileId) {
      const remaining = this._store.order[provider] || [];
      this._store.lastGood[provider] = remaining[0] || null;
    }

    this.save();
    return true;
  }

  /**
   * Check if any profiles exist
   * @returns {boolean}
   */
  hasProfiles() {
    if (!this._store) {
      this.load();
    }
    return Object.keys(this._store.profiles).length > 0;
  }

  /**
   * Get all profiles
   * @returns {import('./types.js').AuthProfile[]}
   */
  getAllProfiles() {
    if (!this._store) {
      this.load();
    }
    return Object.values(this._store.profiles);
  }

  /**
   * Validate and migrate store data if needed
   * @private
   */
  _validateAndMigrate(data) {
    // Ensure basic structure
    const store = {
      version: data.version || 1,
      profiles: data.profiles || {},
      order: data.order || {},
      lastGood: data.lastGood || {},
    };

    // Migrate from version 0 or undefined
    if (!data.version) {
      store.version = 1;
    }

    // Ensure all profiles have required fields
    for (const [id, profile] of Object.entries(store.profiles)) {
      store.profiles[id] = createAuthProfile({ ...profile, id });
    }

    // Build order arrays from profiles if missing
    for (const profile of Object.values(store.profiles)) {
      const provider = profile.provider;
      if (!store.order[provider]) {
        store.order[provider] = [];
      }
      if (!store.order[provider].includes(profile.id)) {
        store.order[provider].push(profile.id);
      }
    }

    return store;
  }
}

// Export singleton instance
export const authProfileStore = new AuthProfileStore();
export default authProfileStore;
