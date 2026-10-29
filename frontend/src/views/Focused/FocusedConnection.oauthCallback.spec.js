import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

/**
 * Regression: connecting an OAuth service from Focused never completed in the desktop app.
 * For origin localhost:3333, api.agnt.gg's callback page postMessages the raw code to the
 * opener ('oauth-callback') instead of exchanging it; Connectors handled that, Focused did not,
 * so the popup closed and nothing was stored.
 */

const complete = vi.fn();
vi.mock('@/services/providerAuthService.js', () => ({ default: { completeRemoteOAuthCallback: (...a) => complete(...a) } }));
vi.mock('@/utils/oauthMessageOrigin.js', () => ({
  isTrustedOAuthMessageOrigin: (origin) => origin === 'http://localhost:3333',
  hasOAuthMessagePayload: (e) => e?.data !== null && typeof e?.data === 'object',
}));
const card = { id: 'google', name: 'Google', providerId: 'google', status: 'connect', connectionType: 'oauth', apps: [], plugins: [], widgets: [], skills: [], suggested: [], installed: [] };
vi.mock('@/composables/useAppCards.js', () => ({ useAppCards: () => ({ cards: ref([card]), loading: ref(false) }) }));
vi.mock('@/services/appCards.js', () => ({ findAppCard: () => card, describeApps: () => '' }));
vi.mock('./FocusedConnectorLogo.vue', () => ({ default: { template: '<i />' } }));

const dispatch = vi.fn(async () => {});
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state: { appAuth: { allProviders: [{ id: 'google', name: 'Google' }] } }, getters: {} }) }));

import FocusedConnection from './FocusedConnection.vue';

let wrapper;
const post = (data, origin = 'http://localhost:3333') => window.dispatchEvent(new MessageEvent('message', { data, origin }));

beforeEach(() => {
  complete.mockReset().mockResolvedValue({ success: true });
  dispatch.mockClear();
  wrapper = mount(FocusedConnection, {
    props: { cardId: 'google' },
    global: { provide: { focusedNav: { go: vi.fn(), toast: vi.fn() } }, stubs: { transition: false } },
  });
});
afterEach(() => wrapper?.unmount());

describe('FocusedConnection: desktop OAuth callback', () => {
  it('exchanges the code the callback page posts back, then refreshes connections', async () => {
    post({ type: 'oauth-callback', code: 'c-1', state: 'google:n:http://localhost:3333', provider: 'google' });
    await flushPromises();
    expect(complete).toHaveBeenCalledWith({ code: 'c-1', state: 'google:n:http://localhost:3333' });
    expect(dispatch).toHaveBeenCalledWith('appAuth/refreshAfterConnect');
  });

  it('ignores messages from untrusted origins, null payloads and other types', async () => {
    post({ type: 'oauth-callback', code: 'x', state: 's' }, 'https://evil.example');
    post(null);
    post({ type: 'something-else', code: 'x', state: 's' });
    await flushPromises();
    expect(complete).not.toHaveBeenCalled();
  });

  it('stops listening once the page is left', async () => {
    wrapper.unmount(); wrapper = null;
    post({ type: 'oauth-callback', code: 'c-2', state: 's' });
    await flushPromises();
    expect(complete).not.toHaveBeenCalled();
  });
});
