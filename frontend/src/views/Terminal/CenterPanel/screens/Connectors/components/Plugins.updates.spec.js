/**
 * The plugin screen asks the user exactly one question.
 *
 * WHY THIS EXISTS
 * ---------------
 * This screen used to present, for N installed plugins, 2 + 2N update
 * controls: a "Check for Updates" button, a "Check automatically (daily)"
 * checkbox, an auto/notify/pinned dropdown on every row, an Update button on
 * every row, and a whole tab to hold them. None of them asked a question the
 * user could answer better than the program could — nobody knows better than
 * the app whether now is a good time to poll a JSON file — and the default
 * configuration of all of them added up to "never update anything".
 *
 * What replaced them: updates apply themselves, and the ONLY thing that
 * reaches the user is an update refused because it asked for permissions the
 * installed version did not have. That refusal is a real question with a real
 * consequence, so it gets a chip, a badge and a modal. Everything else gets a
 * quiet chip on the card the plugin already occupies, or nothing.
 *
 * These tests pin both halves: that the deleted controls stay deleted, and
 * that the one surviving interrupt works end to end.
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
  state: { marketplace: { myPublishedItems: [], items: [] } },
  dispatch: vi.fn().mockResolvedValue(undefined),
};
vi.mock('vuex', () => ({ useStore: () => store }));

let requested; // every apiFetch call, in order
let replies; // [urlFragment, reply] pairs, first match wins
let installed; // what GET /plugins/installed returns

vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    requested.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    for (const [fragment, reply] of replies) {
      if (url.includes(fragment)) {
        const body = typeof reply.body === 'function' ? reply.body() : reply.body;
        return { ok: reply.ok !== false, status: reply.status || 200, json: async () => body };
      }
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }),
}));

import Plugins from './Plugins.vue';

const showModal = vi.fn().mockResolvedValue(false);
const SimpleModalStub = { name: 'SimpleModal', template: '<div />', methods: { showModal } };

/**
 * Records what v-tooltip was bound to.
 *
 * The real directive is registered globally in main.js and paints through the
 * tooltip engine; asserting on that would couple this spec to engine
 * internals. What belongs to THIS component is which string it hands over.
 * (A native `title` is banned by uiContracts.spec.js — it renders the OS
 * tooltip, which is unstyled and invisible on touch.)
 */
const tooltips = new WeakMap();
const recordTooltip = {
  mounted: (el, binding) => tooltips.set(el, binding.value),
  updated: (el, binding) => tooltips.set(el, binding.value),
};
const tooltipOf = (domWrapper) => tooltips.get(domWrapper.element);

function mountScreen() {
  return mount(Plugins, {
    global: {
      stubs: { SimpleModal: SimpleModalStub, Teleport: true, Transition: false },
      directives: { tooltip: recordTooltip },
    },
  });
}

/**
 * The installed list sorts by display name, so a positional lookup silently
 * addresses the wrong card. Always ask for the plugin by name.
 */
function cardFor(wrapper, name) {
  const card = wrapper.findAll('.plugin-card.installed').find((c) => c.find('.plugin-name').text().toLowerCase() === name);
  if (!card) throw new Error(`no installed card for "${name}"`);
  return card;
}

function setStatus(status) {
  replies = replies.filter(([fragment]) => fragment !== '/plugins/update-status');
  replies.unshift(['/plugins/update-status', { body: { success: true, status } }]);
}

beforeEach(() => {
  // fetchInstalledPlugins/fetchMarketplacePlugins call the global fetch
  // directly rather than apiFetch. Left unmocked they reach for a real socket,
  // isLoading never clears, and the tab body never renders — so every
  // assertion below would fail for a reason unrelated to updates.
  installed = [
    { name: 'weather', version: '1.4.0', description: 'w' },
    { name: 'scraper', version: '2.0.0', description: 's' },
    { name: 'notes', version: '1.1.0', description: 'n' },
  ];
  global.fetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/plugins/installed') ? { success: true, plugins: installed } : { success: true, plugins: [] }),
  }));

  requested = [];
  replies = [['/plugins/update-status', { body: { success: true, status: null } }]];

  store.getters = {
    'connectors/activeTab': 'installed',
    'connectors/selectedPlugin': null,
    'connectors/refreshTrigger': 0,
    'userAuth/stripeConnected': false,
  };
  store.dispatch.mockClear();
  showModal.mockReset().mockResolvedValue(false);
  localStorage.clear();
});

