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
        // Same-origin, which is an exact match against `window.location.origin`.
        // This previously carried a comment attributing the pass to the
        // handler's `event.origin.includes('localhost')` rule; that was never
        // true — the exact-match term matched first, and the test goes on
        // passing now that the substring rule is gone.
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

  /**
   * The test above passed against the vulnerable handler too: it never
   * exercised the hole. The old guard OR'd in a bare
   * `event.origin.includes('localhost')`, so it refused `evil.example.com`
   * while admitting anything whose origin merely CONTAINED that substring —
   * all of these registrable by an attacker.
   *
   * A wrong code redeemed here is grafted onto the signed-in user's account,
   * so these run through the real listener rather than the predicate alone.
   */
  /**
   * Passing the origin check says the sender is us; it says nothing about what
   * they sent. This is a global `message` listener, so same-origin senders that
   * know nothing about OAuth reach it too, and `event.data.type` on a `null`
   * payload throws.
   *
   * The rejection has to be captured explicitly. `handleOAuthMessage` is
   * `async`, so the throw never reaches `dispatchEvent` — it becomes an
   * unhandled rejection, and a test written as `expect(() =>
   * window.dispatchEvent(...)).not.toThrow()` passes whether or not the guard
   * exists. Verified before writing this: without the capture below, removing
   * the guard leaves the suite green.
   */
  // `undefined` is deliberately absent: the MessageEvent constructor
  // normalises it to `null` (verified, not assumed), so a case labelled
  // "undefined" here would silently be a second null case. Genuine `undefined`
  // is covered against the predicate directly in utils/oauthMessageOrigin.spec.js.
  it.each([
    ['null', null],
    ['a string', 'vite:beforeUpdate'],
    ['a number', 42],
  ])(
    'survives a trusted-origin message whose payload is %s',
    async (_label, data) => {
      wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
      await flushPromises();

      const rejections = [];
      const capture = (reason) => rejections.push(reason);
      process.on('unhandledRejection', capture);

      try {
        window.dispatchEvent(
          new MessageEvent('message', { data, origin: window.location.origin }),
        );
        await flushPromises();
        // An unhandled rejection is only reported once the microtask queue has
        // drained and no handler has attached, so yield to the macrotask queue.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off('unhandledRejection', capture);
      }

      expect(rejections.map(String)).toEqual([]);
      expect(providerAuthService.completeRemoteOAuthCallback).not.toHaveBeenCalled();
    },
  );

  it('still acts on a well-formed message after a malformed one', async () => {
    // The guard must skip the bad message, not wedge the listener.
    providerAuthService.completeRemoteOAuthCallback.mockResolvedValueOnce({
      success: true,
      provider: 'twitter',
    });

    wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent('message', { data: null, origin: window.location.origin }),
    );
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'oauth-callback',
          code: 'twitter-auth-code-xyz',
          state: 'twitter:x',
          provider: 'twitter',
        },
        origin: window.location.origin,
      }),
    );
    await flushPromises();

    expect(providerAuthService.completeRemoteOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://localhost.evil.com',
    'https://evil-localhost.io',
    'http://localhostage.com',
    'https://notlocalhost.xyz',
  ])('ignores oauth-callback from %s, which the substring rule admitted', async (origin) => {
    wrapper = mount(Harness, { global: { plugins: [makeStore()] } });
    await flushPromises();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'oauth-callback',
          code: 'attacker-supplied-code',
          state: 'twitter:x',
          provider: 'twitter',
        },
        origin,
      }),
    );
    await flushPromises();

    expect(providerAuthService.completeRemoteOAuthCallback).not.toHaveBeenCalled();
  });
});
