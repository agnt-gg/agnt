/**
 * The update badge could not be seen until you looked at it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The count badge that tells you a plugin has an update is rendered in the tab
 * strip, driven by `availableUpdateCount`, which is derived from `updatesList`,
 * which is only ever filled by `loadUpdates()`. Every call site of that
 * function was downstream of the user already being on the Updates tab:
 * clicking the tab, the "Check for Updates" button inside it, and the refresh
 * after a successful update.
 *
 * So on a fresh mount the list was empty, the count was 0, and `v-if` hid the
 * badge. The only way to discover an update was to go to the tab on spec —
 * the alert was gated behind the action it exists to prompt.
 *
 * Loading at mount is what makes the badge mean anything, and it is close to
 * free: mounting this screen already fetches the marketplace registry twice
 * (installed list + marketplace list), so this is a third call on a path that
 * is already warm.
 *
 * The second half of these tests covers the background scheduler's summary,
 * which was written to disk and read by nothing. The row that matters is
 * `blockedOnConsent`: an unattended update REFUSED because the new version
 * wanted permissions the installed one did not have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

vi.mock('@/composables/useLicense', () => ({
  useLicense: () => ({ isPremium: { value: true }, hasPlugins: { value: true }, maxPlugins: { value: -1 } }),
}));

// Heavy sibling screens; neither is rendered by the tabs under test.
vi.mock('./PluginBuilder.vue', () => ({ default: { name: 'PluginBuilder', template: '<div />' } }));
vi.mock('./PackStudio.vue', () => ({ default: { name: 'PackStudio', template: '<div />' } }));

const store = {
  getters: {},
  state: { marketplace: { myPublishedItems: [] } },
  dispatch: vi.fn().mockResolvedValue(undefined),
};
vi.mock('vuex', () => ({ useStore: () => store }));

// Every request the component makes, in order, plus per-endpoint canned replies.
let requested;
let replies;

vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url) => {
    requested.push(url);
    for (const [fragment, reply] of replies) {
      if (url.includes(fragment)) {
        return { ok: reply.ok !== false, status: reply.status || 200, json: async () => reply.body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, plugins: [] }) };
  }),
}));

import Plugins from './Plugins.vue';

const UPDATES = [
  { name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true, status: 'update-available' },
  { name: 'scraper', installed: '2.0.0', latest: '3.0.0', updateAvailable: true, status: 'update-available' },
  { name: 'notes', installed: '1.0.0', latest: '1.0.0', updateAvailable: false, status: 'up-to-date' },
];

function setTab(tab) {
  store.getters = {
    'connectors/activeTab': tab,
    'connectors/selectedPlugin': null,
    'connectors/refreshTrigger': 0,
    'userAuth/stripeConnected': false,
  };
}

const mountScreen = () => mount(Plugins, { global: { stubs: { Teleport: true, Transition: false } } });

beforeEach(() => {
  // fetchInstalledPlugins/fetchMarketplacePlugins call the global fetch
  // directly rather than apiFetch. Left unmocked they reach for a real socket,
  // isLoading never clears, and the tab body never renders — so every
  // assertion about tab content would fail for a reason unrelated to updates.
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, plugins: [] }) }));
  requested = [];
  replies = [
    ['/plugins/updates', { body: { success: true, updates: UPDATES } }],
    ['/plugins/update-settings', { body: { success: true, settings: { autoCheck: true, intervalHours: 24 } } }],
    ['/plugins/update-status', { body: { success: true, status: null } }],
  ];
  setTab('installed');
  store.dispatch.mockClear();
  localStorage.clear();
});

describe('the Updates badge on first mount', () => {
  it('fetches updates without the user visiting the Updates tab', async () => {
    // The regression. Before the fix nothing here requested /plugins/updates,
    // because the only callers were on the tab this test never opens.
    const wrapper = mountScreen();
    await flushPromises();

    expect(requested.some((url) => url.includes('/plugins/updates'))).toBe(true);
    wrapper.unmount();
  });

  it('shows the count in the tab strip while sitting on another tab', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    const badge = wrapper.find('.updates-count');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('2'); // two of the three have updateAvailable
    wrapper.unmount();
  });

  it('counts only plugins that actually have an update', async () => {
    replies[0] = ['/plugins/updates', { body: { success: true, updates: [UPDATES[2]] } }];
    const wrapper = mountScreen();
    await flushPromises();

    // An up-to-date plugin must not produce a badge — a badge that is always
    // on is the same as no badge.
    expect(wrapper.find('.updates-count').exists()).toBe(false);
    wrapper.unmount();
  });

  it('leaves the rest of the screen alone when the update check fails', async () => {
    replies[0] = ['/plugins/updates', { body: { success: false, error: 'offline' } }];
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.updates-count').exists()).toBe(false);
    expect(wrapper.find('.tabs').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('the background pass summary', () => {
  it('names the plugin and the permissions behind a refused auto-update', async () => {
    setTab('updates');
    replies[2] = [
      '/plugins/update-status',
      {
        body: {
          success: true,
          status: {
            checkedAt: '2026-08-18T04:00:00.000Z',
            updatesAvailable: 2,
            autoUpdated: [],
            blockedOnConsent: [{ name: 'scraper', permissionDiff: { added: ['filesystem', 'spawn-process'] } }],
            notified: [],
          },
        },
      },
    ];

    const wrapper = mountScreen();
    await flushPromises();

    const panel = wrapper.find('.update-status-panel');
    expect(panel.exists()).toBe(true);
    const text = panel.text();
    expect(text).toContain('scraper');
    expect(text).toContain('filesystem');
    expect(text).toContain('spawn-process');
    // The user must be told nothing was installed, or "blocked" reads as "done".
    expect(text).toMatch(/nothing was installed/i);
    wrapper.unmount();
  });

  it('reports an automatic install that already happened', async () => {
    setTab('updates');
    replies[2][1].body.status = {
      checkedAt: '2026-08-18T04:00:00.000Z',
      updatesAvailable: 1,
      autoUpdated: [{ name: 'notes', version: '1.1.0' }],
      blockedOnConsent: [],
      notified: [],
    };

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.update-status-panel').text()).toContain('notes was updated automatically to v1.1.0');
    wrapper.unmount();
  });

  it('does not repeat a plain notify, which is already a card below', async () => {
    setTab('updates');
    replies[2][1].body.status = {
      checkedAt: '2026-08-18T04:00:00.000Z',
      updatesAvailable: 1,
      autoUpdated: [],
      blockedOnConsent: [],
      notified: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0' }],
    };

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.update-status-panel').exists()).toBe(false);
    wrapper.unmount();
  });

  it('surfaces an update that failed outright', async () => {
    setTab('updates');
    replies[2][1].body.status = {
      checkedAt: '2026-08-18T04:00:00.000Z',
      updatesAvailable: 1,
      autoUpdated: [],
      blockedOnConsent: [],
      notified: [{ name: 'flaky', error: 'download failed: 502' }],
    };

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.update-status-panel').text()).toContain('download failed: 502');
    wrapper.unmount();
  });

  it('shows no panel when the scheduler has never run', async () => {
    setTab('updates');
    const wrapper = mountScreen(); // default reply: status null
    await flushPromises();

    expect(wrapper.find('.update-status-panel').exists()).toBe(false);
    wrapper.unmount();
  });

  it('still lists updates when the status endpoint is missing', async () => {
    // A client can outlive its server. A 404 whose body is not JSON must not
    // take the tab down to hide a banner.
    setTab('updates');
    replies[2] = ['/plugins/update-status', { ok: false, status: 404, body: undefined }];

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.update-status-panel').exists()).toBe(false);
    expect(wrapper.find('.updates-count').text()).toBe('2');
    wrapper.unmount();
  });

  it('renders plugin-supplied text as text, never as markup', async () => {
    setTab('updates');
    replies[2][1].body.status = {
      checkedAt: '2026-08-18T04:00:00.000Z',
      updatesAvailable: 1,
      autoUpdated: [],
      blockedOnConsent: [],
      notified: [{ name: '<img src=x onerror=alert(1)>', error: '<b>boom</b>' }],
    };

    const wrapper = mountScreen();
    await flushPromises();

    const panel = wrapper.find('.update-status-panel');
    expect(panel.exists()).toBe(true);
    // Names and errors originate off this machine; they are interpolated.
    expect(panel.find('img').exists()).toBe(false);
    expect(panel.find('b').exists()).toBe(false);
    expect(panel.text()).toContain('<b>boom</b>');
    wrapper.unmount();
  });
});
