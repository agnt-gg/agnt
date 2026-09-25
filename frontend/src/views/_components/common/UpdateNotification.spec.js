import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

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

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async () => ({ json: async () => ({}) }));
});
afterEach(() => {
  electronMock = null;
});

describe('self-updating desktop build', () => {
  it('idle shows nothing, and never the agnt.gg Download notice', async () => {
    const d = desktop();
    const w = mount(UpdateNotification);
    await flushPromises();
    expect(w.find('.update-banner').exists()).toBe(false);
    expect(electronMock.checkForUpdates).not.toHaveBeenCalled();
    d.push({ phase: 'checking' });
    await flushPromises();
    expect(w.find('.update-banner').exists()).toBe(false);
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
    expect(w.find('.update-banner').exists()).toBe(false);
    d.push({ phase: 'ready', available: { version: '0.6.8' } });
    await flushPromises();
    expect(w.find('.update-banner').exists()).toBe(false);
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
    expect(w.find('.update-banner').exists()).toBe(false);
  });
});
