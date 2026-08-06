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

// The workspace step reads/writes the file-tree root through this service.
vi.mock('@/services/fileSystemService.js', () => ({
  getSettings: vi.fn(() =>
    Promise.resolve({
      defaultRoot: '/home/user/agnt-workspace',
      workspaceRoot: '/home/user/agnt-workspace',
    })
  ),
  updateSettings: vi.fn(() => Promise.resolve({ success: true })),
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
        theme: {
          namespaced: true,
          state: { currentTheme: overrides.currentTheme || 'dark' },
          getters: {
            currentTheme: (state) => state.currentTheme,
          },
          actions: {
            setTheme: vi.fn(),
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

  describe('provider grid ordering', () => {
    /**
     * The grid must be alphabetical BY WHAT IT RENDERS. It used to sort by the
     * auth API's `name`, so `openai-codex` — labelled "ChatGPT" — sorted as
     * "OpenAI Codex" and appeared under O between the OpenAI providers, where
     * nobody scanning for a C would find it.
     *
     * Asserted on the computed rather than the DOM so it holds regardless of
     * which onboarding step happens to be showing.
     */
    const PROVIDERS = [
      { id: 'openai', name: 'OpenAI', icon: 'openai', categories: ['AI'], connectionType: 'apikey' },
      { id: 'openai-codex', name: 'OpenAI Codex', icon: 'openai', categories: ['AI'], connectionType: 'oauth' },
      { id: 'openrouter', name: 'OpenRouter', icon: 'openrouter', categories: ['AI'], connectionType: 'apikey' },
      { id: 'cerebras', name: 'Cerebras', icon: 'cerebras', categories: ['AI'], connectionType: 'apikey' },
      { id: 'chutes', name: 'Chutes', icon: 'chutes', categories: ['AI'], connectionType: 'apikey' },
      { id: 'anthropic', name: 'Anthropic', icon: 'anthropic', categories: ['AI'], connectionType: 'apikey' },
    ];

    const renderedOrder = () => {
      wrapper = createWrapper({}, { allProviders: PROVIDERS });
      return wrapper.vm.aiProviders.map((p) => wrapper.vm.providerLabel(p));
    };

    it('lists providers alphabetically by their rendered label', () => {
      expect(renderedOrder()).toEqual([
        'Anthropic',
        'Cerebras',
        'ChatGPT',
        'Chutes',
        'OpenAI',
        'OpenRouter',
      ]);
    });

    it('puts ChatGPT in the C group, not down among the OpenAIs', () => {
      const order = renderedOrder();
      expect(order.indexOf('ChatGPT')).toBeLessThan(order.indexOf('OpenAI'));
      expect(order.indexOf('ChatGPT')).toBeGreaterThan(order.indexOf('Cerebras'));
    });

    it('renders the tile text from the same function it sorts by', () => {
      // The sort key and the visible text drifting apart is the whole bug; if
      // the template ever re-derives its own label this fails.
      wrapper = createWrapper({}, { allProviders: PROVIDERS });
      const codex = wrapper.vm.aiProviders.find((p) => p.id === 'openai-codex');
      expect(wrapper.vm.providerLabel(codex)).toBe('ChatGPT');
    });
  });

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
      wrapper = createWrapper();
      expect(wrapper.find('.welcome-step').exists()).toBe(true);

      await wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      // After clicking continue from welcome, currentStep becomes 2
      expect(wrapper.vm.currentStep).toBe(2);
    });

    it('goes back to previous step when Back is clicked', async () => {
      wrapper = createWrapper();

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

  // Flow (see totalSteps in OnboardingModal.vue):
  //   1 Welcome | 2 Theme | 3 Profile | 4 Provider | 5 Workspace
  //   6 Referral (only when referralBalance > 0) | finalStep = Ready
  // finalStep is 6 without a referral bonus and 7 with one.
  const CONNECTED = { connectedApps: ['openai'] };

  describe('Theme Step', () => {
    it('renders the theme picker on step 2', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.theme-step').exists()).toBe(true);
      expect(wrapper.findAll('.theme-tile').length).toBe(wrapper.vm.availableThemes.length);
    });

    it('marks the current theme as active', async () => {
      wrapper = createWrapper({}, { currentTheme: 'nord' });
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      const active = wrapper.findAll('.theme-tile').filter((t) => t.classes().includes('active'));
      expect(active.length).toBe(1);
      expect(active[0].text()).toContain('Nord');
    });

    it('dispatches theme/setTheme when a tile is clicked', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentStep = 2;
      await wrapper.vm.$nextTick();

      await wrapper.findAll('.theme-tile')[1].trigger('click');

      expect(store.dispatch).toHaveBeenCalledWith('theme/setTheme', wrapper.vm.availableThemes[1].id);
    });
  });

  describe('Profile Step', () => {
    const gotoProfile = async () => {
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();
    };

    it('displays pseudonym input field', async () => {
      wrapper = createWrapper();
      await gotoProfile();
      expect(wrapper.find('#pseudonym').exists()).toBe(true);
    });

    it('prepopulates pseudonym if user has one', async () => {
      wrapper = createWrapper({}, { userPseudonym: 'ExistingName' });
      wrapper.vm.pseudonym = 'ExistingName';
      await gotoProfile();

      expect(wrapper.find('#pseudonym').element.value).toBe('ExistingName');
    });

    it('shows current status for existing pseudonym', async () => {
      wrapper = createWrapper({}, { userPseudonym: 'ExistingName' });
      wrapper.vm.pseudonym = 'ExistingName';
      wrapper.vm.pseudonymStatus = 'current';
      await gotoProfile();

      expect(wrapper.find('.status-indicator.current').exists()).toBe(true);
    });

    it('checks pseudonym availability on input', async () => {
      wrapper = createWrapper();
      await gotoProfile();

      await wrapper.find('#pseudonym').setValue('NewName');
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

      wrapper = createWrapper();
      await gotoProfile();

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

      wrapper = createWrapper();
      await gotoProfile();

      await wrapper.find('#pseudonym').setValue('TakenName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      expect(wrapper.find('.status-indicator.taken').exists()).toBe(true);
    });
  });

  describe('Provider Step', () => {
    const gotoProvider = async () => {
      wrapper.vm.currentStep = 4;
      await wrapper.vm.$nextTick();
    };

    it('shows the provider step on step 4', async () => {
      wrapper = createWrapper({}, { connectedApps: [] });
      await gotoProvider();
      expect(wrapper.find('.provider-step').exists()).toBe(true);
    });

    it('displays available AI providers', async () => {
      wrapper = createWrapper({}, { connectedApps: [] });
      await gotoProvider();
      expect(wrapper.findAll('.provider-tile').length).toBeGreaterThan(0);
    });

    it('marks connected providers and reports hasAnyProviderConnected', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoProvider();

      expect(wrapper.vm.hasAnyProviderConnected).toBe(true);
      expect(wrapper.vm.isProviderConnected('openai')).toBe(true);
      expect(wrapper.findAll('.provider-tile.connected').length).toBe(1);
    });

    it('blocks Continue until a provider is connected', async () => {
      wrapper = createWrapper({}, { connectedApps: [] });
      await gotoProvider();

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      // An AI provider is required, so the step must not advance.
      expect(wrapper.vm.currentStep).toBe(4);
    });

    it('advances past the provider step once one is connected', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoProvider();

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.vm.currentStep).toBe(5);
    });
  });

  describe('Workspace Step', () => {
    it('shows the workspace folder input on step 5', async () => {
      wrapper = createWrapper({}, CONNECTED);
      wrapper.vm.currentStep = 5;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.workspace-step').exists()).toBe(true);
      expect(wrapper.find('#workspaceRoot').exists()).toBe(true);
    });

    it('loads the current workspace root as the default hint', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await flushPromises();
      wrapper.vm.currentStep = 5;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.defaultWorkspaceRoot).toBe('/home/user/agnt-workspace');
    });
  });

  describe('Referral Bonus Step', () => {
    it('adds a referral step and shows it when the user has a bonus', async () => {
      wrapper = createWrapper({}, { ...CONNECTED, referralBalance: 100 });
      expect(wrapper.vm.totalSteps).toBe(7);

      wrapper.vm.currentStep = 6;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.referral-step').exists()).toBe(true);
    });

    it('displays referral bonus amount', async () => {
      wrapper = createWrapper({}, { ...CONNECTED, referralBalance: 250 });
      wrapper.vm.currentStep = 6;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('+250 pts');
    });

    it('omits the referral step when there is no bonus', async () => {
      wrapper = createWrapper({}, { ...CONNECTED, referralBalance: 0 });
      expect(wrapper.vm.totalSteps).toBe(6);

      wrapper.vm.currentStep = 6;
      await wrapper.vm.$nextTick();

      // Step 6 is the final (ready) step when no bonus step is inserted.
      expect(wrapper.find('.referral-step').exists()).toBe(false);
      expect(wrapper.find('.ready-step').exists()).toBe(true);
    });
  });

  describe('Ready Step', () => {
    const gotoFinal = async () => {
      wrapper.vm.currentStep = wrapper.vm.finalStep;
      await wrapper.vm.$nextTick();
    };

    it('displays the ready step at the end', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoFinal();
      expect(wrapper.find('.ready-step').exists()).toBe(true);
    });

    it('shows Start Building button on final step', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoFinal();
      expect(wrapper.find('.btn-primary').text()).toBe('Start Building');
    });

    it('hides Skip Tour on the final step', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoFinal();
      expect(wrapper.find('.btn-text').exists()).toBe(false);
    });

    it('displays the summary', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await gotoFinal();
      expect(wrapper.find('.ready-summary').exists()).toBe(true);
    });

    it('is reachable by clicking Continue through every step', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await flushPromises();

      for (let i = 1; i < wrapper.vm.finalStep; i++) {
        await wrapper.find('.btn-primary').trigger('click');
        await flushPromises();
      }

      expect(wrapper.vm.currentStep).toBe(wrapper.vm.finalStep);
      expect(wrapper.find('.ready-step').exists()).toBe(true);
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
    it('emits complete with ChatScreen when Start Building is clicked', async () => {
      wrapper = createWrapper({}, { connectedApps: ['openai'] });
      wrapper.vm.currentStep = wrapper.vm.finalStep;
      await wrapper.vm.$nextTick();

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('complete')).toBeTruthy();
      expect(wrapper.emitted('complete')[0]).toEqual(['ChatScreen']);
    });

    it('persists a changed workspace root before completing', async () => {
      const { updateSettings } = await import('@/services/fileSystemService.js');
      updateSettings.mockClear();

      wrapper = createWrapper({}, { connectedApps: ['openai'] });
      await flushPromises();

      wrapper.vm.workspaceRoot = '/home/user/custom-root';
      wrapper.vm.currentStep = wrapper.vm.finalStep;
      await wrapper.vm.$nextTick();

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(updateSettings).toHaveBeenCalledWith('/home/user/custom-root');
      expect(wrapper.emitted('complete')).toBeTruthy();
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

      wrapper = createWrapper();
      wrapper.vm.currentStep = 3;
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

      wrapper = createWrapper();
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('TestName');
      vi.advanceTimersByTime(500);
      await flushPromises();

      // Should assume available on non-JSON response
      expect(wrapper.find('.status-indicator.available').exists()).toBe(true);
    });

    it('clears pseudonym status when input is empty', async () => {
      wrapper = createWrapper();
      wrapper.vm.currentStep = 3;
      await wrapper.vm.$nextTick();

      await wrapper.find('#pseudonym').setValue('Test');
      await wrapper.vm.$nextTick();
      await wrapper.find('#pseudonym').setValue('');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.status-indicator').exists()).toBe(false);
    });
  });
});
