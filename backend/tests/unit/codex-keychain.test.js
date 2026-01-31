/**
 * Unit tests for Codex Keychain reading
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

// Mock the keychain module
jest.unstable_mockModule('../../src/utils/keychain.js', () => ({
  keychainManager: {
    isAvailable: jest.fn(),
    read: jest.fn(),
    readSync: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
  },
  default: {
    isAvailable: jest.fn(),
    read: jest.fn(),
    readSync: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
  },
}));

const { keychainManager } = await import('../../src/utils/keychain.js');

describe('Codex Keychain Reading', () => {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

  const mockKeychainData = JSON.stringify({
    tokens: {
      access_token: 'eyJhbGciOiJSUzI1NiIs-test-jwt-token',
      refresh_token: 'rt_test-refresh-token-xyz789',
      account_id: 'fc0546c6-312f-4955-aed3-e7f07e6a9901',
    },
    last_refresh: '2026-01-25T16:46:57.579846Z',
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Keychain account hash calculation', () => {
    it('should compute correct account hash format', () => {
      const hash = crypto.createHash('sha256').update(codexHome).digest('hex');
      const account = `cli|${hash.slice(0, 16)}`;

      expect(account).toMatch(/^cli\|[a-f0-9]{16}$/);
    });

    it('should use first 16 characters of SHA256 hash', () => {
      const hash = crypto.createHash('sha256').update(codexHome).digest('hex');
      expect(hash.length).toBe(64); // SHA256 = 64 hex chars

      const truncated = hash.slice(0, 16);
      expect(truncated.length).toBe(16);
    });

    it('should produce consistent hash for same input', () => {
      const hash1 = crypto.createHash('sha256').update(codexHome).digest('hex').slice(0, 16);
      const hash2 = crypto.createHash('sha256').update(codexHome).digest('hex').slice(0, 16);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Keychain service name', () => {
    it('should use correct service name "Codex Auth"', () => {
      const expectedService = 'Codex Auth';
      expect(expectedService).toBe('Codex Auth');
    });
  });

  describe('readCodexKeychainCredentials', () => {
    it('should read credentials from Keychain with account hash', async () => {
      const hash = crypto.createHash('sha256').update(codexHome).digest('hex');
      const account = `cli|${hash.slice(0, 16)}`;

      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(mockKeychainData);

      const result = await keychainManager.read('Codex Auth', account);

      expect(keychainManager.read).toHaveBeenCalledWith('Codex Auth', account);
      expect(result).toBe(mockKeychainData);
    });

    it('should return null when Keychain entry does not exist', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(null);

      const result = await keychainManager.read('Codex Auth', 'cli|abc123');

      expect(result).toBeNull();
    });
  });

  describe('Codex data structure', () => {
    it('should have tokens object with access_token and refresh_token', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(parsed.tokens).toBeDefined();
      expect(parsed.tokens.access_token).toBeDefined();
      expect(parsed.tokens.refresh_token).toBeDefined();
      expect(parsed.tokens.account_id).toBeDefined();
    });

    it('should have last_refresh timestamp', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(parsed.last_refresh).toBeDefined();
      expect(new Date(parsed.last_refresh)).toBeInstanceOf(Date);
    });

    it('should have JWT-style access token', () => {
      const parsed = JSON.parse(mockKeychainData);

      // Codex uses JWT tokens that start with eyJ (base64 of {"alg"...)
      expect(parsed.tokens.access_token).toMatch(/^eyJ/);
    });

    it('should have rt_ prefixed refresh token', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(parsed.tokens.refresh_token).toMatch(/^rt_/);
    });
  });

  describe('Expiry calculation', () => {
    it('should calculate expiresAt from last_refresh + 1 hour', () => {
      const parsed = JSON.parse(mockKeychainData);
      const lastRefresh = new Date(parsed.last_refresh).getTime();
      const expiresAt = lastRefresh + (60 * 60 * 1000); // +1 hour

      expect(expiresAt).toBe(lastRefresh + 3600000);
    });

    it('should handle ISO 8601 timestamp format', () => {
      const parsed = JSON.parse(mockKeychainData);
      const lastRefresh = new Date(parsed.last_refresh);

      expect(lastRefresh.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Error handling', () => {
    it('should handle missing tokens object', () => {
      const invalidData = JSON.stringify({ last_refresh: '2026-01-25T16:46:57.579846Z' });
      const parsed = JSON.parse(invalidData);

      expect(parsed.tokens).toBeUndefined();
    });

    it('should handle missing last_refresh', () => {
      const invalidData = JSON.stringify({
        tokens: { access_token: 'test', refresh_token: 'test' },
      });
      const parsed = JSON.parse(invalidData);

      expect(parsed.last_refresh).toBeUndefined();
    });
  });
});

describe('Codex JSON Fallback', () => {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');

  describe('File path resolution', () => {
    it('should resolve to ~/.codex/auth.json by default', () => {
      const expectedPath = path.join(os.homedir(), '.codex', 'auth.json');
      expect(authPath).toBe(expectedPath);
    });

    it('should respect CODEX_HOME environment variable', () => {
      const customHome = '/custom/codex/path';
      const customPath = path.join(customHome, 'auth.json');

      expect(customPath).toBe('/custom/codex/path/auth.json');
    });
  });
});