describe('the controls that are gone', () => {
  it('has no Updates tab', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    const tabs = wrapper.findAll('.tab').map((t) => t.text());
    expect(tabs.some((t) => /Updates/i.test(t))).toBe(false);
    // The tabs that remain are still there — this is not passing by rendering nothing.
    expect(tabs.some((t) => /Installed/.test(t))).toBe(true);
    expect(tabs.some((t) => /Marketplace/.test(t))).toBe(true);
    wrapper.unmount();
  });

  it('has no check-now button, no auto-check checkbox and no policy dropdown', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    const text = wrapper.text();
    expect(text).not.toMatch(/Check for Updates/i);
    expect(text).not.toMatch(/Check automatically/i);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.find('.policy-select').exists()).toBe(false);
    expect(wrapper.find('.updates-toolbar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('never asks the backend whether checking is enabled', async () => {
    // The settings route is gone. A client still calling it would 404 on every
    // mount and quietly reintroduce the dead round trip.
    const wrapper = mountScreen();
    await flushPromises();

    expect(requested.some((r) => r.url.includes('/plugins/update-settings'))).toBe(false);
    wrapper.unmount();
  });

  it('drops the status filter, which duplicated the tabs', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.controls-group').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Refresh/i);
    wrapper.unmount();
  });
});

describe('the one badge left', () => {
  it('counts only updates that need a decision', async () => {
    setStatus({
      checkedAt: '2026-08-18T04:00:00.000Z',
      updatesAvailable: 3,
      autoUpdated: [{ name: 'notes', version: '1.1.0' }],
      blockedOnConsent: [{ name: 'scraper', permissionDiff: { added: ['filesystem'] } }],
      failed: [{ name: 'weather', error: 'boom' }],
    });

    const wrapper = mountScreen();
    await flushPromises();

    // An applied update and a failure are NOT attention — only the refusal is.
    expect(wrapper.find('.review-count').text()).toBe('1');
    wrapper.unmount();
  });

  it('shows nothing when the scheduler has never run', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.review-count').exists()).toBe(false);
    wrapper.unmount();
  });

  it('ignores a blocked entry for a plugin that is no longer installed', async () => {
    // A stale status file must not advertise work that cannot be done.
    setStatus({ blockedOnConsent: [{ name: 'uninstalled-thing', permissionDiff: { added: ['network'] } }] });

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.review-count').exists()).toBe(false);
    wrapper.unmount();
  });

  it('survives a backend with no update-status route at all', async () => {
    replies = [['/plugins/update-status', { ok: false, status: 404, body: undefined }]];

    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.review-count').exists()).toBe(false);
    expect(wrapper.findAll('.plugin-card.installed')).toHaveLength(3);
    wrapper.unmount();
  });
});

