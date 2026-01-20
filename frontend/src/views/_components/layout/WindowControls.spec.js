import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import WindowControls from './WindowControls.vue';

// Mock vue-router
vi.mock('vue-router', () => ({
  useRoute: () => ({
    name: 'TestRoute',
    path: '/test',
  }),
}));

describe('WindowControls', () => {
  let wrapper;
  let mockElectron;

  beforeEach(() => {
    // Setup mock electron object
    mockElectron = {
      send: vi.fn(),
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Clean up window.electron
    delete window.electron;
  });

  const createWrapper = (isElectron = true) => {
    if (isElectron) {
      window.electron = mockElectron;
    } else {
      delete window.electron;
    }

    return mount(WindowControls, {
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('renders window controls when in Electron environment', async () => {
      wrapper = createWrapper(true);
      await wrapper.vm.$nextTick();

      // Manually set isElectron since onMounted runs after mount
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.window-controls').exists()).toBe(true);
    });

    it('does not render window controls when not in Electron environment', async () => {
      wrapper = createWrapper(false);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.window-controls').exists()).toBe(false);
    });

    it('renders minimize button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.minimize-window').exists()).toBe(true);
    });

    it('renders maximize button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.maximize-window').exists()).toBe(true);
    });

    it('renders close button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.close-window').exists()).toBe(true);
    });

    it('renders drag region', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.drag-region').exists()).toBe(true);
    });

    it('renders SVG icons in buttons', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      const buttons = wrapper.findAll('.window-control');
      buttons.forEach((button) => {
        expect(button.find('svg').exists()).toBe(true);
      });
    });
  });

  describe('Minimize Functionality', () => {
    it('sends minimize-window message when minimize button is clicked', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      await wrapper.find('.minimize-window').trigger('click');

      expect(mockElectron.send).toHaveBeenCalledWith('minimize-window');
    });

    it('does not throw error when minimize is called without electron', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      // Remove electron after render
      delete window.electron;

      // Should not throw
      expect(() => wrapper.vm.minimize()).not.toThrow();
    });
  });

  describe('Maximize Functionality', () => {
    it('sends maximize-window message when maximize button is clicked', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      await wrapper.find('.maximize-window').trigger('click');

      expect(mockElectron.send).toHaveBeenCalledWith('maximize-window');
    });

    it('does not throw error when maximize is called without electron', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      // Remove electron after render
      delete window.electron;

      // Should not throw
      expect(() => wrapper.vm.maximize()).not.toThrow();
    });
  });

  describe('Close Functionality', () => {
    it('sends close-window message when close button is clicked', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      await wrapper.find('.close-window').trigger('click');

      expect(mockElectron.send).toHaveBeenCalledWith('close-window');
    });

    it('does not throw error when close is called without electron', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      // Remove electron after render
      delete window.electron;

      // Should not throw
      expect(() => wrapper.vm.close()).not.toThrow();
    });
  });

  describe('Route Display', () => {
    it('computes current route name', () => {
      wrapper = createWrapper(true);
      expect(wrapper.vm.currentRouteName).toBe('TestRoute');
    });
  });

  describe('Electron Detection', () => {
    it('detects Electron environment on mount', async () => {
      window.electron = mockElectron;
      wrapper = mount(WindowControls, {
        attachTo: document.body,
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isElectron).toBe(true);
    });

    it('detects non-Electron environment on mount', async () => {
      delete window.electron;
      wrapper = mount(WindowControls, {
        attachTo: document.body,
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isElectron).toBe(false);
    });
  });

  describe('Button Styling', () => {
    it('has correct class on minimize button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      const minimizeBtn = wrapper.find('.minimize-window');
      expect(minimizeBtn.classes()).toContain('window-control');
    });

    it('has correct class on maximize button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      const maximizeBtn = wrapper.find('.maximize-window');
      expect(maximizeBtn.classes()).toContain('window-control');
    });

    it('has correct class on close button', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      const closeBtn = wrapper.find('.close-window');
      expect(closeBtn.classes()).toContain('window-control');
    });
  });

  describe('Multiple Button Clicks', () => {
    it('handles multiple minimize clicks', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      await wrapper.find('.minimize-window').trigger('click');
      await wrapper.find('.minimize-window').trigger('click');
      await wrapper.find('.minimize-window').trigger('click');

      expect(mockElectron.send).toHaveBeenCalledTimes(3);
      expect(mockElectron.send).toHaveBeenCalledWith('minimize-window');
    });

    it('handles clicking different buttons in sequence', async () => {
      wrapper = createWrapper(true);
      wrapper.vm.isElectron = true;
      await wrapper.vm.$nextTick();

      await wrapper.find('.minimize-window').trigger('click');
      await wrapper.find('.maximize-window').trigger('click');
      await wrapper.find('.close-window').trigger('click');

      expect(mockElectron.send).toHaveBeenCalledTimes(3);
      expect(mockElectron.send).toHaveBeenNthCalledWith(1, 'minimize-window');
      expect(mockElectron.send).toHaveBeenNthCalledWith(2, 'maximize-window');
      expect(mockElectron.send).toHaveBeenNthCalledWith(3, 'close-window');
    });
  });
});
