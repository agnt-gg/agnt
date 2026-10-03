/**
 * The API Key screen shows a real, non-expiring key, never the sign-in token.
 *
 * It used to display store.state.userAuth.token under the name "API key".
 * That token expires after 30 days with no refresh, so every integration built
 * on it (a chat bot, a script) stopped working a month later. Then the Settings
 * menu lost its link to this screen altogether. Both are pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const SIGN_IN_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUxIn0.sign-in-token-signature';
const MINTED = 'agnt_sk_' + 'ab12'.repeat(16);

const axiosMock = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: axiosMock }));
vi.mock('vuex', () => ({ useStore: () => ({ state: { userAuth: { token: SIGN_IN_TOKEN } } }), mapState: () => ({}), mapActions: () => ({}), mapGetters: () => ({}) }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { REMOTE_URL: 'https://api.agnt.test' } }));
// The page is gated by ProGate's 'apiAccess' rule: premium AND the feature.
const license = vi.hoisted(() => ({ premium: true }));
vi.mock('@/composables/useLicense', () => ({
  useLicense: () => ({
    isPremium: { value: license.premium },
    hasApiAccess: { value: license.premium },
    hasFeature: (name) => (name === 'apiAccess' && license.premium ? { enabled: true } : null),
  }),
}));

import ApiKeyManager from './ApiKeyManager.vue';
import SettingsPanel from '@/views/Terminal/LeftPanel/types/SettingsPanel/SettingsPanel.vue';

// Confirms every dialog, so a click runs its action to completion.
const ModalStub = { template: '<div />', methods: { showModal: () => Promise.resolve(true) } };
const mountManager = () =>
  mount(ApiKeyManager, { global: { stubs: { SimpleModal: ModalStub, UpgradeModal: true, Tooltip: { template: '<div><slot /></div>' } } } });

beforeEach(() => {
  license.premium = true;
  axiosMock.post.mockReset();
  axiosMock.delete.mockReset();
});

describe('ApiKeyManager', () => {
  it('never renders the sign-in token', () => {
    const wrapper = mountManager();
    expect(wrapper.html()).not.toContain(SIGN_IN_TOKEN);
    expect(wrapper.html()).not.toContain(SIGN_IN_TOKEN.slice(0, 12));
  });

  it('generates a key on api.agnt.gg and shows it', async () => {
    axiosMock.post.mockResolvedValue({ data: { apiKey: MINTED } });
    const wrapper = mountManager();
    await wrapper.get('[data-test="api-key-generate"]').trigger('click');
    await flushPromises();

    expect(axiosMock.post).toHaveBeenCalledWith(
      'https://api.agnt.test/users/generate-api-key',
      {},
      { headers: { Authorization: `Bearer ${SIGN_IN_TOKEN}` } },
    );
    expect(wrapper.get('[data-test="api-key-value"]').element.value).toBe(MINTED);
  });

  it('revoking calls the server and clears the shown key', async () => {
    axiosMock.post.mockResolvedValue({ data: { apiKey: MINTED } });
    axiosMock.delete.mockResolvedValue({ data: { revoked: true } });
    const wrapper = mountManager();
    await wrapper.get('[data-test="api-key-generate"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="api-key-revoke"]').trigger('click');
    await flushPromises();

    expect(axiosMock.delete).toHaveBeenCalledWith('https://api.agnt.test/users/api-key', {
      headers: { Authorization: `Bearer ${SIGN_IN_TOKEN}` },
    });
    expect(wrapper.get('[data-test="api-key-value"]').element.value).not.toBe(MINTED);
  });
});

describe('plan gate', () => {
  it('a plan without API access sees the upgrade card, not the key controls', () => {
    license.premium = false;
    const wrapper = mountManager();
    expect(wrapper.find('[data-test="api-key-generate"]').exists()).toBe(false);
    expect(wrapper.text()).toMatch(/Upgrade/);
    // How to authenticate is documentation, not a paid feature.
    expect(wrapper.text()).toContain('Authorization: Bearer YOUR_API_KEY');
  });

  it('the page shows how to authenticate a request', () => {
    const wrapper = mountManager();
    expect(wrapper.text()).toContain('Authorization: Bearer YOUR_API_KEY');
  });
});

describe('Settings menu', () => {
  it('links to the API Key screen', () => {
    const wrapper = mount(SettingsPanel, { props: { activeSection: 'profile' } });
    expect(wrapper.find('[data-nav="api-keys"]').exists()).toBe(true);
  });
});
