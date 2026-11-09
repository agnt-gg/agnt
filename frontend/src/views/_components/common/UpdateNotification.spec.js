import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, config } from '@vue/test-utils';

// The dialog teleports to <body>; render it in place so wrapper queries see it.
config.global.stubs = { ...config.global.stubs, teleport: true };

/**
 * The update banner has two jobs and must never mix them:
 *
 *   - a desktop build that updates itself renders ONLY main's update state
 *     (electron/autoUpdate.js): downloading, ready, blocked, error, installed
 *   - everything else (browser, Docker, deb/rpm, dev) gets the agnt.gg notice:
 *     "a new version exists", with a Download button
 *
 * A self-updating build showing the Download notice would send the user to a
 * browser to fetch a file already on their disk.
 */

let electronMock = null;
vi.mock('@/composables/useElectron', () => ({
  useElectron: () => ({ electron: electronMock }),
}));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

import UpdateNotification from './UpdateNotification.vue';

const base = {
  enabled: true,
  phase: 'idle',
  currentVersion: '0.6.7',
  needsExplicitInstall: true,
  available: null,
  percent: null,
  error: null,
  blocked: null,
  installed: null,
};

function desktop(initial = {}) {
  let push = null;
  const api = {
    state: vi.fn(async () => ({ ...base, ...initial })),
    check: vi.fn(async () => ({ ...base })),
    install: vi.fn(async () => ({ ok: true })),
    onState: vi.fn((cb) => {
      push = cb;
      return () => (push = null);
    }),
  };
  electronMock = {
    autoUpdate: api,
    getAppVersion: vi.fn(async () => '0.6.7'),
    checkForUpdates: vi.fn(async () => ({ updateAvailable: true, latestVersion: '9.9.9' })),
    openDownloadPage: vi.fn(),
  };
  return { api, push: (s) => push?.({ ...base, ...s }) };
}

const text = (w) => w.text().replace(/\s+/g, ' ');
// Any update surface at all: a banner state or the dialog.
const anyUpdateUi = (w) => w.find('[data-testid^="update-"]').exists();

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  electronMock = null;
});

