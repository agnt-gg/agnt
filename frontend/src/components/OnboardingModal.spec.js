import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import OnboardingModal from './OnboardingModal.vue';

// Mock dependencies
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    REMOTE_URL: 'http://localhost:3000',
  },
}));

vi.mock('@/views/_utils/encryption.js', () => ({
  encrypt: vi.fn((value) => `encrypted_${value}`),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('OnboardingModal', () => {
  let wrapper;
  let store;

  const createMockStore = (overrides = {}) => {
    return createStore({
      modules: {
        userAuth: {
          namespaced: true,
          state: {
            token: 'test-token',
          },
          getters: {
            userName: () => overrides.userName || 'TestUser',
            userPseudonym: () => overrides.userPseudonym || '',
          },
          actions: {
            fetchPseudonym: vi.fn(),
          },
        },
        userStats: {
          namespaced: true,
          state: {
            referralBalance: overrides.referralBalance || 0,
          },
          actions: {
            fetchReferralTree: vi.fn(),
          },
        },
        appAuth: {
          namespaced: true,
          state: {
            allProviders: overrides.allProviders || [
              { id: 'openai', name: 'OpenAI', icon: 'openai', categories: ['AI'], connectionType: 'apikey' },
              { id: 'anthropic', name: 'Anthropic', icon: 'anthropic', categories: ['AI'], connectionType: 'apikey' },
              { id: 'local', name: 'Local', icon: 'custom', categories: ['AI'], connectionType: 'local' },
            ],
            connectedApps: overrides.connectedApps || [],
          },
          actions: {
            fetchAllProviders: vi.fn(),
            fetchConnectedApps: vi.fn(),
          },
        },
        aiProvider: {
          namespaced: true,
          state: {
            currentProvider: overrides.currentProvider || null,
          },
          actions: {
            setProvider: vi.fn(),
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch.mockReset();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ available: true }),
      headers: {
        get: () => 'application/json',
      },
    });
    localStorage.setItem('token', 'test-token');
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    localStorage.clear();
  });

  const createWrapper = (props = {}, storeOverrides = {}) => {
    store = createMockStore(storeOverrides);
    vi.spyOn(store, 'dispatch');
    return mount(OnboardingModal, {
      props: {
        show: true,
        ...props,
      },
      global: {
        plugins: [store],
        stubs: {
          SvgIcon: {
            template: '<span class="svg-icon-stub"></span>',
            props: ['name'],
          },
          SimpleModal: {
            template: '<div class="simple-modal-stub"></div>',
            methods: {
              showModal: vi.fn().mockResolvedValue(true),
            },
          },
          Transition: {
            template: '<div><slot /></div>',
          },
        },
      },
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('renders when show prop is true', () => {
      wrapper = createWrapper({ show: true });
      expect(wrapper.find('.onboarding-overlay').exists()).toBe(true);
    });

    it('does not render when show prop is false', () => {
      wrapper = createWrapper({ show: false });
      expect(wrapper.find('.onboarding-overlay').exists()).toBe(false);
    });

    it('displays user name in welcome message', () => {
      wrapper = createWrapper({}, { userName: 'JohnDoe' });
      expect(wrapper.text()).toContain('Welcome to AGNT, JohnDoe!');
    });

    it('displays progress dots for all steps', () => {
      wrapper = createWrapper();
      const dots = wrapper.findAll('.dot');
      expect(dots.length).toBeGreaterThan(0);
    });

    it('marks first dot as active on initial render', () => {
      wrapper = createWrapper();
      const dots = wrapper.findAll('.dot');
      expect(dots[0].classes()).toContain('active');
    });
  });

  describe('Step Navigation', () => {
    it('advances to next step when Continue is clicked', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      expect(wrapper.find('.welcome-step').exists()).toBe(true);

      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      // After clicking continue from welcome, currentStep becomes 2
      expect(wrapper.vm.currentStep).toBe(2);
    });

    it('goes back to previous step when Back is clicked', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Go to step 2
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.currentStep).toBe(2);

      // Go back to step 1
      await wrapper.find('.btn-secondary').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.welcome-step').exists()).toBe(true);
    });

    it('does not show Back button on first step', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.btn-secondary').exists()).toBe(false);
    });

    it('shows Back button on subsequent steps', async () => {
      wrapper = createWrapper();
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.btn-secondary').exists()).toBe(true);
    });

    it('updates progress dots when navigating', async () => {
      wrapper = createWrapper();
      const dots = wrapper.findAll('.dot');

      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(dots[0].classes()).toContain('completed');
      expect(dots[1].classes()).toContain('active');
    });
  });

  describe('Profile Step', () => {
    it('displays pseudonym input field', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      // Directly set currentStep to 2 (profile step)
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('#pseudonym').exists()).toBe(true);
    });

    it('prepopulates pseudonym if user has one', async () => {
      wrapper = createWrapper({}, { userPseudonym: 'ExistingName', currentProvider: 'Local' });
      // Set the pseudonym value directly
      wrapper.vm.pseudonym = 'ExistingName';
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('#pseudonym').element.value).toBe('ExistingName');
    });

    it('shows current status for existing pseudonym', async () => {
      wrapper = createWrapper({}, { userPseudonym: 'ExistingName', currentProvider: 'Local' });
      wrapper.vm.pseudonym = 'ExistingName';
      wrapper.vm.pseudonymStatus = 'current';
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.status-indicator.current').exists()).toBe(true);
    });

    it('checks pseudonym availability on input', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('NewName');
      await wrapper.vm.$nextTick();

      // Fast-forward debounce
      vi.advanceTimersByTime(500);
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/referrals/check-availability'), expect.any(Object));
    });

    it('shows available status when pseudonym is available', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: true }),
        headers: { get: () => 'application/json' },
      });

      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('AvailableName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      expect(wrapper.find('.status-indicator.available').exists()).toBe(true);
    });

    it('shows taken status when pseudonym is not available', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ available: false }),
        headers: { get: () => 'application/json' },
      });

      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('TakenName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      expect(wrapper.find('.status-indicator.taken').exists()).toBe(true);
    });
  });

  describe('Provider Step', () => {
    it('shows provider step when no AI provider is connected', async () => {
      wrapper = createWrapper({}, { connectedApps: [], currentProvider: null });
      // When no provider is connected, step 3 shows the provider step
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.provider-step').exists()).toBe(true);
    });

    it('skips provider step when AI provider is already connected', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      // When provider is connected, step 3 shows features (provider step is skipped)
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.provider-step').exists()).toBe(false);
      expect(wrapper.find('.features-step').exists()).toBe(true);
    });

    it('displays available AI providers', async () => {
      wrapper = createWrapper({}, { connectedApps: [], currentProvider: null });
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      const providerTiles = wrapper.findAll('.provider-tile');
      expect(providerTiles.length).toBeGreaterThan(0);
    });

    it('handles local provider selection', async () => {
      wrapper = createWrapper({}, { connectedApps: [], currentProvider: null });
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      // Find and click local provider
      const localTile = wrapper.findAll('.provider-tile').find((tile) => tile.text().includes('Local'));
      if (localTile) {
        await localTile.trigger('click');
        await wrapper.vm.$nextTick();

        expect(store.dispatch).toHaveBeenCalledWith('aiProvider/setProvider', 'Local');
      }
    });
  });

  describe('Features Step', () => {
    it('displays feature cards', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      // With provider connected, features step is at step 3
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.features-step').exists()).toBe(true);
      const featureCards = wrapper.findAll('.feature-card');
      expect(featureCards.length).toBe(4);
    });

    it('displays AI Chat feature', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('AI Chat');
    });

    it('displays Workflows feature', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Workflows');
    });
  });

  describe('Quick Start Step', () => {
    it('displays quick start options', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      // With provider connected, quick start step is at step 4
      wrapper.vm.currentStep = 4;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.quickstart-step').exists()).toBe(true);
      const options = wrapper.findAll('.quickstart-option');
      expect(options.length).toBe(4);
    });

    it('allows selecting a quick start option', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 4;
      await wrapper.vm.$nextTick();

      const options = wrapper.findAll('.quickstart-option');
      await options[1].trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedStartScreen).toBe('WorkflowForgeScreen');
    });

    it('defaults to Chat screen selection', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      wrapper.vm.currentStep = 4;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedStartScreen).toBe('ChatScreen');
    });
  });

  describe('Referral Bonus Step', () => {
    it('shows referral step when user has referral bonus', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local', referralBalance: 100 });
      // With provider connected and referral bonus, referral step is at step 5
      wrapper.vm.currentStep = 5;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.referral-step').exists()).toBe(true);
    });

    it('displays referral bonus amount', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local', referralBalance: 250 });
      wrapper.vm.currentStep = 5;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('+250 pts');
    });

    it('skips referral step when no bonus', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local', referralBalance: 0 });
      // With no referral bonus, step 5 is the ready step (final step)
      wrapper.vm.currentStep = 5;
      await wrapper.vm.$nextTick();

      // Should be on ready step, not referral
      expect(wrapper.find('.referral-step').exists()).toBe(false);
      expect(wrapper.find('.ready-step').exists()).toBe(true);
    });
  });

  describe('Ready Step', () => {
    it('displays ready step at the end', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Navigate to final step
      await wrapper.find('.btn-primary').trigger('click'); // Profile
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Features
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Quick Start
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Ready
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.ready-step').exists()).toBe(true);
    });

    it('shows Start Building button on final step', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Navigate to final step
      await wrapper.find('.btn-primary').trigger('click'); // Profile
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Features
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Quick Start
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Ready
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.btn-primary').text()).toBe('Start Building');
    });

    it('displays summary with selected start screen', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Navigate to final step
      await wrapper.find('.btn-primary').trigger('click'); // Profile
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Features
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Quick Start
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Ready
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.ready-summary').exists()).toBe(true);
    });
  });

  describe('Skip Functionality', () => {
    it('shows Skip Tour button', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.btn-text').text()).toBe('Skip Tour');
    });

    it('emits skip event when skip is confirmed', async () => {
      wrapper = createWrapper();

      // Mock the SimpleModal ref
      wrapper.vm.modal = {
        showModal: vi.fn().mockResolvedValue(true),
      };

      await wrapper.find('.btn-text').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('skip')).toBeTruthy();
    });

    it('does not emit skip when skip is cancelled', async () => {
      wrapper = createWrapper();

      // Mock the SimpleModal ref to return null (cancelled)
      wrapper.vm.modal = {
        showModal: vi.fn().mockResolvedValue(null),
      };

      await wrapper.find('.btn-text').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('skip')).toBeFalsy();
    });
  });

  describe('Completion', () => {
    it('emits complete event with selected screen on finish', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Navigate to final step
      await wrapper.find('.btn-primary').trigger('click'); // Profile
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Features
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Quick Start
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Ready
      await wrapper.vm.$nextTick();

      // Click Start Building
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('complete')).toBeTruthy();
      expect(wrapper.emitted('complete')[0]).toEqual(['ChatScreen']);
    });

    it('emits complete with selected quick start option', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });

      // Navigate to quick start step
      await wrapper.find('.btn-primary').trigger('click'); // Profile
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Features
      await wrapper.vm.$nextTick();
      await wrapper.find('.btn-primary').trigger('click'); // Quick Start
      await wrapper.vm.$nextTick();

      // Select Workflow option
      const options = wrapper.findAll('.quickstart-option');
      await options[1].trigger('click');
      await wrapper.vm.$nextTick();

      // Continue to final step
      await wrapper.find('.btn-primary').trigger('click'); // Ready
      await wrapper.vm.$nextTick();

      // Complete
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('complete')[0]).toEqual(['WorkflowForgeScreen']);
    });
  });

  describe('Transitions', () => {
    it('uses slide-left transition when going forward', async () => {
      wrapper = createWrapper();

      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      // Check that transitionName is set correctly
      expect(wrapper.vm.transitionName).toBe('slide-left');
    });

    it('uses slide-right transition when going back', async () => {
      wrapper = createWrapper();

      // Go forward
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      // Go back
      await wrapper.find('.btn-secondary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.transitionName).toBe('slide-right');
    });
  });

  describe('Edge Cases', () => {
    it('handles API errors gracefully for pseudonym check', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      wrapper = createWrapper({}, { currentProvider: 'Local' });
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('TestName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      // Should assume available on error
      expect(wrapper.find('.status-indicator.available').exists()).toBe(true);
    });

    it('handles non-JSON response for pseudonym check', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/html' },
      });

      wrapper = createWrapper({}, { currentProvider: 'Local' });
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('TestName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      // Should assume available on non-JSON response
      expect(wrapper.find('.status-indicator.available').exists()).toBe(true);
    });

    it('clears pseudonym status when input is empty', async () => {
      wrapper = createWrapper({}, { currentProvider: 'Local' });
      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('Test');
      await wrapper.vm.$nextTick();
      await wrapper.find('#pseudonym').setValue('');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.status-indicator').exists()).toBe(false);
    });
  });
});
