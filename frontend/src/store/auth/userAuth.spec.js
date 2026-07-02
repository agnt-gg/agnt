import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios');

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    BASE_URL: 'http://127.0.0.1:3333/api',
    REMOTE_URL: 'https://api.agnt.gg',
  },
}));

vi.mock('@/services/LicenseValidator.js', () => ({
  default: {},
}));

function makeJwt(payload) {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `header.${encodedPayload}.signature`;
}

async function loadModule() {
  vi.resetModules();
  return (await import('./userAuth.js')).default;
}

function makeCtx(token) {
  return {
    state: { token },
    commit: vi.fn(),
    dispatch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('userAuth local test auth routing', () => {
  it('checks local auth status for local-test tokens', async () => {
    const module = await loadModule();
    const token = makeJwt({ auth_type: 'local-test', email: 'perf@local.test' });
    const ctx = makeCtx(token);
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        isAuthenticated: true,
        user: { id: 'local-user', email: 'perf@local.test' },
      },
    });

    await module.actions.fetchUserData(ctx, { forceRefresh: true });

    expect(axios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:3333/api/users/auth/status',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(ctx.commit).toHaveBeenCalledWith('SET_USER', { id: 'local-user', email: 'perf@local.test' });
    expect(ctx.commit).toHaveBeenCalledWith('CLEAR_AUTH_FAILURE');
  });

  it('keeps remote auth status for ordinary tokens', async () => {
    const module = await loadModule();
    const token = makeJwt({ email: 'user@example.com' });
    const ctx = makeCtx(token);
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        isAuthenticated: true,
        user: { id: 'remote-user', email: 'user@example.com' },
      },
    });

    await module.actions.fetchUserData(ctx, { forceRefresh: true });

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.agnt.gg/users/auth/status',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  });
});