describe('self-updating desktop build', () => {
  it('idle shows nothing, and never the agnt.gg Download notice', async () => {
    const d = desktop();
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(anyUpdateUi(w)).toBe(false);
    expect(electronMock.checkForUpdates).not.toHaveBeenCalled();
    d.push({ phase: 'checking' });
    await flushPromises();
    expect(anyUpdateUi(w)).toBe(false);
  });

  it('starts from the state main already has (reload after a download)', async () => {
    desktop({ phase: 'ready', available: { version: '0.6.8' } });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(w.find('[data-testid="update-ready"]').exists()).toBe(true);
    expect(text(w)).toContain('v0.6.7 → v0.6.8');
  });

  it('follows downloading → ready from pushed state', async () => {
    const d = desktop();
    const w = mount(UpdateNotification);
    await flushPromises();
    d.push({ phase: 'downloading', available: { version: '0.6.8' }, percent: 42 });
    await flushPromises();
    expect(text(w)).toContain('Downloading Update');
    expect(text(w)).toContain('42%');
    d.push({ phase: 'ready', available: { version: '0.6.8' } });
    await flushPromises();
    expect(w.find('[data-testid="update-ready"]').exists()).toBe(true);
  });

  it('macOS preparing: says so and offers no restart until Squirrel has it', async () => {
    const d = desktop({ phase: 'preparing', available: { version: '0.6.8' }, needsExplicitInstall: false });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Preparing Update');
    expect(w.find('.download-btn').exists()).toBe(false);
    d.push({ phase: 'ready', available: { version: '0.6.8' }, needsExplicitInstall: false });
    await flushPromises();
    expect(text(w)).toContain('Restart now');
  });

  it('an all-users Windows install says Windows will ask for permission', async () => {
    desktop({ phase: 'ready', available: { version: '0.6.8' }, needsPermission: true });
    let w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Windows will ask for permission');
    desktop({ phase: 'ready', available: { version: '0.6.8' }, needsPermission: false });
    w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).not.toContain('permission');
  });

  it('Windows says "Restart to update"; macOS/AppImage say "Restart now"', async () => {
    desktop({ phase: 'ready', available: { version: '0.6.8' }, needsExplicitInstall: true });
    let w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Restart to update');
    desktop({ phase: 'ready', available: { version: '0.6.8' }, needsExplicitInstall: false });
    w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Restart now');
  });

  it('clicking restart installs without force', async () => {
    const d = desktop({ phase: 'ready', available: { version: '0.6.8' } });
    const w = mount(UpdateNotification);
    await flushPromises();
    await w.find('.download-btn').trigger('click');
    await flushPromises();
    expect(d.api.install).toHaveBeenCalledWith({ force: false });
    expect(text(w)).toContain('Restarting…');
  });

  it('busy: says what is running and offers Restart anyway, which forces', async () => {
    const d = desktop({ phase: 'ready', available: { version: '0.6.8' }, blocked: { reason: 'busy', busy: { goals: 2, chats: 1, workflows: 0, tools: 0 } } });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('2 goals, 1 chat still running');
    expect(text(w)).toContain('Restart anyway');
    await w.find('.download-btn').trigger('click');
    expect(d.api.install).toHaveBeenCalledWith({ force: true });
  });

  it("unknown: says it can't tell, and still offers Restart anyway", async () => {
    desktop({ phase: 'ready', available: { version: '0.6.8' }, blocked: { reason: 'unknown', busy: { unknown: ['backend'] } } });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain("Can't tell what's running");
    expect(text(w)).toContain('Restart anyway');
  });

  it('a refused install re-enables the button', async () => {
    const d = desktop({ phase: 'ready', available: { version: '0.6.8' } });
    d.api.install.mockResolvedValueOnce({ ok: false, reason: 'busy' });
    const w = mount(UpdateNotification);
    await flushPromises();
    await w.find('.download-btn').trigger('click');
    await flushPromises();
    expect(w.find('.download-btn').attributes('disabled')).toBeUndefined();
  });

  it('error: shows the message and Retry runs a check', async () => {
    const d = desktop({ phase: 'error', error: { message: 'sha512 checksum mismatch', during: 'download' } });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Update failed');
    expect(text(w)).toContain('sha512 checksum mismatch');
    await w.find('.download-btn').trigger('click');
    expect(d.api.check).toHaveBeenCalled();
  });

  it('after a restart: confirms the version, or says it did not take', async () => {
    desktop({ installed: { from: '0.6.7', to: '0.6.8', ok: true, running: '0.6.8' } });
    let w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('Updated to v0.6.8');
    desktop({ installed: { from: '0.6.7', to: '0.6.8', ok: false, running: '0.6.7' } });
    w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('The update did not install');
    expect(text(w)).toContain('Still running v0.6.7');
  });

  it('Later hides this state only; the next news shows again', async () => {
    const d = desktop({ phase: 'ready', available: { version: '0.6.8' } });
    const w = mount(UpdateNotification);
    await flushPromises();
    await w.find('.dismiss-btn').trigger('click');
    expect(anyUpdateUi(w)).toBe(false);
    d.push({ phase: 'ready', available: { version: '0.6.8' } });
    await flushPromises();
    expect(anyUpdateUi(w)).toBe(false);
    d.push({ phase: 'error', error: { message: 'offline', during: 'check' } });
    await flushPromises();
    expect(w.find('[data-testid="update-error"]').exists()).toBe(true);
  });

  it('unsubscribes on unmount', async () => {
    const d = desktop();
    const w = mount(UpdateNotification);
    await flushPromises();
    w.unmount();
    expect(d.api.onState).toHaveBeenCalledTimes(1);
  });
});

