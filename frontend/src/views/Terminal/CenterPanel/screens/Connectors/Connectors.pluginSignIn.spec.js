// The Connectors screen's own connect, reconnect and disconnect run a plugin's
// sign-in in this install. Before, every OAuth tile asked the remote for a URL,
// and a plugin's sign-in answered "HTTP error! status: 404".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { createStore } from 'vuex';
import providerAuthService from '@/services/providerAuthService.js';
import Connectors from './Connectors.vue';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    startPluginOAuth: vi.fn(),
    pollPluginOAuthStatus: vi.fn(),
    getCapabilities: vi.fn(),
    listPluginProviders: vi.fn(async () => ({ providers: [] })),
    completeRemoteOAuthCallback: vi.fn(),
  },
}));
const route = reactive({ query: {} });
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const DOCUSIGN = { id: 'docusign-esign', name: 'DocuSign', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: true, redirectUri: 'http://localhost:3333/cb' };
const PIPEDRIVE = { id: 'pipedrive', name: 'Pipedrive', connectionType: 'apikey', keyLabel: 'API token', pluginProvided: true };
const SLACK = { id: 'slack', name: 'Slack', connectionType: 'oauth' };

let wrapper;
let store;
let showModal;
function mountScreen(connectedApps = []) {
  store = createStore({ modules: {
    appAuth: { namespaced: true, state: () => ({ allProviders: [DOCUSIGN, PIPEDRIVE, SLACK], connectedApps, connectionHealth: null }) },
    mcpServers: { namespaced: true, state: () => ({ servers: [], loading: false }), getters: { allServers: () => [] } },
    connectors: { namespaced: true, getters: { allSecrets: () => [] } },
  } });
  vi.spyOn(store, 'dispatch').mockResolvedValue([]);
  wrapper = shallowMount(Connectors, { global: { plugins: [store], stubs: { BaseScreen: { template: '<div><slot /></div>' }, AppsSection: { template: '<div />' } } } });
  showModal = vi.fn();
  wrapper.vm.modalRef = { showModal };
  return wrapper;
}
const remoteCalls = () => store.dispatch.mock.calls.map((c) => c[0]).filter((a) => ['appAuth/requestOAuthUrl', 'appAuth/saveApiKey', 'appAuth/disconnectApp'].includes(a));

beforeEach(() => { vi.clearAllMocks(); route.query = {}; vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('Connectors: a plugin\'s own sign-in', () => {
  it('Connect on an OAuth plugin tile signs in through this install, not the remote', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://account.docusign.com/oauth/auth', sessionId: 's1' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValue({ status: 'success' });
    mountScreen(); await flushPromises();
    showModal.mockResolvedValueOnce('integration-key').mockResolvedValueOnce('').mockResolvedValue(true);
    wrapper.vm.handleOAuthAppClick(wrapper.vm.oauthProviders.find((p) => p.id === 'docusign-esign'));
    await flushPromises();
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('docusign-esign', { clientId: 'integration-key', clientSecret: undefined });
    expect(remoteCalls()).toEqual([]);
  });

  it('Reconnect does the same, and an API-key plugin tile saves its key locally', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://idp/auth', sessionId: 's2' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValue({ status: 'success' });
    providerAuthService.connect.mockResolvedValue({ success: true });
    mountScreen(['docusign-esign']); await flushPromises();
    showModal.mockResolvedValueOnce('integration-key').mockResolvedValueOnce('').mockResolvedValue(true);
    wrapper.vm.reconnectAppCard({ providerId: 'docusign-esign', name: 'DocuSign' });
    await flushPromises();
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalled();

    showModal.mockReset().mockResolvedValueOnce('pd-token').mockResolvedValue(true);
    wrapper.vm.handleOAuthAppClick(wrapper.vm.oauthProviders.find((p) => p.id === 'pipedrive'));
    await flushPromises();
    expect(providerAuthService.connect).toHaveBeenCalledWith('pipedrive', { apiKey: 'pd-token' });
    expect(remoteCalls()).toEqual([]);
  });

  it('Disconnect on a connected plugin tile disconnects it in this install', async () => {
    providerAuthService.disconnect.mockResolvedValue({ success: true });
    mountScreen(['docusign-esign']); await flushPromises();
    showModal.mockResolvedValue(true);
    wrapper.vm.handleOAuthAppClick(wrapper.vm.oauthProviders.find((p) => p.id === 'docusign-esign'));
    await flushPromises();
    expect(providerAuthService.disconnect).toHaveBeenCalledWith('docusign-esign');
    expect(remoteCalls()).toEqual([]);
  });

  it('a remote tile keeps the remote flow', async () => {
    mountScreen(); await flushPromises();
    wrapper.vm.handleOAuthAppClick(wrapper.vm.oauthProviders.find((p) => p.id === 'slack'));
    await flushPromises();
    expect(store.dispatch).toHaveBeenCalledWith('appAuth/requestOAuthUrl', 'slack');
    expect(providerAuthService.startPluginOAuth).not.toHaveBeenCalled();
  });
});
