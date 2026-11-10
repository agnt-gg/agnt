// The in-place sign-in every Focused page shares (Plugins, Connection, Market,
// Team) runs a plugin's own sign-in in this install, never through the remote.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import providerAuthService from '@/services/providerAuthService.js';
import { useAppSignIn } from './useAppSignIn.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    startPluginOAuth: vi.fn(),
    pollPluginOAuthStatus: vi.fn(),
    completeRemoteOAuthCallback: vi.fn(),
  },
}));

const PROVIDERS = [
  { id: 'docusign-esign', name: 'DocuSign', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: true, redirectUri: 'http://localhost:3333/cb' },
  { id: 'pipedrive', name: 'Pipedrive', connectionType: 'apikey', pluginProvided: true },
  { id: 'notion', name: 'Notion', connectionType: 'apikey' },
];
const card = (providerId, connectionType) => ({ providerId, name: providerId, connectionType });

let wrapper;
let store;
let nav;
let api;
function setup() {
  store = createStore({ modules: { appAuth: { namespaced: true, state: () => ({ allProviders: PROVIDERS }) } } });
  vi.spyOn(store, 'dispatch').mockResolvedValue(undefined);
  nav = { prompt: vi.fn(), confirm: vi.fn(), toast: vi.fn(), studio: vi.fn(), ask: vi.fn() };
  wrapper = mount(defineComponent({ setup() { api = useAppSignIn({ store, nav, findCard: () => null }); return () => h('div'); } }));
}
const remoteCalls = () => store.dispatch.mock.calls.map((c) => c[0]).filter((a) => ['appAuth/requestOAuthUrl', 'appAuth/saveApiKey', 'appAuth/disconnectApp'].includes(a));

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); setup(); });
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('useAppSignIn: a plugin\'s own sign-in', () => {
  it('signIn and signInWithPopup run the plugin OAuth in this install', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://account.docusign.com/oauth/auth', sessionId: 's1' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValue({ status: 'success' });
    nav.prompt.mockResolvedValueOnce('integration-key').mockResolvedValueOnce('');
    nav.confirm.mockResolvedValue(true);
    await expect(api.signIn(card('docusign-esign', 'oauth'))).resolves.toBe(true);
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('docusign-esign', { clientId: 'integration-key', clientSecret: undefined });
    expect(nav.toast).toHaveBeenCalledWith('DocuSign is connected.');

    nav.prompt.mockResolvedValueOnce('integration-key').mockResolvedValueOnce('');
    await expect(api.signInWithPopup(card('docusign-esign', 'oauth'))).resolves.toBe(true);
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledTimes(2);
    expect(remoteCalls()).toEqual([]);
  });

  it('promptForKey and saveKey save a plugin key locally', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true });
    nav.prompt.mockResolvedValueOnce('pd-token');
    await expect(api.promptForKey(card('pipedrive', 'apikey'))).resolves.toBe(true);
    await expect(api.saveKey(card('pipedrive', 'apikey'), '  pd-2  ')).resolves.toBe(true);
    expect(providerAuthService.connect.mock.calls).toEqual([['pipedrive', { apiKey: 'pd-token' }], ['pipedrive', { apiKey: 'pd-2' }]]);
    expect(remoteCalls()).toEqual([]);
  });

  it('disconnect disconnects a plugin sign-in locally', async () => {
    providerAuthService.disconnect.mockResolvedValue({ success: true });
    nav.confirm.mockResolvedValue(true);
    await expect(api.disconnect(card('pipedrive', 'apikey'))).resolves.toBe(true);
    expect(providerAuthService.disconnect).toHaveBeenCalledWith('pipedrive');
    expect(remoteCalls()).toEqual([]);
  });

  it('a failed plugin sign-in is reported, not swallowed', async () => {
    providerAuthService.connect.mockResolvedValue({ success: false, error: 'Key rejected' });
    nav.prompt.mockResolvedValueOnce('bad');
    await expect(api.promptForKey(card('pipedrive', 'apikey'))).resolves.toBe(false);
    expect(api.error.value).toBe('Key rejected');
    expect(nav.toast).toHaveBeenCalledWith('Key rejected');
  });

  it('a remote app keeps the remote flow', async () => {
    await api.saveKey(card('notion', 'apikey'), 'k');
    expect(store.dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'k' });
    expect(providerAuthService.connect).not.toHaveBeenCalled();
  });
});
