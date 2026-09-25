// Connections declared by plugin manifests (`auth`): they are connected through
// this install's /api/providers/:id/auth/* routes, and a provider the remote
// catalogue already defines keeps its remote flow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { useProviderConnection } from './useProviderConnection.js';
import providerAuthService from '@/services/providerAuthService.js';
import { mergePluginProviders } from '@/store/auth/appAuth.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    getCapabilities: vi.fn(),
    connect: vi.fn(),
    listPluginProviders: vi.fn(),
    startPluginOAuth: vi.fn(),
    pollPluginOAuthStatus: vi.fn(),
    completeRemoteOAuthCallback: vi.fn(),
  },
}));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api', REMOTE_URL: 'https://api.agnt.gg' } }));

const PIPEDRIVE = { id: 'pipedrive', name: 'Pipedrive', connectionType: 'apikey', keyLabel: 'API token', instructions: '<img src=x onerror=alert(1)>', pluginProvided: true };
const GA4 = { id: 'ga4', name: 'Google Analytics', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: true, redirectUri: 'http://localhost:3333/cb' };
const REMOTE_ASANA = { id: 'asana', name: 'Asana', connectionType: 'apikey' };

function setup(allProviders) {
  const showModal = vi.fn();
  let api;
  const store = createStore({
    modules: {
      appAuth: {
        namespaced: true,
        state: () => ({ allProviders, connectedApps: [] }),
        actions: { fetchAllProviders: vi.fn(), fetchConnectedApps: vi.fn(), checkConnectionHealthStream: vi.fn(), checkConnectionHealth: vi.fn() },
      },
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useProviderConnection(ref({ showModal }));
        return () => h('div');
      },
    }),
    { global: { plugins: [store] } }
  );
  return { wrapper, showModal, toggle: (id) => api.handleProviderToggle(id) };
}

let mounted;
beforeEach(() => vi.clearAllMocks());
afterEach(() => mounted?.unmount());

describe('plugin-declared connections', () => {
  it('saves an API key locally and escapes the plugin author\'s instructions', async () => {
    providerAuthService.getCapabilities.mockResolvedValue({ plugin: true, capabilities: ['status', 'connect-apikey', 'disconnect'] });
    providerAuthService.connect.mockResolvedValue({ success: true });
    const { wrapper, showModal, toggle } = setup([PIPEDRIVE]);
    mounted = wrapper;
    showModal.mockResolvedValueOnce('pd-token').mockResolvedValue(true);
    await toggle('pipedrive');
    await flushPromises();

    const prompt = showModal.mock.calls[0][0];
    expect(prompt).toMatchObject({ isPrompt: true, inputType: 'password' });
    expect(prompt.message).toContain('API token');
    expect(prompt.message).not.toContain('<img');
    expect(prompt.message).toContain('&lt;img');
    expect(providerAuthService.connect).toHaveBeenCalledWith('pipedrive', { apiKey: 'pd-token' });
  });

  it('keeps the remote flow for an id the remote catalogue defines', async () => {
    providerAuthService.getCapabilities.mockResolvedValue({ plugin: true, capabilities: ['status', 'connect-apikey', 'disconnect'] });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const { wrapper, showModal, toggle } = setup([REMOTE_ASANA]);
    mounted = wrapper;
    showModal.mockResolvedValueOnce('asana-key').mockResolvedValue(true);
    await toggle('asana');
    await flushPromises();
    expect(providerAuthService.connect).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('https://api.agnt.gg/auth/apikeys/asana', expect.objectContaining({ method: 'POST' }));
  });

  it('collects client credentials, then signs in and polls to success', async () => {
    providerAuthService.getCapabilities.mockResolvedValue({ plugin: true, capabilities: ['status', 'oauth-plugin', 'disconnect'] });
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://accounts.example/auth', sessionId: 's1' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValueOnce({ status: 'success' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { wrapper, showModal, toggle } = setup([GA4]);
    mounted = wrapper;
    showModal.mockResolvedValueOnce('client-id').mockResolvedValueOnce('client-secret').mockResolvedValue(true);
    await toggle('ga4');
    await flushPromises();

    expect(showModal.mock.calls[0][0].message).toContain('http://localhost:3333/cb');
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('ga4', { clientId: 'client-id', clientSecret: 'client-secret' });
    expect(open).toHaveBeenCalledWith('https://accounts.example/auth', '_blank', 'noopener');
    expect(providerAuthService.pollPluginOAuthStatus).toHaveBeenCalledWith('ga4', 's1');
    expect(showModal.mock.calls.at(-1)[0]).toMatchObject({ title: 'Connected' });
    open.mockRestore();
  });

  it('stops without starting sign-in when the client ID prompt is cancelled', async () => {
    providerAuthService.getCapabilities.mockResolvedValue({ plugin: true, capabilities: ['status', 'oauth-plugin', 'disconnect'] });
    const { wrapper, showModal, toggle } = setup([GA4]);
    mounted = wrapper;
    showModal.mockResolvedValueOnce(null);
    await toggle('ga4');
    expect(providerAuthService.startPluginOAuth).not.toHaveBeenCalled();
  });
});

describe('mergePluginProviders', () => {
  it('appends plugin connections without overriding a provider already listed', async () => {
    providerAuthService.listPluginProviders.mockResolvedValue({ providers: [{ ...PIPEDRIVE }, { id: 'asana', name: 'Asana (plugin)' }] });
    const merged = await mergePluginProviders([REMOTE_ASANA]);
    expect(merged.map((p) => p.name)).toEqual(['Asana', 'Pipedrive']);
  });

  it('returns the list it was given when the plugin lookup fails', async () => {
    providerAuthService.listPluginProviders.mockRejectedValue(new Error('404'));
    expect(await mergePluginProviders([REMOTE_ASANA])).toEqual([REMOTE_ASANA]);
  });
});
