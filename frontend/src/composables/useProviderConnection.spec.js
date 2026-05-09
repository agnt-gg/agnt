/**
 * Regression test for the OAuth-callback postMessage handler.
 *
 * Background: commit 8e8a2b1 ("fix(integrations): … stop OAuth double-exchange")
 * removed the code-for-token exchange from the `oauth-callback` postMessage
 * handler under the false premise that api.agnt.gg already exchanges the code
 * server-side. It does not — in the Electron path, api.agnt.gg's callback page
 * only forwards the raw `code` via postMessage, and the opener has to POST it
 * to /auth/callback to mint tokens. Removing that step silently broke every
 * remote OAuth provider (Twitter, GitHub, Slack, etc.) in Electron.
 *
 * This test pins the contract: an `oauth-callback` postMessage MUST trigger
 * providerAuthService.completeRemoteOAuthCallback with the forwarded code and
 * state. If a future change removes that call, this test fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

import { useProviderConnection } from './useProviderConnection.js';
import providerAuthService from '@/services/providerAuthService.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    completeRemoteOAuthCallback: vi.fn(),
    getCapabilities: vi.fn().mockRejectedValue(new Error('not used in this test')),
    startOAuth: vi.fn(),
    exchangeOAuth: vi.fn(),
    pollOAuthStatus: vi.fn(),
  },
}));

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    BASE_URL: 'http://localhost:3333/api',
    REMOTE_URL: 'https://api.agnt.gg',
  },
}));

const makeStore = () =>
  createStore({
    modules: {
      appAuth: {
        namespaced: true,
        state: () => ({ allProviders: [], connectedApps: [] }),
        actions: {
          fetchAllProviders: vi.fn(),
          fetchConnectedApps: vi.fn(),
          checkConnectionHealthStream: vi.fn(),
          checkConnectionHealth: vi.fn(),
        },
      },
    },
  });

// Tiny harness component so the composable's onMounted runs in a real lifecycle.
const Harness = defineComponent({
  setup() {
    const modalRef = ref({ showModal: vi.fn().mockResolvedValue(false) });
    useProviderConnection(modalRef);
    return () => h('div');
  },
});

describe('useProviderConnection — oauth-callback postMessage handler', () => {
  let wrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('exchanges the code via providerAuthService when an oauth-callback message arrives', async () => {
    providerAuthService.completeRemoteOAuthCallback.mockResolvedValueOnce({
      success: true,
      provider: 'twitter',
    });

    wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
    await flushPromises();

    // Mirror the payload api.agnt.gg posts from the Electron callback HTML.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'oauth-callback',
          code: 'twitter-auth-code-xyz',
          state: 'twitter:http://localhost:3333',
          provider: 'twitter',
        },
        // jsdom's window.location.origin is 'http://localhost' which the
        // handler accepts via its `event.origin.includes('localhost')` rule.
        origin: window.location.origin,
      }),
    );
    await flushPromises();

    expect(providerAuthService.completeRemoteOAuthCallback).toHaveBeenCalledTimes(1);
    expect(providerAuthService.completeRemoteOAuthCallback).toHaveBeenCalledWith({
      code: 'twitter-auth-code-xyz',
      state: 'twitter:http://localhost:3333',
    });
  });

  it('does not invoke the exchange for unrelated message types', async () => {
    wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'oauth_success', provider: 'twitter' },
        origin: window.location.origin,
      }),
    );
    await flushPromises();

    expect(providerAuthService.completeRemoteOAuthCallback).not.toHaveBeenCalled();
  });

  it('ignores oauth-callback messages from disallowed origins', async () => {
    wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'oauth-callback',
          code: 'should-be-ignored',
          state: 'twitter:x',
          provider: 'twitter',
        },
        origin: 'https://evil.example.com',
      }),
    );
    await flushPromises();

    expect(providerAuthService.completeRemoteOAuthCallback).not.toHaveBeenCalled();
  });
});
