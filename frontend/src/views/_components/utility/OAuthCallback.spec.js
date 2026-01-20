import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import OAuthCallback from './OAuthCallback.vue';

// Mock the config
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    REMOTE_URL: 'http://localhost:3000',
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('OAuthCallback', () => {
  let wrapper;
  let originalLocation;
  let originalOpener;

  beforeEach(() => {
    vi.useFakeTimers();

    // Reset fetch mock
    global.fetch.mockReset();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => 'test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    // Save original location
    originalLocation = window.location;

    // Mock window.location
    delete window.location;
    window.location = {
      search: '?code=test-code&state=github:test-state',
      origin: 'http://localhost:3000',
    };

    // Save and mock window.opener
    originalOpener = window.opener;
    window.opener = {
      postMessage: vi.fn(),
    };

    // Mock window.close
    window.close = vi.fn();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();

    // Restore original location
    window.location = originalLocation;
    window.opener = originalOpener;
  });

  const createWrapper = () => {
    return mount(OAuthCallback, {
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('renders oauth callback component', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.oauth-callback').exists()).toBe(true);
    });

    it('renders callback content', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.callback-content').exists()).toBe(true);
    });

    it('renders logo', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.logo').exists()).toBe(true);
      expect(wrapper.find('.logo').attributes('src')).toBe('/images/agnt-logo.png');
    });

    it('shows processing status initially', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.status-processing').exists()).toBe(true);
    });

    it('displays processing spinner', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.spinner').exists()).toBe(true);
    });

    it('displays processing message', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Completing authentication...');
    });
  });

  describe('Success State', () => {
    it('shows success status after successful callback', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-success').exists()).toBe(true);
    });

    it('displays success icon', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.success-icon').exists()).toBe(true);
      expect(wrapper.find('.success-icon').text()).toBe('✓');
    });

    it('displays success message', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('Authentication Successful!');
    });

    it('displays provider name in success message', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('Github');
    });

    it('displays closing message', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('This window will close automatically...');
    });

    it('notifies parent window on success', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(window.opener.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'oauth_success',
          provider: 'Github',
        }),
        'http://localhost:3000'
      );
    });

    it('closes window after 2 seconds on success', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(window.close).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);

      expect(window.close).toHaveBeenCalled();
    });
  });

  describe('Error State', () => {
    it('shows error status when URL has error param', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
    });

    it('displays error icon', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.error-icon').exists()).toBe(true);
      expect(wrapper.find('.error-icon').text()).toBe('✕');
    });

    it('displays error message', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain('Authentication Failed');
      expect(wrapper.text()).toContain('access_denied');
    });

    it('shows error when code is missing', async () => {
      window.location.search = '?state=github:test-state';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
      expect(wrapper.text()).toContain('Missing authorization code or state');
    });

    it('shows error when state is missing', async () => {
      window.location.search = '?code=test-code';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
      expect(wrapper.text()).toContain('Missing authorization code or state');
    });

    it('shows error when API call fails', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid code' }),
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
      expect(wrapper.text()).toContain('Invalid code');
    });

    it('shows error when API returns success: false', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
    });

    it('displays close button on error', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.close-button').exists()).toBe(true);
      expect(wrapper.find('.close-button').text()).toBe('Close Window');
    });

    it('closes window when close button is clicked', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      await wrapper.find('.close-button').trigger('click');

      expect(window.close).toHaveBeenCalled();
    });

    it('notifies parent window on error', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(window.opener.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'oauth_error',
          message: 'access_denied',
        }),
        'http://localhost:3000'
      );
    });
  });

  describe('API Call', () => {
    it('sends code and state to backend', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/auth/callback',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({
            code: 'test-code',
            state: 'github:test-state',
          }),
        })
      );
    });

    it('handles network errors gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('.status-error').exists()).toBe(true);
      expect(wrapper.text()).toContain('Network error');
    });
  });

  describe('Provider Name Parsing', () => {
    it('parses provider name from state', async () => {
      window.location.search = '?code=test-code&state=google:test-state';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.providerName).toBe('Google');
    });

    it('capitalizes provider name', async () => {
      window.location.search = '?code=test-code&state=dropbox:test-state';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.providerName).toBe('Dropbox');
    });
  });

  describe('Without Parent Window', () => {
    it('handles missing window.opener gracefully', async () => {
      window.opener = null;

      wrapper = createWrapper();
      await flushPromises();

      // Should not throw
      expect(wrapper.find('.status-success').exists()).toBe(true);
    });
  });

  describe('Component Definition', () => {
    it('has correct component name', () => {
      expect(OAuthCallback.name).toBe('OAuthCallback');
    });
  });

  describe('Status Transitions', () => {
    it('starts with processing status', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.status).toBe('processing');
    });

    it('transitions to success on successful callback', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.status).toBe('success');
    });

    it('transitions to error on failed callback', async () => {
      window.location.search = '?error=access_denied';

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.status).toBe('error');
    });
  });
});
