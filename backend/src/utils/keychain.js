/**
 * KeychainManager - macOS Keychain read/write utilities
 *
 * Provides secure credential storage on macOS using the native Keychain.
 * Falls back gracefully on non-macOS platforms.
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class KeychainManager {
  constructor() {
    this.platform = process.platform;
  }

  /**
   * Check if Keychain is available (macOS only)
   * @returns {boolean}
   */
  isAvailable() {
    return this.platform === 'darwin';
  }

  /**
   * Read a value from macOS Keychain
   * @param {string} service - The Keychain service name (e.g., "Claude Code-credentials")
   * @param {string} [account] - Optional account name
   * @returns {Promise<string|null>} - The stored value or null if not found
   */
  async read(service, account = null) {
    if (!this.isAvailable()) {
      throw new Error('Keychain is only available on macOS');
    }

    if (!service || typeof service !== 'string') {
      throw new Error('Service name is required');
    }

    try {
      const args = [
        'find-generic-password',
        '-s', service,
        '-w', // Output password only
      ];

      if (account) {
        args.splice(2, 0, '-a', account);
      }

      const command = `security ${args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`;
      const { stdout } = await execAsync(command, { encoding: 'utf8' });

      return stdout.trim() || null;
    } catch (error) {
      // Error code 44 means item not found - this is expected
      if (error.code === 44 || error.message?.includes('could not be found')) {
        return null;
      }
      // Error code 36 means user denied access
      if (error.code === 36 || error.message?.includes('User interaction is not allowed')) {
        console.warn('[Keychain] Access denied - user interaction required');
        return null;
      }
      console.error('[Keychain] Read error:', error.message);
      return null;
    }
  }

  /**
   * Read a value from Keychain synchronously
   * @param {string} service - The Keychain service name
   * @param {string} [account] - Optional account name
   * @returns {string|null} - The stored value or null if not found
   */
  readSync(service, account = null) {
    if (!this.isAvailable()) {
      throw new Error('Keychain is only available on macOS');
    }

    if (!service || typeof service !== 'string') {
      throw new Error('Service name is required');
    }

    try {
      const args = [
        'find-generic-password',
        '-s', service,
        '-w',
      ];

      if (account) {
        args.splice(2, 0, '-a', account);
      }

      const command = `security ${args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`;
      const result = execSync(command, { encoding: 'utf8' });

      return result.trim() || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Write a value to macOS Keychain
   * @param {string} service - The Keychain service name
   * @param {string} data - The data to store (will be stringified if object)
   * @param {string} [account] - Optional account name
   * @returns {Promise<boolean>} - True if successful
   */
  async write(service, data, account = null) {
    if (!this.isAvailable()) {
      throw new Error('Keychain is only available on macOS');
    }

    if (!service || typeof service !== 'string') {
      throw new Error('Service name is required');
    }

    if (data === undefined || data === null) {
      throw new Error('Data is required');
    }

    const dataString = typeof data === 'string' ? data : JSON.stringify(data);

    try {
      // First, try to delete existing entry (ignore errors if it doesn't exist)
      await this.delete(service, account).catch(() => {});

      const args = [
        'add-generic-password',
        '-s', service,
        '-w', dataString,
        '-U', // Update if exists
      ];

      if (account) {
        args.splice(2, 0, '-a', account);
      }

      // Use -U flag to update existing or add new
      const command = `security ${args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`;
      await execAsync(command, { encoding: 'utf8' });

      return true;
    } catch (error) {
      console.error('[Keychain] Write error:', error.message);
      return false;
    }
  }

  /**
   * Delete a Keychain entry
   * @param {string} service - The Keychain service name
   * @param {string} [account] - Optional account name
   * @returns {Promise<boolean>} - True if successful or entry didn't exist
   */
  async delete(service, account = null) {
    if (!this.isAvailable()) {
      throw new Error('Keychain is only available on macOS');
    }

    if (!service || typeof service !== 'string') {
      throw new Error('Service name is required');
    }

    try {
      const args = [
        'delete-generic-password',
        '-s', service,
      ];

      if (account) {
        args.splice(2, 0, '-a', account);
      }

      const command = `security ${args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ')}`;
      await execAsync(command, { encoding: 'utf8' });

      return true;
    } catch (error) {
      // Not found is fine - we wanted it deleted anyway
      if (error.code === 44 || error.message?.includes('could not be found')) {
        return true;
      }
      console.error('[Keychain] Delete error:', error.message);
      return false;
    }
  }
}

// Export singleton instance
export const keychainManager = new KeychainManager();
export default keychainManager;
