/**
 * Studio's onboarding modal: the first-run setup (your AI, Google, your phone;
 * FirstRunSetup has its own spec), then two screens that only some accounts
 * get: importing from other AI tools, and an invite's referral bonus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

const usePrompt = vi.fn();
vi.mock('@/composables/useJourney.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useJourney: () => ({ usePrompt }),
}));

/**
 * The harness scan is stubbed: this file tests the modal, and the scanner has
 * its own spec. `hasAnythingToImport` is a real ref because the step list is a
 * computed that reads it.
 */
const harnessImportStub = { detect: vi.fn(), hasAnythingToImport: ref(false) };
vi.mock('@/composables/useHarnessImport.js', () => ({ useHarnessImport: () => harnessImportStub }));

import OnboardingModal from './OnboardingModal.vue';

const SetupStub = { name: 'FirstRunSetup', props: ['frame'], emits: ['finish'], template: '<div class="frs-stub" />' };
const showModal = vi.fn();

let wrapper;
function mountModal({ show = true, referralBalance = 0, connectedApps = ['agnt'] } = {}) {
  const store = createStore({
    modules: {
      userStats: { namespaced: true, state: { referralBalance } },
      appAuth: { namespaced: true, state: { connectedApps } },
    },
  });
  wrapper = mount(OnboardingModal, {
    props: { show },
    global: {
      plugins: [store],
      stubs: {
        FirstRunSetup: SetupStub,
        HarnessImport: { props: ['importer'], template: '<div class="import-stub" />' },
        SimpleModal: { template: '<div />', methods: { showModal } },
        Transition: { template: '<div><slot /></div>' },
      },
    },
  });
  return wrapper;
}
const finishSetup = async (payload) => {
  wrapper.findComponent(SetupStub).vm.$emit('finish', payload);
  await flushPromises();
};

beforeEach(() => {
  usePrompt.mockReset();
  showModal.mockReset();
  harnessImportStub.detect.mockClear();
  harnessImportStub.hasAnythingToImport.value = false;
});
afterEach(() => wrapper?.unmount());

describe('the first run is the setup', () => {
  it('opens on the shared setup, in its modal frame', () => {
    mountModal();
    expect(wrapper.findComponent(SetupStub).props('frame')).toBe('modal');
  });

  it('renders nothing when not shown', () => {
    mountModal({ show: false });
    expect(wrapper.find('.onboarding-modal').exists()).toBe(false);
  });

  // Theme, display name and workspace folder have defaults and live in
  // Settings; they used to be five screens in front of a working chat.
  it('asks for nothing else on a plain first run', () => {
    mountModal();
    expect(wrapper.vm.steps).toEqual(['setup']);
  });

  it('starts the import scan on mount without waiting for it', () => {
    mountModal();
    expect(harnessImportStub.detect).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(SetupStub).exists()).toBe(true);
  });
});

describe('finishing', () => {
  it('completes into the chat as soon as the setup finishes', async () => {
    mountModal();
    await finishSetup({ ask: null });
    expect(wrapper.emitted('complete')).toEqual([['ChatScreen']]);
    expect(usePrompt).not.toHaveBeenCalled();
  });

  it('types the request the setup chose into the composer', async () => {
    mountModal();
    await finishSetup({ ask: 'Prep me for tomorrow: …' });
    expect(wrapper.emitted('complete')).toEqual([['ChatScreen']]);
    expect(usePrompt).toHaveBeenCalledWith('Prep me for tomorrow: …');
  });
});

describe('screens only some accounts get', () => {
  it('offers the import after the setup, only when there is something to import', async () => {
    harnessImportStub.hasAnythingToImport.value = true;
    mountModal();
    expect(wrapper.vm.steps).toEqual(['setup', 'import']);
    await finishSetup({ ask: 'What can you do for me?' });
    expect(wrapper.find('.import-stub').exists()).toBe(true);
    expect(wrapper.emitted('complete')).toBeUndefined();
    // The request waits until the last screen, which says so.
    expect(wrapper.find('[data-action="next"]').text()).toBe('Ask Annie →');
    await wrapper.find('[data-action="next"]').trigger('click');
    expect(wrapper.emitted('complete')).toEqual([['ChatScreen']]);
    expect(usePrompt).toHaveBeenCalledWith('What can you do for me?');
  });

  it('tells an invited account about its free month, last', async () => {
    harnessImportStub.hasAnythingToImport.value = true;
    mountModal({ referralBalance: 250 });
    expect(wrapper.vm.steps).toEqual(['setup', 'import', 'referral']);
    await finishSetup({ ask: null });
    expect(wrapper.find('[data-action="next"]').text()).toBe('Continue →');
    await wrapper.find('[data-action="next"]').trigger('click');
    expect(wrapper.find('.bonus-amount').text()).toBe('+250 pts');
    expect(wrapper.find('[data-action="next"]').text()).toBe('Start →');
  });
});

describe('skipping', () => {
  it('asks first, then skips', async () => {
    showModal.mockResolvedValue(true);
    mountModal();
    await wrapper.find('[data-action="skip-setup"]').trigger('click');
    await flushPromises();
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Skip setup?' }));
    expect(wrapper.emitted('skip')).toHaveLength(1);
  });

  it('does not skip when the person goes back', async () => {
    showModal.mockResolvedValue(false);
    mountModal();
    await wrapper.find('.onboarding-overlay').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('skip')).toBeUndefined();
  });

  it('warns that nothing works without an AI when none is connected', async () => {
    showModal.mockResolvedValue(false);
    mountModal({ connectedApps: [] });
    await wrapper.find('[data-action="skip-setup"]').trigger('click');
    await flushPromises();
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Skip Without Provider?' }));
  });
});