describe('builds that do not update themselves', () => {
  it('a disabled desktop build (deb/rpm, dev) falls back to the agnt.gg notice', async () => {
    desktop({ enabled: false, phase: 'disabled', disabledReason: 'linux-package-manager' });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(w.find('[data-testid="update-notice"]').exists()).toBe(true);
    expect(text(w)).toContain('v0.6.7 → v9.9.9');
    await w.find('.download-btn').trigger('click');
    expect(electronMock.openDownloadPage).toHaveBeenCalled();
  });

  it('a browser (no Electron) uses the backend check', async () => {
    electronMock = null;
    globalThis.fetch = vi.fn(async (u) => ({
      json: async () => (String(u).endsWith('/version') ? { version: '0.6.6' } : { updateAvailable: true, latestVersion: '0.6.7', currentVersion: '0.6.6' }),
    }));
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(text(w)).toContain('v0.6.6 → v0.6.7');
  });

  it('a dismissed notice version stays dismissed', async () => {
    localStorage.setItem('agnt_dismissed_update', '9.9.9');
    desktop({ enabled: false, phase: 'disabled' });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(anyUpdateUi(w)).toBe(false);
  });
});

describe('release notes in the update dialog', () => {
  const RELEASES_URL = 'https://agnt.gg/api/releases';
  const release068 = {
    version: '0.6.8',
    date: 'November 7, 2026',
    title: 'AGNT One & Teamspaces — AGNT v0.6.8',
    features: [
      { name: 'AGNT One is the app: one rail for every page', status: 'new' },
      { name: '[Team] Teamspaces: invite-only spaces', status: 'new' },
      { name: 'Copy, regenerate, fork and delete on every message', status: 'new' },
      { name: 'A new Plugins page', status: 'new' },
      { name: 'Workflows: run now and compare versions', status: 'new' },
      { name: 'Run a model on your computer', status: 'updated' },
      { name: 'Large previews open instantly', status: 'bug' },
      { name: 'Chats stay fast while a long reply is streaming', status: 'bug' },
    ],
  };
  const release067 = { version: '0.6.7', date: 'October 9, 2026', title: 'Older', features: [{ name: 'Something from the previous release', status: 'new' }] };

  function feed(releases) {
    globalThis.fetch = vi.fn(async (url) =>
      String(url) === RELEASES_URL ? { ok: true, json: async () => ({ releases }) } : { ok: true, json: async () => ({}) },
    );
  }

  async function openReady(extra = {}) {
    const d = desktop({ phase: 'ready', available: { version: '0.6.8' }, ...extra });
    const w = mount(UpdateNotification, { attachTo: document.body });
    await flushPromises();
    return { d, w };
  }

  it('shows the waiting version’s name, date and counts, newest features first', async () => {
    feed([release068, release067]);
    const { w } = await openReady();
    expect(text(w)).toContain('AGNT v0.6.8');
    expect(text(w)).toContain('AGNT One & Teamspaces');
    expect(text(w)).toContain('v0.6.7 → v0.6.8 · November 7, 2026');
    expect(w.findAll('.change-count').map((c) => [c.find('b').text(), c.find('span').text()])).toEqual([['5', 'New'], ['1', 'Improved'], ['2', 'Fixed']]);
    const items = w.findAll('.change-group li');
    expect(items).toHaveLength(4);
    expect(items[0].find('strong').text()).toBe('AGNT One is the app');
    expect(items[1].find('.plan-badge').text()).toBe('Team');
    expect(text(w)).not.toContain('Large previews');
    w.unmount();
  });

  it('Show all expands every group, and Show less collapses again', async () => {
    feed([release068]);
    const { w } = await openReady();
    await w.find('.show-all-changes').trigger('click');
    expect(w.findAll('.change-group li')).toHaveLength(8);
    expect(w.findAll('.change-group h4').map((h) => h.text())).toEqual(['New', 'Improved', 'Fixed']);
    expect(w.find('.show-all-changes').text()).toBe('Show less');
    await w.find('.show-all-changes').trigger('click');
    expect(w.findAll('.change-group li')).toHaveLength(4);
    w.unmount();
  });

  it('a count tile opens the full list at that group', async () => {
    feed([release068]);
    const { w } = await openReady();
    await w.findAll('.change-count')[2].trigger('click');
    await flushPromises();
    expect(w.find('[data-group="bug"]').text()).toContain('Large previews open instantly');
    w.unmount();
  });

  it('never shows another version’s notes when the feed does not have this one yet', async () => {
    feed([release067]);
    const { w } = await openReady();
    expect(w.find('[data-testid="update-ready"]').exists()).toBe(true);
    expect(w.find('.change-list').exists()).toBe(false);
    expect(text(w)).not.toContain('Something from the previous release');
    expect(text(w)).toContain('v0.6.7 → v0.6.8');
    w.unmount();
  });

  it('a failing feed still leaves a working update dialog', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { d, w } = await openReady();
    expect(w.find('.change-list').exists()).toBe(false);
    expect(warn).toHaveBeenCalledWith('[Update] release notes unavailable:', 'offline');
    await w.find('.download-btn').trigger('click');
    expect(d.api.install).toHaveBeenCalledWith({ force: false });
    warn.mockRestore();
    w.unmount();
  });

  it('Escape and a click on the backdrop are Later; a click inside is not', async () => {
    feed([release068]);
    let { w } = await openReady();
    await w.find('.update-dialog').trigger('click');
    expect(anyUpdateUi(w)).toBe(true);
    await w.find('.update-dialog').trigger('keydown', { key: 'Escape' });
    expect(anyUpdateUi(w)).toBe(false);
    w.unmount();
    ({ w } = await openReady());
    await w.find('.update-overlay').trigger('click');
    expect(anyUpdateUi(w)).toBe(false);
    w.unmount();
  });

  it('moves focus to the primary action when it opens', async () => {
    feed([release068]);
    const { w } = await openReady();
    expect(document.activeElement).toBe(w.find('.download-btn').element);
    w.unmount();
  });

  it('the download notice shows the notes for the version on offer', async () => {
    feed([{ ...release068, version: '9.9.9', title: 'Future — AGNT v9.9.9' }]);
    desktop({ enabled: false, phase: 'disabled' });
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(w.find('[data-testid="update-notice"]').exists()).toBe(true);
    expect(text(w)).toContain('Update available');
    expect(text(w)).toContain('Future');
    expect(w.findAll('.change-group li')).toHaveLength(4);
  });
});

