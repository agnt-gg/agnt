// A plugin's own sign-in connects through this install's /api/providers/:id/auth/*
// routes, whichever screen starts it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import providerAuthService from '@/services/providerAuthService.js';
import {
  isPluginSignIn,
  findPluginSignIn,
  connectPluginSignIn,
  savePluginApiKey,
  disconnectPluginSignIn,
  modalSignInUi,
} from './pluginSignIn.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: { connect: vi.fn(), disconnect: vi.fn(), startPluginOAuth: vi.fn(), pollPluginOAuthStatus: vi.fn() },
}));

const PIPEDRIVE = { id: 'pipedrive', name: 'Pipedrive', connectionType: 'apikey', keyLabel: 'API token', instructions: '<img src=x onerror=alert(1)>', pluginProvided: true };
const DOCUSIGN = { id: 'docusign-esign', name: 'DocuSign', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: true, redirectUri: 'http://localhost:3333/api/providers/docusign-esign/auth/plugin-oauth/callback' };
const REMOTE_SLACK = { id: 'slack', name: 'Slack', connectionType: 'oauth' };

function fakeUi(answers = []) {
  const calls = [];
  const queue = [...answers];
  return {
    calls,
    prompt: vi.fn(async (opts) => { calls.push(['prompt', opts]); return queue.shift() ?? null; }),
    confirm: vi.fn(async (opts) => { calls.push(['confirm', opts]); return queue.shift() ?? null; }),
    done: vi.fn(async (title, message) => { calls.push(['done', title, message]); }),
    error: vi.fn(async (title, message) => { calls.push(['error', title, message]); }),
    refresh: vi.fn(async () => { calls.push(['refresh']); }),
  };
}

let open;
beforeEach(() => {
  vi.clearAllMocks();
  open = vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => open.mockRestore());

describe('which rows are plugin sign-ins', () => {
  it('is decided by the plugin flag the merged provider list carries', () => {
    expect(isPluginSignIn(PIPEDRIVE)).toBe(true);
    expect(isPluginSignIn(REMOTE_SLACK)).toBe(false);
    expect(isPluginSignIn({ ...REMOTE_SLACK, pluginProvided: 'yes' })).toBe(false);
    expect(isPluginSignIn(null)).toBe(false);
  });

  it('finds one by id in a provider list, ignoring case, and never a remote row', () => {
    const list = [REMOTE_SLACK, DOCUSIGN];
    expect(findPluginSignIn(list, 'DocuSign-ESign')).toBe(DOCUSIGN);
    expect(findPluginSignIn(list, 'slack')).toBeNull();
    expect(findPluginSignIn(undefined, 'docusign-esign')).toBeNull();
  });
});

describe('API-key plugin sign-ins', () => {
  it('asks once with the plugin\'s escaped instructions, saves locally, refreshes, then reports', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true });
    const ui = fakeUi(['pd-token']);
    await expect(connectPluginSignIn(PIPEDRIVE, ui)).resolves.toBe(true);
    const [, prompt] = ui.calls[0];
    expect(prompt).toMatchObject({ title: 'Connect Pipedrive', confirmText: 'Connect', secret: true });
    expect(prompt.message).toContain('API token');
    expect(prompt.message).not.toContain('<img');
    expect(prompt.message).toContain('&lt;img');
    expect(providerAuthService.connect).toHaveBeenCalledWith('pipedrive', { apiKey: 'pd-token' });
    expect(ui.calls.slice(1).map((c) => c[0])).toEqual(['refresh', 'done']);
  });

  it('does nothing when the prompt is cancelled', async () => {
    const ui = fakeUi([null]);
    await expect(connectPluginSignIn(PIPEDRIVE, ui)).resolves.toBe(false);
    expect(providerAuthService.connect).not.toHaveBeenCalled();
    expect(ui.done).not.toHaveBeenCalled();
  });

  it('reports the backend\'s reason when the key is refused', async () => {
    providerAuthService.connect.mockResolvedValue({ success: false, error: 'Key rejected' });
    const ui = fakeUi(['bad']);
    await expect(connectPluginSignIn(PIPEDRIVE, ui)).resolves.toBe(false);
    expect(ui.error).toHaveBeenCalledWith('Connection Failed', 'Key rejected');
    expect(ui.done).not.toHaveBeenCalled();
  });

  it('savePluginApiKey throws instead of pretending', async () => {
    providerAuthService.connect.mockResolvedValue({ success: false });
    await expect(savePluginApiKey('pipedrive', 'k')).rejects.toThrow('Failed to save');
  });
});

