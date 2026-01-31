/**
 * EncryptedStorage - AES-256-GCM encrypted JSON storage for non-macOS platforms
 *
 * Provides secure credential storage on Linux/Windows where Keychain is not available.
 * Uses AES-256-GCM with a key derived from machine-specific identifiers.
 */

import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

class EncryptedStorage {
  constructor() {
    this.platform = process.platform;
  }

  /**
   * Check if encrypted storage should be used (non-macOS platforms)
   * @returns {boolean}
   */
  shouldUse() {
    return this.platform !== 'darwin';
  }

  /**
   * Get a machine-specific identifier for key derivation
   * @returns {string}
   */
  getMachineId() {
    const hostname = os.hostname();
    const userInfo = os.userInfo();
    const username = userInfo.username || 'unknown';

    // Create a stable machine identifier from hostname and username
    const machineId = `${hostname}:${username}`;

    return crypto
      .createHash('sha256')
      .update(machineId)
      .digest('hex');
  }

  /**
   * Derive an encryption key from the machine ID and salt
   * @param {Buffer} salt - Random salt for key derivation
   * @returns {Buffer} - 256-bit encryption key
   */
  deriveKey(salt) {
    const machineId = this.getMachineId();

    // Use PBKDF2 with high iteration count for key derivation
    return crypto.pbkdf2Sync(
      machineId,
      salt,
      100000, // iterations
      KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param {string|object} data - Data to encrypt (will be JSON stringified if object)
   * @returns {string} - Base64 encoded encrypted data with salt, IV, and auth tag
   */
  encrypt(data) {
    if (data === undefined || data === null) {
      throw new Error('Data is required for encryption');
    }

    const dataString = typeof data === 'string' ? data : JSON.stringify(data);

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from machine ID and salt
    const key = this.deriveKey(salt);

    // Create cipher and encrypt
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(dataString, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + encrypted data
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);

    return combined.toString('base64');
  }

  /**
   * Decrypt data encrypted with AES-256-GCM
   * @param {string} ciphertext - Base64 encoded encrypted data
   * @returns {string} - Decrypted data as string
   */
  decrypt(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') {
      throw new Error('Ciphertext is required for decryption');
    }

    const combined = Buffer.from(ciphertext, 'base64');

    // Extract components
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.slice(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    // Derive key from machine ID and extracted salt
    const key = this.deriveKey(salt);

    // Create decipher and decrypt
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Decrypt and parse JSON data
   * @param {string} ciphertext - Base64 encoded encrypted JSON data
   * @returns {object} - Parsed JSON object
   */
  decryptJson(ciphertext) {
    const decrypted = this.decrypt(ciphertext);
    return JSON.parse(decrypted);
  }

  /**
   * Read and decrypt a file
   * @param {string} filePath - Path to encrypted file
   * @returns {Promise<string|null>} - Decrypted content or null if file doesn't exist
   */
  async readEncryptedFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return this.decrypt(content.trim());
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Encrypt and write data to a file
   * @param {string} filePath - Path to write encrypted file
   * @param {string|object} data - Data to encrypt and write
   * @returns {Promise<boolean>} - True if successful
   */
  async writeEncryptedFile(filePath, data) {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const encrypted = this.encrypt(data);
      fs.writeFileSync(filePath, encrypted, 'utf8');
      return true;
    } catch (error) {
      console.error('[EncryptedStorage] Write error:', error.message);
      return false;
    }
  }
}

// Export singleton instance
export const encryptedStorage = new EncryptedStorage();
export default encryptedStorage;
