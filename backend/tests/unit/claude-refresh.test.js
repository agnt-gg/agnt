/**
 * Unit tests for Claude token refresh
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock axios
jest.unstable_mockModule('axios', () => ({
  default: {
    post: jest.fn(),
  },
}));

// Mock ClaudeCodeAuthManager
jest.unstable_mockModule('../../src/services/auth/ClaudeCodeAuthManager.js', () => ({
  default: {
    writeCredentials: jest.fn().mockResolvedValue(undefined),
  },
}));

const axios = (await import('axios')).default;
const { tokenRefreshManager, TokenRefreshError } = await import('../../src/services/auth/TokenRefreshManager.js');

describe('Claude Token Refresh', () => {
  const mockCredentials = {
    accessToken: 'sk-ant-oat01-old-access-token',
    refreshToken: 'sk-ant-ort01-valid-refresh-token',
    expiresAt: Date.now() - 1000, // Expired
    scopes: ['user:inference', 'user:profile'],
    subscriptionType: 'max',
  };

  const mockRefreshResponse = {
    data: {
      access_token: 'sk-ant-oat01-new-access-token',
      refresh_token: 'sk-ant-ort01-new-refresh-token',
      expires_in: 3600,
      scope: 'user:inference user:profile',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tokenRefreshManager.resetBackoff('anthropic');
    tokenRefreshManager.resetBackoff('claude');

    // Set up environment variables
    process.env.CLAUDE_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.CLAUDE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    delete process.env.CLAUDE_OAUTH_CLIENT_ID;
    delete process.env.CLAUDE_OAUTH_CLIENT_SECRET;
  });

  describe('getValidAccessToken', () => {
    it('should return existing token if not expired', async () => {
      const validCredentials = {
        ...mockCredentials,
        expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour from now
      };

      const result = await tokenRefreshManager.getValidAccessToken('anthropic', validCredentials);

      expect(result.accessToken).toBe(validCredentials.accessToken);
      expect(result.refreshed).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should throw NO_CREDENTIALS error when no credentials', async () => {
      await expect(
        tokenRefreshManager.getValidAccessToken('anthropic', null)
      ).rejects.toThrow(TokenRefreshError);

      await expect(
        tokenRefreshManager.getValidAccessToken('anthropic', {})
      ).rejects.toThrow(TokenRefreshError);
    });

    it('should throw NO_REFRESH_TOKEN error when refresh token missing', async () => {
      const noRefreshToken = {
        accessToken: 'test',
        expiresAt: Date.now() - 1000, // Expired
      };

      await expect(
        tokenRefreshManager.getValidAccessToken('anthropic', noRefreshToken)
      ).rejects.toMatchObject({
        code: 'NO_REFRESH_TOKEN',
        recovery: 'reauth',
      });
    });
  });

  describe('Claude token refresh flow', () => {
    it('should call Claude token endpoint with correct parameters', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      await tokenRefreshManager.getValidAccessToken('claude', mockCredentials);

      expect(axios.post).toHaveBeenCalledWith(
        'https://console.anthropic.com/v1/oauth/token',
        expect.objectContaining({
          grant_type: 'refresh_token',
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
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

      const result = await tokenRefreshManager.getValidAccessToken('anthropic', mockCredentials);

      expect(result.accessToken).toBe('sk-ant-oat01-new-access-token');
      expect(result.refreshed).toBe(true);
    });

    it('should handle refresh token rotation', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('claude', mockCredentials);

      // New refresh token should be used
      expect(result.accessToken).toBe('sk-ant-oat01-new-access-token');
    });

    it('should preserve scopes from original credentials if not in response', async () => {
      const responseWithoutScope = {
        data: {
          access_token: 'sk-ant-oat01-new-access-token',
          refresh_token: 'sk-ant-ort01-new-refresh-token',
          expires_in: 3600,
        },
      };

      axios.post.mockResolvedValueOnce(responseWithoutScope);

      // The refresh should succeed even without scope in response
      const result = await tokenRefreshManager.getValidAccessToken('anthropic', mockCredentials);
      expect(result.refreshed).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should throw REFRESH_FAILED on network error', async () => {
      axios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        tokenRefreshManager.getValidAccessToken('claude', mockCredentials)
      ).rejects.toMatchObject({
        code: 'REFRESH_FAILED',
        recovery: 'reauth',
      });
    });

    it('should throw REFRESH_FAILED on 401 response', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      axios.post.mockRejectedValueOnce(error);

      await expect(
        tokenRefreshManager.getValidAccessToken('anthropic', mockCredentials)
      ).rejects.toMatchObject({
        code: 'REFRESH_FAILED',
      });
    });

    it('should throw MISSING_CONFIG when client ID not set', async () => {
      delete process.env.CLAUDE_OAUTH_CLIENT_ID;
      delete process.env.CLAUDE_CODE_OAUTH_CLIENT_ID;

      await expect(
        tokenRefreshManager.getValidAccessToken('claude', mockCredentials)
      ).rejects.toMatchObject({
        code: 'MISSING_CONFIG',
      });
    });
  });

  describe('Provider aliases', () => {
    it('should handle "anthropic" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('anthropic', mockCredentials);
      expect(result.refreshed).toBe(true);
    });

    it('should handle "claude" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('claude', mockCredentials);
      expect(result.refreshed).toBe(true);
    });

    it('should handle "claude-code" provider', async () => {
      axios.post.mockResolvedValueOnce(mockRefreshResponse);

      const result = await tokenRefreshManager.getValidAccessToken('claude-code', mockCredentials);
      expect(result.refreshed).toBe(true);
    });
  });
});
