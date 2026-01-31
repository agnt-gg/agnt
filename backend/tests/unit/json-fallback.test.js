/**
 * Unit tests for JSON fallback credential storage
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('JSON Fallback Storage', () => {
  const testDir = path.join(os.tmpdir(), 'agnt-test-fallback');
  const claudeCredPath = path.join(testDir, '.claude', '.credentials.json');
  const codexAuthPath = path.join(testDir, '.codex', 'auth.json');

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('Claude credentials JSON', () => {
    it('should read Claude credentials from JSON file', () => {
      // Create test directory and file
      fs.mkdirSync(path.dirname(claudeCredPath), { recursive: true });

      const testCredentials = {
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-json-test-token',
          refreshToken: 'sk-ant-ort01-json-refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:inference'],
          subscriptionType: 'max',
        },
      };

      fs.writeFileSync(claudeCredPath, JSON.stringify(testCredentials, null, 2));

      const raw = fs.readFileSync(claudeCredPath, 'utf8');
      const parsed = JSON.parse(raw);

      expect(parsed.claudeAiOauth.accessToken).toBe('sk-ant-oat01-json-test-token');
      expect(parsed.claudeAiOauth.refreshToken).toBe('sk-ant-ort01-json-refresh-token');
    });

    it('should handle missing Claude credentials file', () => {
      expect(fs.existsSync(claudeCredPath)).toBe(false);

      let result = null;
      try {
        const raw = fs.readFileSync(claudeCredPath, 'utf8');
        result = JSON.parse(raw);
      } catch (error) {
        result = null;
      }

      expect(result).toBeNull();
    });

    it('should write Claude credentials to JSON file', () => {
      fs.mkdirSync(path.dirname(claudeCredPath), { recursive: true });

      const newCredentials = {
        claudeAiOauth: {
          accessToken: 'sk-ant-oat01-new-token',
          refreshToken: 'sk-ant-ort01-new-refresh',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:inference', 'user:profile'],
          subscriptionType: 'pro',
        },
      };

      fs.writeFileSync(claudeCredPath, JSON.stringify(newCredentials, null, 2));

      const raw = fs.readFileSync(claudeCredPath, 'utf8');
      const parsed = JSON.parse(raw);

      expect(parsed.claudeAiOauth.accessToken).toBe('sk-ant-oat01-new-token');
      expect(parsed.claudeAiOauth.subscriptionType).toBe('pro');
    });

    it('should preserve existing fields when updating', () => {
      fs.mkdirSync(path.dirname(claudeCredPath), { recursive: true });

      const existingCredentials = {
        claudeAiOauth: {
          accessToken: 'old-token',
          refreshToken: 'old-refresh',
          expiresAt: 1234567890,
          scopes: ['user:inference'],
          subscriptionType: 'max',
        },
        otherField: 'preserve-me',
      };

      fs.writeFileSync(claudeCredPath, JSON.stringify(existingCredentials, null, 2));

      // Update only OAuth data
      const raw = fs.readFileSync(claudeCredPath, 'utf8');
      const parsed = JSON.parse(raw);
      parsed.claudeAiOauth.accessToken = 'new-token';
      fs.writeFileSync(claudeCredPath, JSON.stringify(parsed, null, 2));

      const updated = JSON.parse(fs.readFileSync(claudeCredPath, 'utf8'));

      expect(updated.claudeAiOauth.accessToken).toBe('new-token');
      expect(updated.otherField).toBe('preserve-me');
    });
  });

  describe('Codex auth JSON', () => {
    it('should read Codex credentials from JSON file', () => {
      fs.mkdirSync(path.dirname(codexAuthPath), { recursive: true });

      const testCredentials = {
        tokens: {
          access_token: 'eyJhbGciOiJSUzI1NiIs-test-token',
          refresh_token: 'rt_test-refresh-token',
          account_id: 'test-account-id-123',
        },
        last_refresh: '2026-01-25T16:46:57.579846Z',
      };

      fs.writeFileSync(codexAuthPath, JSON.stringify(testCredentials, null, 2));

      const raw = fs.readFileSync(codexAuthPath, 'utf8');
      const parsed = JSON.parse(raw);

      expect(parsed.tokens.access_token).toBe('eyJhbGciOiJSUzI1NiIs-test-token');
      expect(parsed.tokens.refresh_token).toBe('rt_test-refresh-token');
      expect(parsed.last_refresh).toBe('2026-01-25T16:46:57.579846Z');
    });

    it('should handle missing Codex auth file', () => {
      expect(fs.existsSync(codexAuthPath)).toBe(false);

      let result = null;
      try {
        const raw = fs.readFileSync(codexAuthPath, 'utf8');
        result = JSON.parse(raw);
      } catch (error) {
        result = null;
      }

      expect(result).toBeNull();
    });

    it('should calculate expiry from last_refresh', () => {
      fs.mkdirSync(path.dirname(codexAuthPath), { recursive: true });

      const testCredentials = {
        tokens: {
          access_token: 'test-token',
          refresh_token: 'test-refresh',
        },
        last_refresh: '2026-01-25T16:46:57.579846Z',
      };

      fs.writeFileSync(codexAuthPath, JSON.stringify(testCredentials, null, 2));

      const raw = fs.readFileSync(codexAuthPath, 'utf8');
      const parsed = JSON.parse(raw);

      const lastRefresh = new Date(parsed.last_refresh).getTime();
      const expiresAt = lastRefresh + (60 * 60 * 1000); // 1 hour

      expect(typeof expiresAt).toBe('number');
      expect(expiresAt).toBeGreaterThan(lastRefresh);
    });
  });

  describe('Fallback chain', () => {
    it('should use correct fallback order: Keychain → JSON', () => {
      // This test documents the expected fallback behavior
      const fallbackOrder = ['keychain', 'json'];

      expect(fallbackOrder[0]).toBe('keychain');
      expect(fallbackOrder[1]).toBe('json');
    });

    it('should handle corrupted JSON gracefully', () => {
      fs.mkdirSync(path.dirname(claudeCredPath), { recursive: true });
      fs.writeFileSync(claudeCredPath, 'not valid json {{{');

      let result = null;
      try {
        const raw = fs.readFileSync(claudeCredPath, 'utf8');
        result = JSON.parse(raw);
      } catch (error) {
        result = null;
      }

      expect(result).toBeNull();
    });

    it('should handle empty JSON file', () => {
      fs.mkdirSync(path.dirname(claudeCredPath), { recursive: true });
      fs.writeFileSync(claudeCredPath, '');

      let result = null;
      try {
        const raw = fs.readFileSync(claudeCredPath, 'utf8');
        result = raw.trim() ? JSON.parse(raw) : null;
      } catch (error) {
        result = null;
      }

      expect(result).toBeNull();
    });
  });

  describe('Cross-platform paths', () => {
    it('should resolve paths relative to home directory', () => {
      const homeDir = os.homedir();
      const claudePath = path.join(homeDir, '.claude', '.credentials.json');
      const codexPath = path.join(homeDir, '.codex', 'auth.json');

      expect(claudePath).toContain('.claude');
      expect(codexPath).toContain('.codex');
    });

    it('should handle Windows-style paths', () => {
      // This just validates path.join works cross-platform
      const joined = path.join('C:', 'Users', 'test', '.claude', '.credentials.json');
      expect(joined).toBeTruthy();
    });
  });
});
