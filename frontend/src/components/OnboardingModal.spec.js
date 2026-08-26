import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mount, flushPromises } from '@vue/test-utils';

const MODAL_SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'OnboardingModal.vue'),
  'utf8',
);
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

/**
 * The harness scan is stubbed for this suite.
 *
 * It fires a `fetch` on mount, and several tests here queue a response with
 * `mockResolvedValueOnce` BEFORE mounting — a queue that is consumed in call
 * order, not by URL. Letting a real scan run would silently eat the response
 * meant for the pseudonym check, and any future mount-time request would break
 * these tests again for a reason unrelated to what they assert. Stubbing the
 * composable is also the honest scope: this file tests the modal, and the
 * scanner has its own spec.
 *
 * `harnessImportStub` is mutable so a test can say "there IS something to
 * import" and check that the step appears.
 */
const harnessImportStub = {
  detect: vi.fn(),
  // A real ref: the step list is a computed that reads this, and a plain
  // object would not re-evaluate it.
  hasAnythingToImport: ref(false),
  // Enough surface for HarnessImport to render if a test navigates onto it.
  sources: ref([]),
  totals: ref({ sources: 0, skillsSeen: 0, skillsImportable: 0, personas: 0, memories: 0 }),
  offerable: ref([]),
  selectedCount: ref(0),
  running: ref(false),
  result: ref(null),
  error: ref(''),
  toggle: vi.fn(),
  isSelected: () => false,
  run: vi.fn(),
};
vi.mock('@/composables/useHarnessImport.js', () => ({
  useHarnessImport: () => harnessImportStub,
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
    harnessImportStub.detect.mockClear();
    harnessImportStub.hasAnythingToImport.value = false;
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

  /**
   * Navigate to a step BY NAME.
   *
   * Setting `currentStep` to a literal is how these tests used to move around,
   * and it silently lands on a different screen the moment a conditional step
   * is inserted above the target — the test then asserts against whatever
   * happens to be at that index and passes or fails for unrelated reasons.
   */
  const goto = async (w, stepId) => {
    const index = w.vm.steps.indexOf(stepId);
    if (index === -1) {
      throw new Error(`No "${stepId}" step in: ${w.vm.steps.join(', ')}`);
    }
    w.vm.currentStep = index + 1;
    await w.vm.$nextTick();
  };

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

  describe('provider step delegates to ProviderLanes', () => {
    /**
     * The filter, sort, lane split and labelling moved into ProviderLanes.vue,
     * shared with the chat's setup card — those two screens each holding their
     * own copy is what let them disagree about the same list. Ordering and
     * lane membership are covered where they now live: ProviderLanes.spec.js
     * and store/app/providerLanes.spec.js.
     *
     * What is still this component's job, and asserted here: handing the
     * shared component the raw store state, unfiltered, and wiring the two
     * flows it owns back up.
     */
    const PROVIDERS = [
      { id: 'openai', name: 'OpenAI', icon: 'openai', categories: ['AI'], connectionType: 'apikey' },
      { id: 'openai-codex', name: 'OpenAI Codex', icon: 'openai', categories: ['AI'], connectionType: 'oauth' },
      { id: 'cerebras', name: 'Cerebras', icon: 'cerebras', categories: ['AI'], connectionType: 'apikey' },
      { id: 'notes', name: 'Notes', icon: 'notes', categories: ['Productivity'] },
    ];

    // Step 4 is the provider step — see the flow comment below.
    const lanes = async () => {
      wrapper = createWrapper({}, { allProviders: PROVIDERS, connectedApps: ['openai'] });
      wrapper.vm.currentStep = 4;
      await wrapper.vm.$nextTick();
      return wrapper.findComponent({ name: 'ProviderLanes' });
    };

    it('renders no provider tile outside the shared component', async () => {
      const component = await lanes();
      expect(component.exists()).toBe(true);
      // A tile in the modal but not in the child would be the private copy
      // growing back. `.provider-grid` itself is legitimately present — it
      // belongs to the child — so counting ownership is the honest check.
      expect(wrapper.findAll('.provider-tile')).toHaveLength(
        component.findAll('.provider-tile').length,
      );
      expect(component.findAll('.provider-tile').length).toBeGreaterThan(0);
    });

    it('passes store state through untouched, filtering nothing itself', async () => {
      // A second filter here is exactly the drift the shared component ends.
      const component = await lanes();
      expect(component.props('providers')).toEqual(PROVIDERS);
      expect(component.props('connectedIds')).toEqual(['openai']);
    });

    it('passes codex status through, so the tile can be hidden when unusable', async () => {
      expect((await lanes()).props('codexStatus')).toBeDefined();
    });

    it('handles connect and credential submission from the shared component', async () => {
      const component = await lanes();
      expect(component.vm.$options.emits).toContain('connect');
      expect(component.vm.$options.emits).toContain('submit-credential');
      // Both handlers must exist on this parent, or the events land nowhere.
      expect(typeof wrapper.vm.handleProviderClick).toBe('function');
      expect(typeof wrapper.vm.saveApiKey).toBe('function');
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

  describe('steps are addressed by name, not by position', () => {
    /**
     * Steps used to be addressed by index: `currentStep === 4` gated the
     * provider requirement and `=== 5` saved the workspace, while the number
     * of steps already varied with the referral bonus. Inserting any
     * conditional step above those two shifts them, and the symptom is not a
     * crash — it is the provider gate guarding the wrong screen and the
     * workspace silently never being saved.
     *
     * These pin the property that makes insertion safe, so the next person to
     * add a step gets a failure here rather than a bug report about a setting
     * that does not stick.
     */
    const idAt = (w, n) => {
      w.vm.currentStep = n;
      return w.vm.currentStepId;
    };

    it('derives the visible step id from the step list', async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.steps).toEqual(['welcome', 'theme', 'profile', 'provider', 'workspace', 'ready']);
      expect(idAt(wrapper, 1)).toBe('welcome');
      expect(idAt(wrapper, 4)).toBe('provider');
      expect(idAt(wrapper, 5)).toBe('workspace');
    });

    it('counts steps from the same list it renders from', async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.totalSteps).toBe(wrapper.vm.steps.length);
      expect(wrapper.vm.finalStep).toBe(wrapper.vm.steps.length);
      expect(wrapper.vm.steps.at(-1)).toBe('ready');
    });

    it('shifts every later step when a conditional one appears', async () => {
      // The referral step is the conditional step that already exists. If the
      // gates were still index-based, this shift is what would break them.
      wrapper = createWrapper({}, { referralBalance: 500 });
      await flushPromises();
      expect(wrapper.vm.steps).toContain('referral');
      expect(idAt(wrapper, 6)).toBe('referral');
      expect(idAt(wrapper, 7)).toBe('ready');
      // ...and the two gated steps have NOT moved, because they sit above it.
      expect(idAt(wrapper, 4)).toBe('provider');
      expect(idAt(wrapper, 5)).toBe('workspace');
    });

    it('gates the provider requirement on the provider step by name', async () => {
      wrapper = createWrapper({}, { connectedApps: [] });
      await flushPromises();
      wrapper.vm.currentStep = wrapper.vm.steps.indexOf('provider') + 1;
      await wrapper.vm.$nextTick();

      await wrapper.vm.nextStep();
      // Blocked: still on the provider step with nothing connected.
      expect(wrapper.vm.currentStepId).toBe('provider');
    });

    it('saves the workspace on the workspace step by name', async () => {
      const { updateSettings } = await import('@/services/fileSystemService.js');
      updateSettings.mockClear();

      wrapper = createWrapper({}, { connectedApps: ['openai'] });
      await flushPromises();
      wrapper.vm.currentStep = wrapper.vm.steps.indexOf('workspace') + 1;
      wrapper.vm.workspaceRoot = '/somewhere/new';
      await wrapper.vm.$nextTick();

      await wrapper.vm.nextStep();
      await flushPromises();
      expect(updateSettings).toHaveBeenCalledWith('/somewhere/new');
    });

    it('adds an import step only when there is something to import', async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.steps).not.toContain('import');

      harnessImportStub.hasAnythingToImport.value = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.steps).toContain('import');
    });

    it('keeps the gated steps in place when the import step appears', async () => {
      // The exact shift the named-step refactor exists to survive: 'import'
      // sits between 'workspace' and 'ready', so every later index moves.
      harnessImportStub.hasAnythingToImport.value = true;
      wrapper = createWrapper({}, { referralBalance: 500 });
      await flushPromises();

      expect(wrapper.vm.steps).toEqual(
        ['welcome', 'theme', 'profile', 'provider', 'workspace', 'import', 'referral', 'ready'],
      );
      expect(idAt(wrapper, 4)).toBe('provider');
      expect(idAt(wrapper, 5)).toBe('workspace');
      expect(idAt(wrapper, 8)).toBe('ready');
    });

    it('starts the scan on mount', async () => {
      wrapper = createWrapper();
      expect(harnessImportStub.detect).toHaveBeenCalledTimes(1);
    });

    it('compares steps to names, never to positions', () => {
      /**
       * Asserted against the SOURCE, because this defect is currently
       * unreachable at runtime: 'import' is inserted AFTER 'workspace', so
       * workspace does not move and `currentStep === 5` is still accidentally
       * correct. A mounted test therefore passes with the bug present
       * (verified — negative control M3 stayed green until this existed).
       *
       * It becomes wrong the moment any step is added ABOVE an existing one,
       * and the symptom is silent: the workspace is never saved, or the
       * provider gate guards the wrong screen. The invariant that prevents it
       * is simply that no number is ever compared to a step.
       */
      const numericComparisons = [
        ...MODAL_SOURCE.matchAll(/currentStep(?:\.value)?\s*===\s*(\d+)/g),
      ].map((m) => m[0]);

      expect(
        numericComparisons,
        'Compare currentStepId to a name instead — see the steps list.',
      ).toEqual([]);
    });

    it('anti-vacuity: the source is loaded and does address steps by id', () => {
      // Guards the check above against silently matching an empty file.
      expect(MODAL_SOURCE.length).toBeGreaterThan(1000);
      expect(MODAL_SOURCE).toMatch(/currentStepId(?:\.value)?\s*===\s*'workspace'/);
    });

    it('does not WAIT for the scan before rendering', () => {
      /**
       * Asserted against the source, because a mounted test cannot see the
       * difference: an awaited call and a fire-and-forget call are both "called
       * once", and with a stub that resolves immediately the rendered output is
       * identical either way. The cost of getting this wrong is only visible on
       * a real disk — a filesystem scan in front of the welcome screen on every
       * single launch.
       */
      const call = MODAL_SOURCE.match(/^\s*(await\s+)?harnessImport\.detect\(\);/m);
      expect(call, 'harnessImport.detect() call not found in OnboardingModal.vue').not.toBeNull();
      expect(call[1], 'detect() must not be awaited — it gates a step, not the render').toBeUndefined();
    });

    it('never renders two steps at once', async () => {
      wrapper = createWrapper({}, { referralBalance: 500 });
      await flushPromises();
      for (let n = 1; n <= wrapper.vm.steps.length; n++) {
        wrapper.vm.currentStep = n;
        await wrapper.vm.$nextTick();
        expect(wrapper.findAll('.step-content > .step')).toHaveLength(1);
      }
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

    /**
     * A CLI session the user created in their terminal, never in AGNT.
     *
     * This is the end state of issue #82 as a first-run user experiences it:
     * they signed into Claude Code in a terminal, they open AGNT for the first
     * time, and this step must already be satisfied. Nothing here is
     * CLI-specific — it works because backend discovery puts the provider into
     * connectedApps, which is the one list this screen reads.
     */
    const CLI_PROVIDERS = [
      { id: 'claude-code', name: 'Claude Code', icon: 'anthropic', categories: ['AI'], connectionType: 'oauth' },
      { id: 'openai', name: 'OpenAI', icon: 'openai', categories: ['AI'], connectionType: 'apikey' },
    ];

    it('a discovered CLI session marks the tile connected', async () => {
      wrapper = createWrapper({}, { allProviders: CLI_PROVIDERS, connectedApps: ['claude-code'] });
      await gotoProvider();

      expect(wrapper.vm.isProviderConnected('claude-code')).toBe(true);
      expect(wrapper.findAll('.provider-tile.connected').length).toBe(1);
    });

    it('a discovered CLI session satisfies the provider gate with no user action', async () => {
      wrapper = createWrapper({}, { allProviders: CLI_PROVIDERS, connectedApps: ['claude-code'] });
      await gotoProvider();

      expect(wrapper.vm.hasAnyProviderConnected).toBe(true);

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      // The whole point: onboarding advances without the user connecting
      // anything, because AGNT found the session they already had.
      expect(wrapper.vm.currentStep).toBe(5);
    });

    it('anti-vacuity: the same CLI provider still blocks when NOT discovered', async () => {
      // Without this, the test above would pass against a screen that lets
      // everyone through regardless of what discovery found.
      wrapper = createWrapper({}, { allProviders: CLI_PROVIDERS, connectedApps: [] });
      await gotoProvider();

      expect(wrapper.vm.isProviderConnected('claude-code')).toBe(false);
      expect(wrapper.findAll('.provider-tile.connected').length).toBe(0);

      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

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
    it('shows the workspace folder picker', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await goto(wrapper, 'workspace');

      expect(wrapper.find('.workspace-step').exists()).toBe(true);
      expect(wrapper.find('#workspaceRoot').exists()).toBe(true);
    });

    it('loads the current workspace root as the default hint', async () => {
      wrapper = createWrapper({}, CONNECTED);
      await flushPromises();
      await goto(wrapper, 'workspace');

      expect(wrapper.vm.defaultWorkspaceRoot).toBe('/home/user/agnt-workspace');
    });

    it('renders the shared picker, not a bare input', async () => {
      // The field is WorkspacePicker now, shared with the file tree's settings
      // dialog. `#workspaceRoot` alone would still pass against a plain input,
      // so it cannot tell the two apart.
      wrapper = createWrapper({}, CONNECTED);
      await goto(wrapper, 'workspace');

      expect(wrapper.findComponent({ name: 'WorkspacePicker' }).exists()).toBe(true);
    });
  });

  describe('the workspace picker and the import step coexist', () => {
    /**
     * These arrived on two separate branches that both edited this file: one
     * replaced the workspace step's contents, the other renamed every step's
     * guard from an index to a name. Git merged the overlapping region without
     * reporting a conflict, so the failure mode was never a merge marker — it
     * was one of the two changes silently winning.
     *
     * Asserted on ONE mounted component, because each feature's own suite
     * passes happily while the other is missing.
     */
    const BOTH = { ...CONNECTED, referralBalance: 100 };

    beforeEach(() => {
      harnessImportStub.hasAnythingToImport.value = true;
    });

    it('orders every step correctly with both features live', async () => {
      wrapper = createWrapper({}, BOTH);
      await flushPromises();
      expect(wrapper.vm.steps).toEqual(
        ['welcome', 'theme', 'profile', 'provider', 'workspace', 'import', 'referral', 'ready'],
      );
    });

    it('renders the picker on the workspace step and the importer on the import step', async () => {
      wrapper = createWrapper({}, BOTH);
      await flushPromises();

      await goto(wrapper, 'workspace');
      expect(wrapper.findComponent({ name: 'WorkspacePicker' }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: 'HarnessImport' }).exists()).toBe(false);

      await goto(wrapper, 'import');
      expect(wrapper.findComponent({ name: 'HarnessImport' }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: 'WorkspacePicker' }).exists()).toBe(false);
    });

    it('still saves the workspace once the import step has shifted the later ones', async () => {
      // The regression the named-step refactor exists to prevent: an inserted
      // step moves 'referral' and 'ready' down, and an index-based gate would
      // now be saving on the wrong screen — silently.
      const { updateSettings } = await import('@/services/fileSystemService.js');
      updateSettings.mockClear();

      wrapper = createWrapper({}, BOTH);
      await flushPromises();
      await goto(wrapper, 'workspace');
      wrapper.vm.workspaceRoot = '/picked/by/dialog';
      await wrapper.vm.$nextTick();

      await wrapper.vm.nextStep();
      await flushPromises();

      expect(updateSettings).toHaveBeenCalledWith('/picked/by/dialog');
      expect(wrapper.vm.currentStepId).toBe('import');
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