describe('one chip per card, ranked', () => {
  it('ranks a refusal above everything else on the same plugin', async () => {
    // A card has room for exactly one fact, and this is the only one that is
    // asking for something.
    setStatus({
      autoUpdated: [{ name: 'scraper', version: '3.0.0' }],
      failed: [{ name: 'scraper', error: 'also this' }],
      blockedOnConsent: [{ name: 'scraper', permissionDiff: { added: ['filesystem'] } }],
    });

    const wrapper = mountScreen();
    await flushPromises();

    const card = cardFor(wrapper, 'scraper');
    expect(card.findAll('.notice-chip')).toHaveLength(1);
    expect(card.find('.notice-chip.review').text()).toContain('Update needs review');
    wrapper.unmount();
  });

  it('reports an update that already applied itself', async () => {
    setStatus({ autoUpdated: [{ name: 'notes', version: '1.1.0' }] });

    const wrapper = mountScreen();
    await flushPromises();

    const chip = cardFor(wrapper, 'notes').find('.notice-chip.updated');
    expect(chip.text()).toContain('Updated to v1.1.0');
    wrapper.unmount();
  });

  it('reports a failure with its reason', async () => {
    setStatus({ failed: [{ name: 'weather', error: 'download failed: 502' }] });

    const wrapper = mountScreen();
    await flushPromises();

    const chip = cardFor(wrapper, 'weather').find('.notice-chip.failed');
    expect(tooltipOf(chip)).toContain('download failed: 502');
    wrapper.unmount();
  });

  it('still reads a legacy status file that called failures "notified"', async () => {
    setStatus({ notified: [{ name: 'weather', error: 'legacy shape' }] });

    const wrapper = mountScreen();
    await flushPromises();

    expect(cardFor(wrapper, 'weather').find('.notice-chip.failed').exists()).toBe(true);
    wrapper.unmount();
  });

  it('marks a pinned plugin', async () => {
    installed[0].updatePolicy = 'pinned';

    const wrapper = mountScreen();
    await flushPromises();

    expect(cardFor(wrapper, 'weather').find('.notice-chip.pinned').text()).toContain('Pinned');
    wrapper.unmount();
  });

  it('says only "Installed" when there is nothing to report', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    const card = cardFor(wrapper, 'weather');
    expect(card.find('.notice-chip').exists()).toBe(false);
    expect(card.find('.status-badge.installed').text()).toContain('Installed');
    wrapper.unmount();
  });

  it('renders plugin-supplied text as text, never as markup', async () => {
    setStatus({ failed: [{ name: 'weather', error: '<img src=x onerror=alert(1)>' }] });

    const wrapper = mountScreen();
    await flushPromises();

    const card = cardFor(wrapper, 'weather');
    expect(card.find('img').exists()).toBe(false);
    // The string is carried as data, never parsed as markup.
    expect(tooltipOf(card.find('.notice-chip.failed'))).toContain('<img');
    wrapper.unmount();
  });
});