// The toolbar's "update" pill used to be written only by NewsPanel, so it
// appeared only after someone opened Settings. This component is always
// mounted (App.vue) and is now its one writer, on both update paths.
describe('the toolbar update pill', () => {
  it('is published from the agnt.gg notice path', async () => {
    electronMock = null;
    globalThis.fetch = vi.fn(async (u) => ({ json: async () => (String(u).endsWith('/version') ? { version: '0.6.6' } : { updateAvailable: true, latestVersion: '0.6.7', currentVersion: '0.6.6' }) }));
    const dispatch = vi.fn();
    mount(UpdateNotification, { global: { provide: { store: { dispatch } } } });
    await flushPromises();
    expect(dispatch).toHaveBeenLastCalledWith('shell/setUpdateAvailable', { version: '0.6.7' });
  });

  it('is published from the self-updating desktop path, and cleared when there is none', async () => {
    const d = desktop();
    const dispatch = vi.fn();
    mount(UpdateNotification, { global: { provide: { store: { dispatch } } } });
    await flushPromises();
    expect(dispatch).toHaveBeenLastCalledWith('shell/setUpdateAvailable', null);
    d.push({ phase: 'ready', available: { version: '0.6.8' } });
    await flushPromises();
    expect(dispatch).toHaveBeenLastCalledWith('shell/setUpdateAvailable', { version: '0.6.8' });
  });

  it('mounts without a store (the publisher is optional)', async () => {
    electronMock = null;
    expect(() => mount(UpdateNotification)).not.toThrow();
    await flushPromises();
  });
});
