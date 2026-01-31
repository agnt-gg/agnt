/**
 * Unit tests for EncryptedStorage utility
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import encryptedStorage from '../../src/utils/encrypted-storage.js';

describe('EncryptedStorage', () => {
  describe('getMachineId', () => {
    it('should return a consistent machine ID', () => {
      const id1 = encryptedStorage.getMachineId();
      const id2 = encryptedStorage.getMachineId();

      expect(id1).toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBe(64); // SHA256 hex = 64 chars
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const original = 'Hello, World!';
      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decrypt(encrypted);

      expect(decrypted).toBe(original);
      expect(encrypted).not.toBe(original);
    });

    it('should encrypt and decrypt an object', () => {
      const original = {
        accessToken: 'sk-ant-oat01-test-token',
        refreshToken: 'sk-ant-ort01-refresh',
        expiresAt: Date.now() + 3600000,
      };

      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decryptJson(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const original = 'test data';
      const encrypted1 = encryptedStorage.encrypt(original);
      const encrypted2 = encryptedStorage.encrypt(original);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same value
      expect(encryptedStorage.decrypt(encrypted1)).toBe(original);
      expect(encryptedStorage.decrypt(encrypted2)).toBe(original);
    });

    it('should handle empty string', () => {
      const original = '';
      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle special characters and unicode', () => {
      const original = 'Hello 世界! 🌍 <script>alert("test")</script>';
      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle large data', () => {
      const original = 'x'.repeat(100000);
      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decrypt(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should throw on null/undefined encryption', () => {
      expect(() => encryptedStorage.encrypt(null)).toThrow();
      expect(() => encryptedStorage.encrypt(undefined)).toThrow();
    });

    it('should throw on invalid ciphertext decryption', () => {
      expect(() => encryptedStorage.decrypt('invalid')).toThrow();
      expect(() => encryptedStorage.decrypt('')).toThrow();
      expect(() => encryptedStorage.decrypt(null)).toThrow();
    });

    it('should throw on tampered ciphertext', () => {
      const original = 'test data';
      const encrypted = encryptedStorage.encrypt(original);

      // Tamper with the ciphertext
      const tamperedBuffer = Buffer.from(encrypted, 'base64');
      tamperedBuffer[tamperedBuffer.length - 1] ^= 0xFF;
      const tampered = tamperedBuffer.toString('base64');

      expect(() => encryptedStorage.decrypt(tampered)).toThrow();
    });
  });

  describe('shouldUse', () => {
    it('should return boolean based on platform', () => {
      const result = encryptedStorage.shouldUse();
      expect(typeof result).toBe('boolean');

      // On macOS, should be false (use Keychain instead)
      if (process.platform === 'darwin') {
        expect(result).toBe(false);
      } else {
        expect(result).toBe(true);
      }
    });
  });

  describe('JSON data handling', () => {
    it('should preserve all JSON data types', () => {
      const original = {
        string: 'hello',
        number: 42,
        float: 3.14,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          a: 1,
          b: 'two',
        },
      };

      const encrypted = encryptedStorage.encrypt(original);
      const decrypted = encryptedStorage.decryptJson(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should handle auth profile structure', () => {
      const profile = {
        id: 'claude-main',
        provider: 'anthropic',
        type: 'oauth',
        accessToken: 'sk-ant-oat01-test-token-abc123',
        refreshToken: 'sk-ant-ort01-refresh-token-xyz789',
        expiresAt: 1769919862349,
        email: 'user@example.com',
        scopes: ['user:inference', 'user:mcp_servers', 'user:profile'],
        subscriptionType: 'max',
        createdAt: 1769916262349,
        updatedAt: 1769919862349,
      };

      const encrypted = encryptedStorage.encrypt(profile);
      const decrypted = encryptedStorage.decryptJson(encrypted);

      expect(decrypted).toEqual(profile);
    });
  });
});
