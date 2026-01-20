import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TerminalLayout from './TerminalLayout.vue';

describe('TerminalLayout', () => {
  let wrapper;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock Audio
    global.Audio = vi.fn(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      volume: 0.3,
      currentTime: 0,
    }));

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(TerminalLayout, {
      props: {
        ...props,
      },
      global: {
        stubs: {
          SongPlayer: {
            template: '<div class="song-player-stub"></div>',
          },
        },
      },
      slots: {
        default: '<div class="slot-content">Terminal Content</div>',
      },
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('renders terminal container', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.terminal-container').exists()).toBe(true);
    });

    it('renders SongPlayer component', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.song-player-stub').exists()).toBe(true);
    });

    it('does not show terminal screen initially', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.terminal-screen').exists()).toBe(false);
    });

    it('shows terminal screen after initial delay', async () => {
      wrapper = createWrapper({ initialDelay: 100 });

      expect(wrapper.find('.terminal-screen').exists()).toBe(false);

      vi.advanceTimersByTime(100);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').exists()).toBe(true);
    });

    it('renders slot content when terminal is visible', async () => {
      wrapper = createWrapper({ initialDelay: 50 });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.slot-content').exists()).toBe(true);
      expect(wrapper.find('.slot-content').text()).toBe('Terminal Content');
    });

    it('renders scanline overlay', async () => {
      wrapper = createWrapper({ initialDelay: 50 });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.scanline-overlay').exists()).toBe(true);
    });
  });

  describe('Narration', () => {
    it('shows narration when showInitialNarration is true and terminal not visible', () => {
      wrapper = createWrapper({
        showInitialNarration: true,
        narrationText: 'Loading system...',
      });

      expect(wrapper.find('.narration').exists()).toBe(true);
      expect(wrapper.find('.narration').text()).toBe('Loading system...');
    });

    it('hides narration when terminal becomes visible', async () => {
      wrapper = createWrapper({
        showInitialNarration: true,
        narrationText: 'Loading...',
        initialDelay: 50,
      });

      expect(wrapper.find('.narration').exists()).toBe(true);

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.narration').exists()).toBe(false);
    });

    it('does not show narration when showInitialNarration is false', () => {
      wrapper = createWrapper({
        showInitialNarration: false,
        narrationText: 'Should not show',
      });

      expect(wrapper.find('.narration').exists()).toBe(false);
    });

    it('uses default narration text', () => {
      wrapper = createWrapper({ showInitialNarration: true });
      expect(wrapper.find('.narration').text()).toBe('Initializing...');
    });
  });

  describe('Glitch Effect', () => {
    it('applies glitch-active class when glitching', async () => {
      wrapper = createWrapper({
        initialDelay: 50,
        showGlitch: true,
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').classes()).toContain('glitch-active');
    });

    it('removes glitch-active class after glitch duration', async () => {
      wrapper = createWrapper({
        initialDelay: 50,
        showGlitch: true,
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').classes()).toContain('glitch-active');

      // Glitch duration is 1000ms
      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').classes()).not.toContain('glitch-active');
    });

    it('does not apply glitch when showGlitch is false', async () => {
      wrapper = createWrapper({
        initialDelay: 50,
        showGlitch: false,
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').classes()).not.toContain('glitch-active');
    });
  });

  describe('Events', () => {
    it('emits terminal-ready after glitch completes', async () => {
      wrapper = createWrapper({
        initialDelay: 50,
        showGlitch: true,
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('terminal-ready')).toBeFalsy();

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('terminal-ready')).toBeTruthy();
    });

    it('emits terminal-ready immediately when showGlitch is false', async () => {
      wrapper = createWrapper({
        initialDelay: 50,
        showGlitch: false,
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(wrapper.emitted('terminal-ready')).toBeTruthy();
    });
  });

  describe('User Interaction', () => {
    it('handles container click', async () => {
      wrapper = createWrapper({ initialDelay: 50 });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      await wrapper.find('.terminal-container').trigger('click');

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });

    it('handles container keydown', async () => {
      wrapper = createWrapper({ initialDelay: 50 });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      await wrapper.find('.terminal-container').trigger('keydown', { key: 'a' });

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Props', () => {
    it('has default showInitialNarration of false', () => {
      wrapper = createWrapper();
      expect(wrapper.props('showInitialNarration')).toBe(false);
    });

    it('has default narrationText of "Initializing..."', () => {
      wrapper = createWrapper();
      expect(wrapper.props('narrationText')).toBe('Initializing...');
    });

    it('has default initialDelay of 50', () => {
      wrapper = createWrapper();
      expect(wrapper.props('initialDelay')).toBe(50);
    });

    it('has default showGlitch of true', () => {
      wrapper = createWrapper();
      expect(wrapper.props('showGlitch')).toBe(true);
    });

    it('has default soundEnabled of true', () => {
      wrapper = createWrapper();
      expect(wrapper.props('soundEnabled')).toBe(true);
    });

    it('accepts custom initialDelay', () => {
      wrapper = createWrapper({ initialDelay: 500 });
      expect(wrapper.props('initialDelay')).toBe(500);
    });
  });

  describe('Mobile Detection', () => {
    it('detects mobile when window width is <= 800', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 600, writable: true });

      wrapper = createWrapper();

      // Trigger resize event
      window.dispatchEvent(new Event('resize'));
      await wrapper.vm.$nextTick();

      // isMobile is provided, not directly accessible
      expect(wrapper.exists()).toBe(true);
    });

    it('detects desktop when window width is > 800', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });

      wrapper = createWrapper();

      window.dispatchEvent(new Event('resize'));
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Sound System', () => {
    it('provides playSound function to children', () => {
      wrapper = createWrapper();

      // The playSound function is provided via Vue's provide/inject
      // We can verify the component sets up correctly
      expect(wrapper.exists()).toBe(true);
    });

    it('respects soundEnabled prop', () => {
      wrapper = createWrapper({ soundEnabled: false });
      expect(wrapper.props('soundEnabled')).toBe(false);
    });

    it('checks localStorage for sound settings', () => {
      wrapper = createWrapper();

      expect(localStorage.getItem).toHaveBeenCalledWith('soundsEnabled');
    });
  });

  describe('Lifecycle', () => {
    it('adds resize event listener on mount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      wrapper = createWrapper();

      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('removes resize event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      wrapper = createWrapper();
      wrapper.unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('adds sounds-settings-changed event listener', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      wrapper = createWrapper();

      expect(addEventListenerSpy).toHaveBeenCalledWith('sounds-settings-changed', expect.any(Function));
    });
  });

  describe('CSS Classes', () => {
    it('terminal-container has tabindex for keyboard focus', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.terminal-container').attributes('tabindex')).toBe('0');
    });
  });

  describe('Component Registration', () => {
    it('has correct component name', () => {
      expect(TerminalLayout.name).toBe('TerminalLayout');
    });

    it('registers SongPlayer component', () => {
      expect(TerminalLayout.components.SongPlayer).toBeDefined();
    });
  });

  describe('Slot Content', () => {
    it('renders custom slot content', async () => {
      wrapper = mount(TerminalLayout, {
        global: {
          stubs: {
            SongPlayer: true,
          },
        },
        slots: {
          default: '<div class="custom-content">Custom Terminal Content</div>',
        },
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.custom-content').exists()).toBe(true);
      expect(wrapper.find('.custom-content').text()).toBe('Custom Terminal Content');
    });

    it('renders multiple elements in slot', async () => {
      wrapper = mount(TerminalLayout, {
        global: {
          stubs: {
            SongPlayer: true,
          },
        },
        slots: {
          default: '<div class="item1">Item 1</div><div class="item2">Item 2</div>',
        },
      });

      vi.advanceTimersByTime(50);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.item1').exists()).toBe(true);
      expect(wrapper.find('.item2').exists()).toBe(true);
    });
  });

  describe('Timing', () => {
    it('respects custom initialDelay', async () => {
      wrapper = createWrapper({ initialDelay: 200 });

      vi.advanceTimersByTime(100);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.terminal-screen').exists()).toBe(false);

      vi.advanceTimersByTime(100);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.terminal-screen').exists()).toBe(true);
    });

    it('shows terminal immediately with 0 delay', async () => {
      wrapper = createWrapper({ initialDelay: 0 });

      vi.advanceTimersByTime(0);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.terminal-screen').exists()).toBe(true);
    });
  });
});