describe('the one interrupt', () => {
  const BLOCKED = {
    blockedOnConsent: [{ name: 'scraper', permissionDiff: { added: ['filesystem', 'spawn-process'] } }],
  };

  function respondToUpdate(sequence) {
    let call = 0;
    replies.push(['/plugins/update/', { body: () => sequence[Math.min(call++, sequence.length - 1)] }]);
  }

  it('asks the server for a fresh diff rather than trusting the status file', async () => {
    setStatus(BLOCKED);
    respondToUpdate([{ success: false, requiresConsent: true, permissionDiff: { added: ['filesystem'] } }]);

    const wrapper = mountScreen();
    await flushPromises();
    await wrapper.find('.notice-chip.review').trigger('click');
    await flushPromises();

    const first = requested.find((r) => r.url.includes('/plugins/update/'));
    expect(first.method).toBe('POST');
    // Consent is never pre-granted: the gate has to fire and say what changed.
    expect(first.body).toEqual({ acceptedPermissions: false });
    wrapper.unmount();
  });

  it('names the permissions in the consent modal', async () => {
    setStatus(BLOCKED);
    respondToUpdate([{ success: false, requiresConsent: true, permissionDiff: { added: ['filesystem', 'spawn-process'] } }]);

    const wrapper = mountScreen();
    await flushPromises();
    await wrapper.find('.notice-chip.review').trigger('click');
    await flushPromises();

    expect(showModal).toHaveBeenCalledTimes(1);
    const options = showModal.mock.calls[0][0];
    expect(options.title).toContain('scraper');
    expect(options.message).toContain('filesystem');
    expect(options.message).toContain('spawn-process');
    wrapper.unmount();
  });

  it('installs nothing when the user declines', async () => {
    setStatus(BLOCKED);
    respondToUpdate([{ success: false, requiresConsent: true, permissionDiff: { added: ['filesystem'] } }]);
    showModal.mockResolvedValue(false);

    const wrapper = mountScreen();
    await flushPromises();
    await wrapper.find('.notice-chip.review').trigger('click');
    await flushPromises();

    expect(requested.filter((r) => r.url.includes('/plugins/update/'))).toHaveLength(1);
    wrapper.unmount();
  });

  it('re-sends WITH consent only after the user agrees', async () => {
    setStatus(BLOCKED);
    respondToUpdate([
      { success: false, requiresConsent: true, permissionDiff: { added: ['filesystem'] } },
      { success: true, version: '3.0.0' },
    ]);
    showModal.mockResolvedValue(true);

    const wrapper = mountScreen();
    await flushPromises();
    await wrapper.find('.notice-chip.review').trigger('click');
    await flushPromises();

    const updates = requested.filter((r) => r.url.includes('/plugins/update/'));
    expect(updates).toHaveLength(2);
    expect(updates[1].body).toEqual({ acceptedPermissions: true });
    // And the screen re-reads what the background pass now says.
    expect(requested.filter((r) => r.url.includes('/plugins/update-status')).length).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it('escapes a permission string before it reaches the v-html modal body', async () => {
    // normalizePermissions() passes any string in a plugin manifest through
    // verbatim, including `domain:<anything>`. A refused update's code never
    // runs — its manifest text must not get to run either, in the very dialog
    // whose job is to tell the truth about what is being granted.
    setStatus(BLOCKED);
    respondToUpdate([
      { success: false, requiresConsent: true, permissionDiff: { added: ['domain:<img src=x onerror=alert(1)>'] } },
    ]);

    const wrapper = mountScreen();
    await flushPromises();
    await wrapper.find('.notice-chip.review').trigger('click');
    await flushPromises();

    const { message } = showModal.mock.calls[0][0];
    expect(message).not.toContain('<img');
    expect(message).toContain('&lt;img');
    wrapper.unmount();
  });
});

describe('the overflow menu', () => {
  it('is closed until asked for', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.find('.card-menu-btn').exists()).toBe(true);
    expect(wrapper.find('.card-menu-items').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers to pin the installed version', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    const card = cardFor(wrapper, 'weather');
    await card.find('.card-menu-btn').trigger('click');

    expect(card.find('.card-menu-item').text()).toContain('Pin to v1.4.0');
    wrapper.unmount();
  });

  it('pins, and the request says pinned', async () => {
    replies.push(['/plugins/update-policy/', { body: { success: true } }]);

    const wrapper = mountScreen();
    await flushPromises();
    const card = cardFor(wrapper, 'weather');
    await card.find('.card-menu-btn').trigger('click');
    await card.find('.card-menu-item').trigger('click');
    await flushPromises();

    const call = requested.find((r) => r.url.includes('/plugins/update-policy/'));
    expect(call.url).toContain('weather');
    expect(call.body).toEqual({ policy: 'pinned' });
    wrapper.unmount();
  });

  it('offers the way back out, and it is not called "notify"', async () => {
    installed[0].updatePolicy = 'pinned';
    replies.push(['/plugins/update-policy/', { body: { success: true } }]);

    const wrapper = mountScreen();
    await flushPromises();
    const card = cardFor(wrapper, 'weather');
    await card.find('.card-menu-btn').trigger('click');

    const item = card.find('.card-menu-item');
    expect(item.text()).toContain('Allow automatic updates');

    await item.trigger('click');
    await flushPromises();

    expect(requested.find((r) => r.url.includes('/plugins/update-policy/')).body).toEqual({ policy: 'auto' });
    wrapper.unmount();
  });

  it('closes after acting', async () => {
    replies.push(['/plugins/update-policy/', { body: { success: true } }]);

    const wrapper = mountScreen();
    await flushPromises();
    const card = cardFor(wrapper, 'weather');
    await card.find('.card-menu-btn').trigger('click');
    await card.find('.card-menu-item').trigger('click');
    await flushPromises();

    expect(wrapper.find('.card-menu-items').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens one menu at a time', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await wrapper.findAll('.card-menu-btn')[0].trigger('click');
    await wrapper.findAll('.card-menu-btn')[1].trigger('click');

    expect(wrapper.findAll('.card-menu-items')).toHaveLength(1);
    wrapper.unmount();
  });
});
