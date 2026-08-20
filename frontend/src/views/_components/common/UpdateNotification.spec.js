import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import UpdateNotification from './UpdateNotification.vue';

// Mock the config
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    BASE_URL: 'http://localhost:3000',
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('UpdateNotification', () => {
  let wrapper;
  let mockElectron;

  beforeEach(() => {
    vi.useFakeTimers();

    // Setup mock electron object
    mockElectron = {
      getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
      checkForUpdates: vi.fn().mockResolvedValue({
        updateAvailable: false,
        latestVersion: '1.0.0',
      }),
      openDownloadPage: vi.fn(),
      onUpdateAvailable: vi.fn(),
    };

    // Reset fetch mock
    global.fetch.mockReset();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '1.0.0' }),
    });

    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    delete window.electron;
    localStorage.clear();
  });

  const createWrapper = (withElectron = true) => {
    if (withElectron) {
      window.electron = mockElectron;
    } else {
      delete window.electron;
    }

    return mount(UpdateNotification, {
      global: {
        stubs: {
          Transition: false,
        },
      },
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('does not show banner initially when no update available', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(false);
    });

    it('shows banner when update is available', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(true);
    });

    it('displays current and new version numbers', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('v1.0.0');
      expect(wrapper.text()).toContain('v2.0.0');
    });

    it('displays update icon', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-icon').text()).toBe('🚀');
    });

    it('displays "Update Available" title', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-title').text()).toBe('Update Available');
    });

    it('displays Download and Later buttons', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.download-btn').text()).toBe('Download');
      expect(wrapper.find('.dismiss-btn').text()).toBe('Later');
    });
  });

  describe('Version Detection', () => {
    it('gets version from Electron when available', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockElectron.getAppVersion).toHaveBeenCalled();
    });

    it('falls back to API when Electron version fails', async () => {
      mockElectron.getAppVersion.mockRejectedValue(new Error('Not available'));

      wrapper = createWrapper();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/version');
    });

    it('uses API version when Electron is not available', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ version: '1.5.0' }),
      });

      wrapper = createWrapper(false);
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/version');
    });
  });

  describe('Update Check', () => {
    it('checks for updates via Electron when available', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockElectron.checkForUpdates).toHaveBeenCalled();
    });

    it('falls back to backend API when Electron check fails', async () => {
      mockElectron.checkForUpdates.mockRejectedValue(new Error('Failed'));
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              updateAvailable: true,
              latestVersion: '2.0.0',
            }),
        });

      wrapper = createWrapper();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/updates/check');
    });

    it('uses backend API when Electron is not available', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              updateAvailable: true,
              latestVersion: '2.0.0',
            }),
        });

      wrapper = createWrapper(false);
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/updates/check');
    });
  });

  describe('Download Action', () => {
    it('opens download page via Electron when clicked', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('.download-btn').trigger('click');

      expect(mockElectron.openDownloadPage).toHaveBeenCalled();
    });

    it('opens download URL in browser when Electron not available', async () => {
      const mockOpen = vi.fn();
      window.open = mockOpen;

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              updateAvailable: true,
              latestVersion: '2.0.0',
            }),
        });

      wrapper = createWrapper(false);
      await flushPromises();

      await wrapper.find('.download-btn').trigger('click');

      expect(mockOpen).toHaveBeenCalledWith('https://agnt.gg/downloads', '_blank');
    });

    it('hides banner after clicking download', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(true);

      await wrapper.find('.download-btn').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(false);
    });
  });

  describe('Dismiss Action', () => {
    it('hides banner when Later is clicked', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(true);

      await wrapper.find('.dismiss-btn').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(false);
    });

    it('stores dismissed version in localStorage', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('.dismiss-btn').trigger('click');

      expect(localStorage.getItem('agnt_dismissed_update')).toBe('2.0.0');
    });

    it('does not show banner for previously dismissed version', async () => {
      localStorage.setItem('agnt_dismissed_update', '2.0.0');

      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(false);
    });

    it('shows banner for new version after dismissing old one', async () => {
      localStorage.setItem('agnt_dismissed_update', '2.0.0');

      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '3.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(true);
    });
  });

  describe('Manual Update Check', () => {
    it('exposes checkNow method', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(typeof wrapper.vm.checkNow).toBe('function');
    });

    it('checkNow triggers update check and shows banner', async () => {
      mockElectron.checkForUpdates
        .mockResolvedValueOnce({
          updateAvailable: false,
          latestVersion: '1.0.0',
        })
        .mockResolvedValueOnce({
          updateAvailable: true,
          latestVersion: '2.0.0',
        });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(false);

      await wrapper.vm.checkNow();
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(true);
    });

    it('checkNow returns null when Electron not available', async () => {
      wrapper = createWrapper(false);
      await flushPromises();

      const result = await wrapper.vm.checkNow();

      expect(result).toBe(null);
    });

    it('checkNow returns update result', async () => {
      const updateResult = {
        updateAvailable: true,
        latestVersion: '2.0.0',
      };
      mockElectron.checkForUpdates.mockResolvedValue(updateResult);

      wrapper = createWrapper();
      await flushPromises();

      const result = await wrapper.vm.checkNow();

      expect(result).toEqual(updateResult);
    });
  });

  describe('Update Notification Listener', () => {
    it('registers update listener when Electron available', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockElectron.onUpdateAvailable).toHaveBeenCalled();
    });

    it('shows banner when update notification received', async () => {
      let updateCallback;
      mockElectron.onUpdateAvailable.mockImplementation((callback) => {
        updateCallback = callback;
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(false);

      // Simulate update notification
      updateCallback({ latestVersion: '2.0.0' });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(true);
    });

    it('does not show banner from listener if already dismissed', async () => {
      let updateCallback;
      mockElectron.onUpdateAvailable.mockImplementation((callback) => {
        updateCallback = callback;
      });

      wrapper = createWrapper();
      await flushPromises();

      // First show and dismiss
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });
      await wrapper.vm.checkNow();
      await wrapper.vm.$nextTick();

      await wrapper.find('.dismiss-btn').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(false);

      // Try to show via listener - should not show because dismissed
      updateCallback({ latestVersion: '2.0.0' });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-banner').exists()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('handles Electron version error gracefully', async () => {
      mockElectron.getAppVersion.mockRejectedValue(new Error('Failed'));

      wrapper = createWrapper();
      await flushPromises();

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });

    it('handles update check error gracefully', async () => {
      mockElectron.checkForUpdates.mockRejectedValue(new Error('Failed'));
      global.fetch.mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();
      await flushPromises();

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });

    it('handles API version error gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper(false);
      await flushPromises();

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('desktop auto-update', () => {
    /**
     * The banner used to have exactly one job: send the user to a browser. Now
     * the desktop build downloads the update itself, so the banner has to tell
     * the difference between "go and fetch this" and "it is already here".
     *
     * Everything here is feature-detected on `electron.autoUpdate`, which
     * browser and Docker users do not have — the tests above run without it and
     * must keep passing unchanged, which is what proves the fallback survives.
     */
    let onDownloaded;
    let onProgress;

    const withAutoUpdate = (install = vi.fn().mockResolvedValue({ ok: true })) => {
      mockElectron.autoUpdate = {
        status: vi.fn().mockResolvedValue({ enabled: true }),
        install,
        onDownloaded: vi.fn((cb) => {
          onDownloaded = cb;
          return vi.fn();
        }),
        onProgress: vi.fn((cb) => {
          onProgress = cb;
          return vi.fn();
        }),
      };
      return install;
    };

    it('shows progress while downloading, with nothing to click', async () => {
      withAutoUpdate();
      wrapper = createWrapper();
      await flushPromises();

      onProgress({ percent: 42 });
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Downloading Update');
      expect(wrapper.text()).toContain('42%');
      // A live button before the file exists is a button that fails.
      expect(wrapper.find('.download-btn').exists()).toBe(false);
    });

    it('offers a RESTART once the update is downloaded, not a download', async () => {
      withAutoUpdate();
      wrapper = createWrapper();
      await flushPromises();

      onDownloaded({ version: '2.0.0', needsExplicitInstall: true });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.update-title').text()).toBe('Update Ready');
      expect(wrapper.find('.download-btn').text()).toBe('Restart to update');
    });

    it('a ready update outranks an available one', async () => {
      // Otherwise the user is sent to a browser to fetch a file already on disk.
      mockElectron.checkForUpdates.mockResolvedValue({ updateAvailable: true, latestVersion: '2.0.0' });
      withAutoUpdate();
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('.update-title').text()).toBe('Update Available');

      onDownloaded({ version: '2.0.0', needsExplicitInstall: true });
      await wrapper.vm.$nextTick();

      // `find` would return whichever banner is first in the DOM, and during
      // the leave transition that is still the OLD one — an assertion that
      // fails for a reason unrelated to the behaviour under test.
      const titles = wrapper.findAll('.update-title').map((t) => t.text());
      expect(titles).toContain('Update Ready');
      expect(wrapper.text()).toContain('Restart to update');
    });

    it('asks main to install when the button is pressed', async () => {
      const install = withAutoUpdate();
      wrapper = createWrapper();
      await flushPromises();

      onDownloaded({ version: '2.0.0', needsExplicitInstall: true });
      await wrapper.vm.$nextTick();
      await wrapper.find('.download-btn').trigger('click');
      await flushPromises();

      expect(install).toHaveBeenCalled();
      // Never the browser: the file is already downloaded.
      expect(mockElectron.openDownloadPage).not.toHaveBeenCalled();
    });

    it('explains a refusal the user can act on', async () => {
      // Main refuses to restart while a goal is executing. Saying so turns a
      // dead button into an instruction.
      const install = vi.fn().mockResolvedValue({ ok: false, reason: 'goal-running', goals: 2 });
      withAutoUpdate(install);
      wrapper = createWrapper();
      await flushPromises();

      onDownloaded({ version: '2.0.0', needsExplicitInstall: true });
      await wrapper.vm.$nextTick();
      await wrapper.find('.download-btn').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('2 goals still running');
      // Still pressable once the goals finish.
      expect(wrapper.find('.download-btn').attributes('disabled')).toBeUndefined();
    });

    it('ANTI-VACUITY: without the bridge the old download banner is unchanged', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({ updateAvailable: true, latestVersion: '2.0.0' });
      delete mockElectron.autoUpdate;
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.download-btn').text()).toBe('Download');
    });
  });

  describe('Styling', () => {
    it('has correct CSS classes on banner', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.update-banner').exists()).toBe(true);
      expect(wrapper.find('.update-content').exists()).toBe(true);
      expect(wrapper.find('.update-actions').exists()).toBe(true);
    });

    it('has correct button classes', async () => {
      mockElectron.checkForUpdates.mockResolvedValue({
        updateAvailable: true,
        latestVersion: '2.0.0',
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.download-btn').classes()).toContain('update-btn');
      expect(wrapper.find('.dismiss-btn').classes()).toContain('update-btn');
    });
  });
});
