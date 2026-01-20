import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MainLayout from './MainLayout.vue';

describe('MainLayout', () => {
  let wrapper;
  let store;

  const createMockStore = (isAuthenticated = true) => {
    return createStore({
      modules: {
        userAuth: {
          namespaced: true,
          getters: {
            isAuthenticated: () => isAuthenticated,
          },
        },
      },
    });
  };

  beforeEach(() => {
    store = createMockStore();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, storeOverrides = {}) => {
    if (storeOverrides.isAuthenticated !== undefined) {
      store = createMockStore(storeOverrides.isAuthenticated);
    }

    return mount(MainLayout, {
      props: {
        ...props,
      },
      global: {
        plugins: [store],
        stubs: {
          LoadingOverlay: {
            template: '<div class="loading-overlay-stub"></div>',
          },
          WindowControls: {
            template: '<div class="window-controls-stub"></div>',
          },
        },
      },
      slots: {
        default: '<div class="slot-content">Test Content</div>',
      },
    });
  };

  describe('Rendering', () => {
    it('renders main-area element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('main-area').exists()).toBe(true);
    });

    it('renders slot content', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.slot-content').exists()).toBe(true);
      expect(wrapper.find('.slot-content').text()).toBe('Test Content');
    });

    it('does not show loading overlay by default', () => {
      wrapper = createWrapper({ isLoading: false });
      expect(wrapper.find('.loading-overlay-stub').exists()).toBe(false);
    });

    it('shows loading overlay when isLoading is true', () => {
      wrapper = createWrapper({ isLoading: true });
      expect(wrapper.find('.loading-overlay-stub').exists()).toBe(true);
    });
  });

  describe('CSS Classes', () => {
    it('does not have drawing-mode class by default', () => {
      wrapper = createWrapper();
      expect(wrapper.find('main-area').classes()).not.toContain('drawing-mode');
    });

    it('adds drawing-mode class when drawingMode prop is true', () => {
      wrapper = createWrapper({ drawingMode: true });
      expect(wrapper.find('main-area').classes()).toContain('drawing-mode');
    });

    it('does not have not-logged-in class when authenticated', () => {
      wrapper = createWrapper({}, { isAuthenticated: true });
      expect(wrapper.find('main-area').classes()).not.toContain('not-logged-in');
    });

    it('adds not-logged-in class when not authenticated', () => {
      wrapper = createWrapper({}, { isAuthenticated: false });
      expect(wrapper.find('main-area').classes()).toContain('not-logged-in');
    });

    it('can have both drawing-mode and not-logged-in classes', () => {
      wrapper = createWrapper({ drawingMode: true }, { isAuthenticated: false });
      const classes = wrapper.find('main-area').classes();
      expect(classes).toContain('drawing-mode');
      expect(classes).toContain('not-logged-in');
    });
  });

  describe('Props', () => {
    it('has default isLoading of false', () => {
      wrapper = createWrapper();
      expect(wrapper.props('isLoading')).toBe(false);
    });

    it('has default drawingMode of false', () => {
      wrapper = createWrapper();
      expect(wrapper.props('drawingMode')).toBe(false);
    });

    it('accepts isLoading prop', () => {
      wrapper = createWrapper({ isLoading: true });
      expect(wrapper.props('isLoading')).toBe(true);
    });

    it('accepts drawingMode prop', () => {
      wrapper = createWrapper({ drawingMode: true });
      expect(wrapper.props('drawingMode')).toBe(true);
    });
  });

  describe('Computed Properties', () => {
    it('mainAreaClasses returns correct object when authenticated and not drawing', () => {
      wrapper = createWrapper({ drawingMode: false }, { isAuthenticated: true });
      expect(wrapper.vm.mainAreaClasses).toEqual({
        'drawing-mode': false,
        'not-logged-in': false,
      });
    });

    it('mainAreaClasses returns correct object when not authenticated', () => {
      wrapper = createWrapper({ drawingMode: false }, { isAuthenticated: false });
      expect(wrapper.vm.mainAreaClasses).toEqual({
        'drawing-mode': false,
        'not-logged-in': true,
      });
    });

    it('mainAreaClasses returns correct object when in drawing mode', () => {
      wrapper = createWrapper({ drawingMode: true }, { isAuthenticated: true });
      expect(wrapper.vm.mainAreaClasses).toEqual({
        'drawing-mode': true,
        'not-logged-in': false,
      });
    });

    it('isAuthenticated getter is accessible', () => {
      wrapper = createWrapper({}, { isAuthenticated: true });
      expect(wrapper.vm.isAuthenticated).toBe(true);
    });
  });

  describe('Loading State', () => {
    it('toggles loading overlay based on isLoading prop', async () => {
      wrapper = createWrapper({ isLoading: false });
      expect(wrapper.find('.loading-overlay-stub').exists()).toBe(false);

      await wrapper.setProps({ isLoading: true });
      expect(wrapper.find('.loading-overlay-stub').exists()).toBe(true);

      await wrapper.setProps({ isLoading: false });
      expect(wrapper.find('.loading-overlay-stub').exists()).toBe(false);
    });
  });

  describe('Slot Content', () => {
    it('renders default slot content', () => {
      wrapper = mount(MainLayout, {
        global: {
          plugins: [store],
          stubs: {
            LoadingOverlay: true,
            WindowControls: true,
          },
        },
        slots: {
          default: '<p>Custom Content</p>',
        },
      });

      expect(wrapper.find('p').text()).toBe('Custom Content');
    });

    it('renders multiple elements in slot', () => {
      wrapper = mount(MainLayout, {
        global: {
          plugins: [store],
          stubs: {
            LoadingOverlay: true,
            WindowControls: true,
          },
        },
        slots: {
          default: '<div class="item1">Item 1</div><div class="item2">Item 2</div>',
        },
      });

      expect(wrapper.find('.item1').exists()).toBe(true);
      expect(wrapper.find('.item2').exists()).toBe(true);
    });

    it('renders empty when no slot content provided', () => {
      wrapper = mount(MainLayout, {
        global: {
          plugins: [store],
          stubs: {
            LoadingOverlay: true,
            WindowControls: true,
          },
        },
      });

      expect(wrapper.find('main-area').text()).toBe('');
    });
  });

  describe('Component Registration', () => {
    it('has correct component name', () => {
      expect(MainLayout.name).toBe('MainLayout');
    });

    it('registers LoadingOverlay component', () => {
      expect(MainLayout.components.LoadingOverlay).toBeDefined();
    });

    it('registers WindowControls component', () => {
      expect(MainLayout.components.WindowControls).toBeDefined();
    });
  });

  describe('Reactivity', () => {
    it('updates classes when drawingMode changes', async () => {
      wrapper = createWrapper({ drawingMode: false });
      expect(wrapper.find('main-area').classes()).not.toContain('drawing-mode');

      await wrapper.setProps({ drawingMode: true });
      expect(wrapper.find('main-area').classes()).toContain('drawing-mode');
    });

    it('updates classes when authentication state changes', async () => {
      // Start authenticated
      store = createMockStore(true);
      wrapper = mount(MainLayout, {
        global: {
          plugins: [store],
          stubs: {
            LoadingOverlay: true,
            WindowControls: true,
          },
        },
      });

      expect(wrapper.find('main-area').classes()).not.toContain('not-logged-in');

      // Create new store with unauthenticated state
      const newStore = createMockStore(false);
      wrapper.unmount();

      wrapper = mount(MainLayout, {
        global: {
          plugins: [newStore],
          stubs: {
            LoadingOverlay: true,
            WindowControls: true,
          },
        },
      });

      expect(wrapper.find('main-area').classes()).toContain('not-logged-in');
    });
  });
});
