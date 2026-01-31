/**
 * Unit tests for token expiry checking
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { tokenRefreshManager } from '../../src/services/auth/TokenRefreshManager.js';

describe('Token Expiry Checking', () => {
  describe('isTokenExpired', () => {
    const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

    it('should return true when no credentials provided', () => {
      expect(tokenRefreshManager.isTokenExpired(null)).toBe(true);
      expect(tokenRefreshManager.isTokenExpired(undefined)).toBe(true);
      expect(tokenRefreshManager.isTokenExpired({})).toBe(true);
    });

    it('should return true when expiresAt is missing', () => {
      expect(tokenRefreshManager.isTokenExpired({ accessToken: 'test' })).toBe(true);
    });

    it('should return true when token is expired', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(true);
    });

    it('should return true when token expires within buffer', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() + (3 * 60 * 1000), // 3 minutes from now
      };
      // Default buffer is 5 minutes, so 3 minutes is within buffer
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(true);
    });

    it('should return false when token is valid', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour from now
      };
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(false);
    });

    it('should return false when token expires after buffer', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() + (10 * 60 * 1000), // 10 minutes from now
      };
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(false);
    });

    it('should use custom buffer when provided', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() + (3 * 60 * 1000), // 3 minutes from now
      };

      // With 2 minute buffer, 3 minutes should be valid
      expect(tokenRefreshManager.isTokenExpired(credentials, 2 * 60 * 1000)).toBe(false);

      // With 5 minute buffer, 3 minutes should be expired
      expect(tokenRefreshManager.isTokenExpired(credentials, 5 * 60 * 1000)).toBe(true);
    });

    it('should handle edge case at exact buffer boundary', () => {
      const now = Date.now();
      const credentials = {
        accessToken: 'test',
        expiresAt: now + REFRESH_BUFFER_MS,
      };

      // At exact buffer boundary, should be considered expired (>=)
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(true);
    });

    it('should handle very large expiry values', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year from now
      };
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(false);
    });

    it('should handle expiresAt as 0', () => {
      const credentials = {
        accessToken: 'test',
        expiresAt: 0,
      };
      expect(tokenRefreshManager.isTokenExpired(credentials)).toBe(true);
    });
  });

  describe('Token refresh buffer', () => {
    it('should use 5-minute buffer by default', () => {
      const exactlyAtBuffer = {
        accessToken: 'test',
        expiresAt: Date.now() + (5 * 60 * 1000),
      };

      const justAfterBuffer = {
        accessToken: 'test',
        expiresAt: Date.now() + (5 * 60 * 1000) + 1000,
      };

      expect(tokenRefreshManager.isTokenExpired(exactlyAtBuffer)).toBe(true);
      expect(tokenRefreshManager.isTokenExpired(justAfterBuffer)).toBe(false);
    });
  });
});
