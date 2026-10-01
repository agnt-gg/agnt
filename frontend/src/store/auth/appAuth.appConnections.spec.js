// The app-connection actions Connectors and Focused share: one network path
// for OAuth start, API-key save and disconnect.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_utils/encryption.js', () => ({ encrypt: (s) => `enc(${s})` }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://local/api', REMOTE_URL: 'https://remote/api' } }));
import appAuth from './appAuth.js';

const { requestOAuthUrl, saveApiKey, disconnectApp, refreshAfterConnect } = appAuth.actions;
const ok = (body) => ({ ok: true, json: async () => body });

describe('appAuth app connections', () => {
  let dispatch;
  beforeEach(() => {
    dispatch = vi.fn(() => Promise.resolve());
    localStorage.setItem('token', 'tok');
    global.fetch = vi.fn();
  });

  it('requestOAuthUrl asks the remote for this app, with the page origin, and returns the URL', async () => {
    fetch.mockResolvedValueOnce(ok({ authUrl: 'https://idp/consent' }));
    await expect(requestOAuthUrl({ dispatch }, 'google drive')).resolves.toBe('https://idp/consent');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://remote/api/auth/connect/google%20drive?origin=${encodeURIComponent(window.location.origin)}`);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('requestOAuthUrl fails loudly without a URL', async () => {
    fetch.mockResolvedValueOnce(ok({}));
    await expect(requestOAuthUrl({ dispatch }, 'x')).rejects.toThrow('No authUrl');
    fetch.mockResolvedValueOnce({ ok: false, status: 502 });
    await expect(requestOAuthUrl({ dispatch }, 'x')).rejects.toThrow('502');
  });

  it('saveApiKey sends the key encrypted, never in the clear, then refreshes', async () => {
    fetch.mockResolvedValueOnce(ok({ success: true }));
    await saveApiKey({ dispatch }, { providerId: 'openai', apiKey: 'sk-secret' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://remote/api/auth/apikeys/openai');
    expect(init.body).toBe(JSON.stringify({ apiKey: 'enc(sk-secret)' }));
    expect(init.body).not.toContain('"sk-secret"');
    expect(dispatch).toHaveBeenCalledWith('fetchConnectedApps', { forceRefresh: true });
  });

  it('saveApiKey surfaces the server message when it refuses', async () => {
    fetch.mockResolvedValueOnce(ok({ success: false, message: 'Invalid key' }));
    await expect(saveApiKey({ dispatch }, { providerId: 'openai', apiKey: 'x' })).rejects.toThrow('Invalid key');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('disconnectApp posts the disconnect and refreshes both lists', async () => {
    fetch.mockResolvedValueOnce(ok({ success: true }));
    await disconnectApp({ dispatch }, 'slack');
    expect(fetch.mock.calls[0][0]).toBe('https://remote/api/auth/disconnect/slack');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(dispatch).toHaveBeenCalledWith('fetchConnectedApps', { forceRefresh: true });
    expect(dispatch).toHaveBeenCalledWith('fetchAllProviders');
  });

  it('disconnectApp does not pretend it worked', async () => {
    fetch.mockResolvedValueOnce(ok({ success: false }));
    await expect(disconnectApp({ dispatch }, 'slack')).rejects.toThrow('Disconnection failed');
  });

  it('refreshAfterConnect re-reads connections and the catalogue', async () => {
    await refreshAfterConnect({ dispatch });
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(['fetchConnectedApps', 'fetchAllProviders']);
  });
});