describe('OAuth plugin sign-ins', () => {
  it('collects the client ID against the redirect URI, signs in through this install and polls to success', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://account.docusign.com/oauth/auth?x=1', sessionId: 's1' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValueOnce({ status: 'success' });
    const ui = fakeUi(['integration-key', '', true]);
    await expect(connectPluginSignIn(DOCUSIGN, ui)).resolves.toBe(true);
    expect(ui.calls[0][1].message).toContain(DOCUSIGN.redirectUri);
    expect(ui.calls[1][1]).toMatchObject({ secret: true });
    // An empty secret is a public client: nothing is sent for it.
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('docusign-esign', { clientId: 'integration-key', clientSecret: undefined });
    expect(open).toHaveBeenCalledWith('https://account.docusign.com/oauth/auth?x=1', '_blank', 'noopener');
    expect(providerAuthService.pollPluginOAuthStatus).toHaveBeenCalledWith('docusign-esign', 's1');
    expect(ui.done).toHaveBeenCalledWith('Connected', 'DocuSign is connected.');
  });

  it('skips the client prompts when the manifest carries a public client', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://idp/auth', sessionId: 's2' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValueOnce({ status: 'success' });
    const ui = fakeUi([true]);
    await connectPluginSignIn({ ...DOCUSIGN, needsClientCredentials: false }, ui);
    expect(ui.prompt).not.toHaveBeenCalled();
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('docusign-esign', {});
  });

  it('stops before signing in when the client ID prompt is cancelled', async () => {
    const ui = fakeUi([null]);
    await expect(connectPluginSignIn(DOCUSIGN, ui)).resolves.toBe(false);
    expect(providerAuthService.startPluginOAuth).not.toHaveBeenCalled();
  });

  it('reports a failed sign-in and the backend\'s reason for a refused start', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValueOnce({ authUrl: 'https://idp/auth', sessionId: 's3' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValueOnce({ status: 'error', error: 'access_denied' });
    const denied = fakeUi(['cid', '', true]);
    await expect(connectPluginSignIn(DOCUSIGN, denied)).resolves.toBe(false);
    expect(denied.error).toHaveBeenCalledWith('Connection Failed', 'access_denied');

    providerAuthService.startPluginOAuth.mockRejectedValueOnce({ response: { data: { error: 'DocuSign needs an OAuth client ID' } } });
    const refused = fakeUi(['cid', '']);
    await expect(connectPluginSignIn(DOCUSIGN, refused)).resolves.toBe(false);
    expect(refused.error).toHaveBeenCalledWith('Connection Failed', 'DocuSign needs an OAuth client ID');
  });
});

describe('the rest', () => {
  it('says so for a sign-in type it cannot start', async () => {
    const ui = fakeUi();
    await expect(connectPluginSignIn({ id: 'x', name: 'X', connectionType: 'smoke-signal', pluginProvided: true }, ui)).resolves.toBe(false);
    expect(ui.error).toHaveBeenCalled();
  });

  it('disconnects locally and throws when the backend refuses', async () => {
    providerAuthService.disconnect.mockResolvedValueOnce({ success: true });
    await expect(disconnectPluginSignIn('pipedrive')).resolves.toEqual({ success: true });
    expect(providerAuthService.disconnect).toHaveBeenCalledWith('pipedrive');
    providerAuthService.disconnect.mockResolvedValueOnce({ success: false, error: 'Not connected' });
    await expect(disconnectPluginSignIn('pipedrive')).rejects.toThrow('Not connected');
  });

  it('modalSignInUi maps onto SimpleModal: a cancelled prompt is null, a secret is a password field', async () => {
    const showModal = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('').mockResolvedValueOnce(true);
    const ui = modalSignInUi({ value: { showModal } }, vi.fn());
    await expect(ui.prompt({ title: 't', message: 'm', secret: true })).resolves.toBeNull();
    expect(showModal.mock.calls[0][0]).toMatchObject({ isPrompt: true, inputType: 'password' });
    await expect(ui.prompt({ title: 't', message: 'm' })).resolves.toBe('');
    await expect(ui.confirm({ title: 't', message: 'm' })).resolves.toBe(true);
  });
});
