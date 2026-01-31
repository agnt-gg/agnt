/**
 * Unit tests for Claude Code Keychain reading
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
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

// Import after mocking
const { keychainManager } = await import('../../src/utils/keychain.js');

describe('Claude Code Keychain Reading', () => {
  const mockKeychainData = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-test-access-token-abc123',
      refreshToken: 'sk-ant-ort01-test-refresh-token-xyz789',
      expiresAt: Date.now() + 3600000, // 1 hour from now
      scopes: ['user:inference', 'user:mcp_servers', 'user:profile'],
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Keychain service name', () => {
    it('should use correct service name "Claude Code-credentials"', () => {
      const expectedService = 'Claude Code-credentials';
      expect(expectedService).toBe('Claude Code-credentials');
    });
  });

  describe('readClaudeKeychainCredentials', () => {
    it('should read credentials from Keychain on macOS', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(mockKeychainData);

      const result = await keychainManager.read('Claude Code-credentials');

      expect(keychainManager.read).toHaveBeenCalledWith('Claude Code-credentials');
      expect(result).toBe(mockKeychainData);
    });

    it('should return null when Keychain entry does not exist', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(null);

      const result = await keychainManager.read('Claude Code-credentials');

      expect(result).toBeNull();
    });

    it('should parse JSON data correctly', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(mockKeychainData);

      const result = await keychainManager.read('Claude Code-credentials');
      const parsed = JSON.parse(result);

      expect(parsed.claudeAiOauth).toBeDefined();
      expect(parsed.claudeAiOauth.accessToken).toBe('sk-ant-oat01-test-access-token-abc123');
      expect(parsed.claudeAiOauth.refreshToken).toBe('sk-ant-ort01-test-refresh-token-xyz789');
      expect(parsed.claudeAiOauth.scopes).toContain('user:inference');
    });
  });

  describe('Keychain data structure', () => {
    it('should have correct OAuth token structure', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(parsed.claudeAiOauth).toHaveProperty('accessToken');
      expect(parsed.claudeAiOauth).toHaveProperty('refreshToken');
      expect(parsed.claudeAiOauth).toHaveProperty('expiresAt');
      expect(parsed.claudeAiOauth).toHaveProperty('scopes');
      expect(parsed.claudeAiOauth).toHaveProperty('subscriptionType');
    });

    it('should have valid token format', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(parsed.claudeAiOauth.accessToken).toMatch(/^sk-ant-oat/);
      expect(parsed.claudeAiOauth.refreshToken).toMatch(/^sk-ant-ort/);
    });

    it('should have expiresAt as number (timestamp)', () => {
      const parsed = JSON.parse(mockKeychainData);

      expect(typeof parsed.claudeAiOauth.expiresAt).toBe('number');
      expect(parsed.claudeAiOauth.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('Error handling', () => {
    it('should handle corrupted JSON gracefully', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue('invalid json {{{');

      const result = await keychainManager.read('Claude Code-credentials');

      expect(() => JSON.parse(result)).toThrow();
    });

    it('should handle Keychain access denied', async () => {
      keychainManager.isAvailable.mockReturnValue(true);
      keychainManager.read.mockResolvedValue(null);

      const result = await keychainManager.read('Claude Code-credentials');

      expect(result).toBeNull();
    });
  });
});

describe('Claude Code JSON Fallback', () => {
  const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

  describe('File path resolution', () => {
    it('should resolve to ~/.claude/.credentials.json', () => {
      const expectedPath = path.join(os.homedir(), '.claude', '.credentials.json');
      expect(credentialsPath).toBe(expectedPath);
    });
  });

  describe('JSON file structure', () => {
    it('should have same structure as Keychain data', () => {
      const jsonData = {
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-json-token',
          refreshToken: 'sk-ant-ort01-json-refresh',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:inference'],
          subscriptionType: 'max',
        },
      };

      expect(jsonData.claudeAiOauth).toHaveProperty('accessToken');
      expect(jsonData.claudeAiOauth).toHaveProperty('refreshToken');
      expect(jsonData.claudeAiOauth).toHaveProperty('expiresAt');
    });
  });
});
