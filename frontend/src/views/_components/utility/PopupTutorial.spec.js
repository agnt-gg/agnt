import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import PopupTutorial from './PopupTutorial.vue';

describe('Feature: PopupTutorial scenario isolation', () => {
  let wrapper;
  let store;
  let baseline;

  const restoreDom = () => {
    document.querySelector = baseline.querySelector;
    if (baseline.scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', baseline.scrollIntoView);
    else delete Element.prototype.scrollIntoView;
    window.innerWidth = baseline.innerWidth;
    window.innerHeight = baseline.innerHeight;
    document.querySelectorAll('#target-element').forEach((element) => element.remove());
  };

  beforeEach(() => {
    baseline = {
      querySelector: document.querySelector,
      scrollIntoView: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView'),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
    // Control timer progression, but leave setImmediate available to flushPromises.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(async () => {
    // The outer hook runs AFTER the scenario fixture's teardown. Check before
    // the safety net: clearing timers must never make this contract pass.
    await flushPromises();
    const remaining = {
      mounted: Boolean(wrapper && !wrapper.vm.$.isUnmounted),
      timers: vi.getTimerCount(),
      targets: document.querySelectorAll('#target-element').length,
      querySelectorRestored: document.querySelector === baseline.querySelector,
      scrollIntoViewRestored: Element.prototype.scrollIntoView === baseline.scrollIntoView?.value,
      dimensionsRestored: window.innerWidth === baseline.innerWidth && window.innerHeight === baseline.innerHeight,
    };
    try {
      expect(remaining, 'Then scenario teardown releases components, timers, DOM fixtures and mocks').toEqual({
        mounted: false, timers: 0, targets: 0,
        querySelectorRestored: true, scrollIntoViewRestored: true, dimensionsRestored: true,
      });
    } finally {
      // Keep an intentionally RED run isolated too, without swallowing its failure.
      if (wrapper && !wrapper.vm.$.isUnmounted) wrapper.unmount();
      localStorage.clear();
      vi.clearAllTimers();
      vi.restoreAllMocks();
      vi.useRealTimers();
      restoreDom();
      wrapper = undefined;
    }
  });

  describe('Given an isolated tutorial scenario', () => {
    const mockConfig = [
      { title: 'Step 1', content: 'This is step 1', position: 'center' },
      { title: 'Step 2', content: 'This is step 2', position: 'bottom', target: 'target-element' },
      { title: 'Step 3', content: 'This is step 3', position: 'right', target: 'target-element', autoProgress: 1000 },
    ];

    beforeEach(() => {
      // PopupTutorial persists completed steps to localStorage under
      // `tutorial_<tutorialId>`, and jsdom shares one localStorage across every
      // test in this file. Without clearing it, a tutorial completed by an
      // earlier test is replayed as already-done in the next one and the popup
      // closes before the assertions run.
      localStorage.clear();

      // Create a real DOM element for mocking
      const mockElement = document.createElement('div');
      mockElement.id = 'target-element';
      mockElement.style.width = '100px';
      mockElement.style.height = '100px';
      mockElement.style.position = 'absolute';
      mockElement.style.top = '50px';
      mockElement.style.left = '50px';
      mockElement.style.borderRadius = '8px';
      document.body.appendChild(mockElement);

      // Mock querySelector to return the real element
      const originalQuerySelector = document.querySelector.bind(document);
      document.querySelector = vi.fn((selector) => {
        if (selector === '.target-element' || selector === '#target-element' || selector === 'target-element') {
          return mockElement;
        }
        return originalQuerySelector(selector);
      });

      // Mock Element.prototype.scrollIntoView for jsdom
      Element.prototype.scrollIntoView = vi.fn();

      // Mock window dimensions
      global.innerWidth = 1024;
      global.innerHeight = 768;

      // Create a mock Vuex store
      store = createStore({
        modules: {
          userAuth: {
            namespaced: true,
            state: {
              shouldShowOnboarding: false,
            },
            getters: {
              shouldShowOnboarding: (state) => state.shouldShowOnboarding,
            },
          },
        },
      });
    });

    afterEach(async () => {
      // jsdom dispatches storage events via zero-delay timers. Clear storage
      // BEFORE draining that queue, or teardown itself leaves an event pending.
      // Do not run the 20ms retry or 1000ms auto-advance: unmount must cancel them.
      localStorage.clear();
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      wrapper?.unmount();
      await flushPromises();
      restoreDom();
    });

    const createWrapper = (props = {}) => {
      return mount(PopupTutorial, {
        props: { config: mockConfig, tutorialId: 'test-tutorial', ...props },
        global: {
          plugins: [store],
          mocks: {
            $router: {
              push: vi.fn(),
            },
            $route: {
              path: '/',
              name: 'Home',
            },
          },
          stubs: {
            teleport: true,
          },
        },
      });
    };

    it('When tutorial starts Then the popup renders', async () => {
      wrapper = createWrapper({ startTutorial: true });
      expect(wrapper.find('.popup-tutorial').exists()).toBe(true);
    });

    it('When tutorial is disabled Then the popup is absent', () => {
      wrapper = createWrapper({ startTutorial: false });
      expect(wrapper.find('.popup-tutorial').exists()).toBe(false);
    });

    it('When Next is clicked Then the next step content is displayed', async () => {
      wrapper = createWrapper({ startTutorial: true });

      expect(wrapper.find('h3').text()).toBe('Step 1');
      expect(wrapper.find('p').text()).toBe('This is step 1');

      await wrapper.find('.next-button').trigger('click');
      expect(wrapper.find('h3').text()).toBe('Step 2');
      expect(wrapper.find('p').text()).toBe('This is step 2');
    });

    it('When Close is clicked Then a close event is emitted', async () => {
      wrapper = createWrapper({ startTutorial: true });

      await wrapper.find('.close-button').trigger('click');
      expect(wrapper.emitted().close).toBeTruthy();
    });

    it('When the final step completes Then a close event is emitted', async () => {
      wrapper = createWrapper({ startTutorial: true });

      // Go through all steps
      for (let i = 0; i < mockConfig.length; i++) {
        await wrapper.find('.next-button').trigger('click');
      }

      expect(wrapper.emitted().close).toBeTruthy();
    });

    it('Given positioning is pending When the scenario ends Then teardown cancels the retry', () => {
      const schedule = vi.spyOn(window, 'setTimeout');
      wrapper = createWrapper({ startTutorial: true });
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 20);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      // The outer hook verifies teardown, including any late promise continuations.
    });

    it('Given auto-advance is pending When the scenario ends Then teardown cancels advancement', async () => {
      const schedule = vi.spyOn(window, 'setTimeout');
      wrapper = createWrapper({
        startTutorial: true,
        config: [{ title: 'Timed step', content: 'Wait', position: 'center', autoProgress: 1000 }],
      });
      await vi.advanceTimersByTimeAsync(20);
      await flushPromises();
      expect(wrapper.find('h3').text()).toBe('Timed step');
      expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(wrapper.emitted().close).toBeUndefined();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
  });
});
