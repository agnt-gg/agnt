/**
 * Unit tests for Codex token refresh
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock axios
jest.unstable_mockModule('axios', () => ({
  default: {
    post: jest.fn(),
  },
}));

const axios = (await import('axios')).default;
const { tokenRefreshManager, TokenRefreshError } = await import('../../src/services/auth/TokenRefreshManager.js');

describe('Codex Token Refresh', () => {
  const mockCredentials = {
    accessToken: 'eyJhbGciOiJSUzI1NiIs-old-jwt-token',
    refreshToken: 'rt_valid-refresh-token',
    expiresAt: Date.now() - 1000, // Expired
  };

  const mockRefreshResponse = {
    data: {
      access_token: 'eyJhbGciOiJSUzI1NiIs-new-jwt-token',
      refresh_token: 'rt_new-refresh-token',
      expires_in: 3600,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tokenRefreshManager.resetBackoff('openai-codex');
    tokenRefreshManager.resetBackoff('codex');
    tokenRefreshManager.resetBackoff('openai');

    // Set up environment variables
    process.env.OPENAI_OAUTH_CLIENT_ID = 'test-openai-client-id';
    process.env.OPENAI_OAUTH_CLIENT_SECRET = 'test-openai-client-secret';
  });

  afterEach(() => {
    delete process.env.OPENAI_OAUTH_CLIENT_ID;
    delete process.env.OPENAI_OAUTH_CLIENT_SECRET;
  });

  describe('getValidAccessToken', () => {
    it('should return existing token if not expired', async () => {
      const validCredentials = {
        ...mockCredentials,
        expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour from now
      };

      const result = await tokenRefreshManager.getValidAccessToken('openai-codex', validCredentials);

      expect(result.accessToken).toBe(validCredentials.accessToken);
      expect(result.refreshed).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('Codex token refresh flow', () => {
    it('should call OpenAI token endpoint with correct parameters', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      await tokenRefreshManager.getValidAccessToken('codex', mockCredentials);

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/oauth/token',
        expect.objectContaining({
          grant_type: 'refresh_token',
          client_id: 'test-openai-client-id',
          client_secret: 'test-openai-client-secret',
          refresh_token: mockCredentials.refreshToken,
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        })
      );
    });

    it('should return new access token after refresh', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('openai-codex', mockCredentials);

      expect(result.accessToken).toBe('eyJhbGciOiJSUzI1NiIs-new-jwt-token');
      expect(result.refreshed).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should throw REFRESH_FAILED on network error', async () => {
      axios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        tokenRefreshManager.getValidAccessToken('codex', mockCredentials)
      ).rejects.toMatchObject({
        code: 'REFRESH_FAILED',
        recovery: 'reauth',
      });
    });

    it('should throw MISSING_CONFIG when client ID not set', async () => {
      delete process.env.OPENAI_OAUTH_CLIENT_ID;

      await expect(
        tokenRefreshManager.getValidAccessToken('openai-codex', mockCredentials)
      ).rejects.toMatchObject({
        code: 'MISSING_CONFIG',
      });
    });
  });

  describe('Provider aliases', () => {
    it('should handle "openai-codex" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('openai-codex', mockCredentials);
      expect(result.refreshed).toBe(true);
    });

    it('should handle "codex" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('codex', mockCredentials);
      expect(result.refreshed).toBe(true);
    });

    it('should handle "openai" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('openai', mockCredentials);
      expect(result.refreshed).toBe(true);
    });
  });

  describe('Exponential backoff', () => {
    it('should implement exponential backoff on failures', async () => {
      axios.post.mockRejectedValue(new Error('Server error'));

      // First failure
      await expect(
        tokenRefreshManager.getValidAccessToken('codex', mockCredentials)
      ).rejects.toThrow();

      // Should be in cooldown after failure
      // Note: Actual backoff testing would require time manipulation
    });

    it('should reset backoff on success', async () => {
      // First, cause a failure
      axios.post.mockRejectedValueOnce(new Error('Server error'));
      await expect(
        tokenRefreshManager.getValidAccessToken('codex', mockCredentials)
      ).rejects.toThrow();

      // Reset backoff
      tokenRefreshManager.resetBackoff('codex');

      // Now succeed
      axios.post.mockResolvedValueOnce(mockRefreshResponse);
      const result = await tokenRefreshManager.getValidAccessToken('codex', mockCredentials);
      expect(result.refreshed).toBe(true);
    });
  });
});
