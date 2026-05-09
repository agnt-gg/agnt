import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    BASE_URL: 'http://localhost:3333/api',
    REMOTE_URL: 'https://api.agnt.gg',
  },
}));

// Imported after mocks so the SUT picks them up.
let providerAuthService;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const localStorageMock = {
    getItem: vi.fn(() => 'test-jwt'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });

  providerAuthService = (await import('./providerAuthService.js')).default;
});

describe('providerAuthService.completeRemoteOAuthCallback', () => {
  it('POSTs to /auth/callback on REMOTE_URL with the bearer token, code, and state', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true, provider: 'twitter' } });

    const result = await providerAuthService.completeRemoteOAuthCallback({
      code: 'abc123',
      state: 'twitter:http://localhost:3333',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.agnt.gg/auth/callback',
      { code: 'abc123', state: 'twitter:http://localhost:3333' },
      {
        headers: {
          Authorization: 'Bearer test-jwt',
          'Content-Type': 'application/json',
        },
      },
    );
    expect(result).toEqual({ success: true, provider: 'twitter' });
  });

  it('rejects when code is missing without making any HTTP call', async () => {
    await expect(
      providerAuthService.completeRemoteOAuthCallback({ code: '', state: 'twitter:x' }),
    ).rejects.toThrow('Missing code or state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rejects when state is missing without making any HTTP call', async () => {
    await expect(
      providerAuthService.completeRemoteOAuthCallback({ code: 'abc', state: '' }),
    ).rejects.toThrow('Missing code or state');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('dedupes concurrent calls with the same code: only one POST is sent', async () => {
    let resolvePost;
    axios.post.mockReturnValueOnce(
      new Promise((res) => {
        resolvePost = () => res({ data: { success: true } });
      }),
    );

    const a = providerAuthService.completeRemoteOAuthCallback({
      code: 'same-code',
      state: 'twitter:x',
    });
    const b = providerAuthService.completeRemoteOAuthCallback({
      code: 'same-code',
      state: 'twitter:x',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);

    resolvePost();
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toEqual({ success: true });
    expect(resB).toEqual({ success: true });
  });

  it('treats different codes as independent requests', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { success: true, provider: 'twitter' } })
      .mockResolvedValueOnce({ data: { success: true, provider: 'github' } });

    await Promise.all([
      providerAuthService.completeRemoteOAuthCallback({ code: 'code-1', state: 'twitter:x' }),
      providerAuthService.completeRemoteOAuthCallback({ code: 'code-2', state: 'github:x' }),
    ]);

    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('propagates server errors to the caller', async () => {
    axios.post.mockRejectedValueOnce(new Error('Request failed with status code 400'));

    await expect(
      providerAuthService.completeRemoteOAuthCallback({ code: 'bad', state: 'twitter:x' }),
    ).rejects.toThrow('Request failed with status code 400');
  });
});
