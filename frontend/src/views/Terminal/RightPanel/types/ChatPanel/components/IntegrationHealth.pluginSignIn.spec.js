// The connection-health panel's Reconnect and Disconnect run a plugin's own
// sign-in in this install, never through the remote.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import providerAuthService from '@/services/providerAuthService.js';
import IntegrationHealth from './IntegrationHealth.vue';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    startPluginOAuth: vi.fn(),
    pollPluginOAuthStatus: vi.fn(),
    listPluginProviders: vi.fn(),
    completeRemoteOAuthCallback: vi.fn(),
  },
}));

const GA4 = { id: 'ga4', name: 'Google Analytics', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: false };
const TWILIO = { id: 'twilio', name: 'Twilio', connectionType: 'apikey', pluginProvided: true };

let wrapper;
let store;
let showModal;
function mountPanel(allProviders) {
  store = createStore({ modules: { appAuth: {
    namespaced: true,
    state: () => ({ allProviders, connectedApps: [], connectionHealth: null }),
    getters: {
      isHealthCheckLoading: () => false,
      connectionHealthStatus: () => 'degraded',
      healthyConnectionsCount: () => 0,
      totalConnectionsCount: () => 0,
      needsHealthCheck: () => false,
    },
  } } });
  vi.spyOn(store, 'dispatch').mockResolvedValue(undefined);
  wrapper = shallowMount(IntegrationHealth, { global: { plugins: [store], directives: { tooltip: {} } } });
  showModal = vi.fn();
  wrapper.vm.modal = { showModal };
}
const remoteCalls = () => store.dispatch.mock.calls.map((c) => c[0]).filter((a) => ['appAuth/requestOAuthUrl', 'appAuth/saveApiKey', 'appAuth/disconnectApp'].includes(a));

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('IntegrationHealth: a plugin\'s own sign-in', () => {
  it('Reconnect on a failing plugin OAuth connection signs in through this install', async () => {
    providerAuthService.startPluginOAuth.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', sessionId: 's1' });
    providerAuthService.pollPluginOAuthStatus.mockResolvedValue({ status: 'success' });
    mountPanel([GA4]); await flushPromises();
    showModal.mockResolvedValue(true);
    await wrapper.vm.handleIntegrationClick({ provider: 'ga4', statusClass: 'error' });
    await flushPromises();
    expect(providerAuthService.startPluginOAuth).toHaveBeenCalledWith('ga4', {});
    expect(remoteCalls()).toEqual([]);
  });

  it('saves a plugin API key locally and disconnects a healthy plugin connection locally', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true });
    providerAuthService.disconnect.mockResolvedValue({ success: true });
    mountPanel([TWILIO]); await flushPromises();
    showModal.mockResolvedValueOnce('tw-key').mockResolvedValue(true);
    await wrapper.vm.handleIntegrationClick({ provider: 'twilio', statusClass: 'error' });
    await flushPromises();
    expect(providerAuthService.connect).toHaveBeenCalledWith('twilio', { apiKey: 'tw-key' });

    await wrapper.vm.handleIntegrationClick({ provider: 'twilio', statusClass: 'healthy' });
    await flushPromises();
    expect(providerAuthService.disconnect).toHaveBeenCalledWith('twilio');
    expect(remoteCalls()).toEqual([]);
  });

  it('finds a plugin sign-in the store has not listed yet, instead of "Could not load provider details"', async () => {
    providerAuthService.listPluginProviders.mockResolvedValue({ providers: [TWILIO] });
    providerAuthService.connect.mockResolvedValue({ success: true });
    localStorage.removeItem('token');
    mountPanel([]); await flushPromises();
    showModal.mockResolvedValueOnce('tw-key').mockResolvedValue(true);
    await wrapper.vm.handleIntegrationClick({ provider: 'twilio', statusClass: 'error' });
    await flushPromises();
    expect(providerAuthService.connect).toHaveBeenCalledWith('twilio', { apiKey: 'tw-key' });
  });
});
