/**
 * Connector-only keys must not be posted to the remote key store — on ANY
 * surface.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The app has two api-key save paths. Connectors.vue has one; this composable
 * has another, used by Tools.vue, ToolsPanel.vue and the WorkflowForge editor
 * panel. Adding the connector catalogue fixed the first and left this one
 * posting to `{REMOTE_URL}/auth/apikeys/:id`, where a connector-catalogue
 * provider has no row — so the same key saved from the Connectors screen
 * worked and from the Tools screen did not.
 *
 * The route taken is worth pinning, because it is not the obvious one: the
 * capability branch above is gated on `capsResult.local`, which is FALSE for a
 * connector row, so capabilities never route it. It falls through to the
 * generic `connectionType === 'apikey'` branch instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

import { useProviderConnection } from './useProviderConnection.js';
import providerAuthService from '@/services/providerAuthService.js';

vi.mock('@/services/providerAuthService.js', () => ({
  default: {
    connect: vi.fn(),
    getCapabilities: vi.fn(),
    completeRemoteOAuthCallback: vi.fn(),
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

const TYPESAFE = {
  id: 'typesafe',
  name: 'TypeSafe AI',
  connectionType: 'apikey',
  connectorOnly: true,
};

// An ordinary remote API-key provider, for contrast.
const FIRECRAWL = { id: 'firecrawl', name: 'Firecrawl', connectionType: 'apikey' };

const makeStore = (allProviders) =>
  createStore({
    modules: {
      appAuth: {
        namespaced: true,
        state: () => ({ allProviders, connectedApps: [] }),
        actions: {
          fetchAllProviders: vi.fn(),
          fetchConnectedApps: vi.fn(),
          checkConnectionHealthStream: vi.fn(),
          checkConnectionHealth: vi.fn(),
        },
      },
      aiProvider: {
        namespaced: true,
        actions: { hardRefreshProviderModels: vi.fn() },
      },
    },
  });

/** Answers the password prompt, then dismisses the result alert. */
const makeModal = () =>
  vi.fn(async (opts) => (opts?.isPrompt ? 'sk-typed-by-the-user' : true));

const mountHarness = (allProviders, showModal) => {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const modalRef = ref({ showModal });
      expose(useProviderConnection(modalRef));
      return () => h('div');
    },
  });
  return mount(Harness, { global: { plugins: [makeStore(allProviders)] } });
};

const postedTo = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => String(url));

describe('connector-only keys never reach the remote key store', () => {
  let wrapper;
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'test-token');
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    // local:false is what the backend actually answers for a connector row.
    providerAuthService.getCapabilities.mockResolvedValue({
      local: false,
      capabilities: ['status', 'connect-apikey', 'disconnect'],
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('saves TypeSafe through the local connect route', async () => {
    providerAuthService.connect.mockResolvedValue({ success: true });
    wrapper = mountHarness([TYPESAFE], makeModal());

    await wrapper.vm.handleProviderToggle('typesafe');
    await flushPromises();

    expect(providerAuthService.connect).toHaveBeenCalledWith('typesafe', {
      apiKey: 'sk-typed-by-the-user',
    });
    expect(
      postedTo(fetchMock).filter((u) => u.includes('/auth/apikeys/')),
      'the remote key store has no row for a connector provider',
    ).toEqual([]);
  });

  it('still posts an ordinary provider to the remote store', async () => {
    // The contrast that makes the test above meaningful: this is a change of
    // route for connector rows only, not a blanket move to the local store.
    wrapper = mountHarness([FIRECRAWL], makeModal());

    await wrapper.vm.handleProviderToggle('firecrawl');
    await flushPromises();

    expect(postedTo(fetchMock).some((u) => u.includes('/auth/apikeys/firecrawl'))).toBe(true);
    expect(providerAuthService.connect).not.toHaveBeenCalled();
  });

  it('reports a failed connector save instead of claiming success', async () => {
    providerAuthService.connect.mockResolvedValue({
      success: false,
      error: 'apiKey is required in request body',
    });
    const showModal = makeModal();
    wrapper = mountHarness([TYPESAFE], showModal);

    await wrapper.vm.handleProviderToggle('typesafe');
    await flushPromises();

    const titles = showModal.mock.calls.map(([o]) => o?.title);
    expect(titles).toContain('Error');
    expect(titles).not.toContain('Success');
  });

  it('does not fall back to the remote store when the local save fails', async () => {
    providerAuthService.connect.mockRejectedValue(new Error('Network Error'));
    wrapper = mountHarness([TYPESAFE], makeModal());

    await wrapper.vm.handleProviderToggle('typesafe');
    await flushPromises();

    expect(postedTo(fetchMock).filter((u) => u.includes('/auth/apikeys/'))).toEqual([]);
  });
});
