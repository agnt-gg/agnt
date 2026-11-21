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

  it('disconnectApp disconnects a provider the local backend knows through it, and refreshes both lists', async () => {
    fetch.mockResolvedValueOnce({ ...ok({ success: true }), status: 200 });
    await disconnectApp({ dispatch }, 'gemini');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://local/api/providers/gemini/auth/disconnect');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok' } });
    expect(dispatch).toHaveBeenCalledWith('fetchConnectedApps', { forceRefresh: true });
    expect(dispatch).toHaveBeenCalledWith('fetchAllProviders');
  });

  it('disconnectApp disconnects an app the local backend does not know remotely', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ success: false }) });
    fetch.mockResolvedValueOnce({ ...ok({ success: true }), status: 200 });
    await disconnectApp({ dispatch }, 'slack');
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['http://local/api/providers/slack/auth/disconnect', 'https://remote/api/auth/disconnect/slack']);
    expect(dispatch).toHaveBeenCalledWith('fetchConnectedApps', { forceRefresh: true });
  });

  it('disconnectApp does not pretend it worked', async () => {
    fetch.mockResolvedValueOnce({ ...ok({ success: false }), status: 200 });
    await expect(disconnectApp({ dispatch }, 'gemini')).rejects.toThrow('Disconnection failed');
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'remote refused' }) });
    await expect(disconnectApp({ dispatch }, 'gemini')).rejects.toThrow('remote refused');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('saveApiKey surfaces the server\'s reason on an HTTP error, not just the status', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Unknown provider' }) });
    await expect(saveApiKey({ dispatch }, { providerId: 'openai', apiKey: 'x' })).rejects.toThrow('Unknown provider');
    fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    await expect(saveApiKey({ dispatch }, { providerId: 'openai', apiKey: 'x' })).rejects.toThrow('502');
  });

  // A plugin's own sign-in exists only in this install: the remote would answer
  // 404. The screens route it through services/pluginSignIn.js; these refuse it
  // for any screen that forgets, before a request leaves the app.
  it('refuses to send a plugin sign-in to the remote, for all three actions', async () => {
    const state = { allProviders: [{ id: 'slack', name: 'Slack' }, { id: 'docusign-esign', name: 'DocuSign', pluginProvided: true }] };
    await expect(requestOAuthUrl({ state, dispatch }, 'docusign-esign')).rejects.toThrow('DocuSign signs in through its plugin on this computer');
    await expect(saveApiKey({ state, dispatch }, { providerId: 'DocuSign-ESign', apiKey: 'k' })).rejects.toThrow('through its plugin');
    await expect(disconnectApp({ state, dispatch }, 'docusign-esign')).rejects.toThrow('through its plugin');
    expect(fetch).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();

    fetch.mockResolvedValueOnce(ok({ authUrl: 'https://slack/consent' }));
    await expect(requestOAuthUrl({ state, dispatch }, 'slack')).resolves.toBe('https://slack/consent');
  });

  it('refreshAfterConnect re-reads connections and the catalogue', async () => {
    await refreshAfterConnect({ dispatch });
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(['fetchConnectedApps', 'fetchAllProviders']);
  });
});
