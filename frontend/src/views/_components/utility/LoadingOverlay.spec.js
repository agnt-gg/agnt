import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import LoadingOverlay from './LoadingOverlay.vue';

describe('LoadingOverlay', () => {
  let wrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = () => {
    return mount(LoadingOverlay);
  };

  describe('Rendering', () => {
    it('renders loading overlay', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.loading-overlay').exists()).toBe(true);
    });

    it('renders loader element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.loader').exists()).toBe(true);
    });

    it('has correct structure', () => {
      wrapper = createWrapper();
      const overlay = wrapper.find('.loading-overlay');
      const loader = overlay.find('.loader');
      expect(loader.exists()).toBe(true);
    });
  });

  describe('Component Definition', () => {
    it('has correct component name', () => {
      expect(LoadingOverlay.name).toBe('LoadingOverlay');
    });
  });

  describe('CSS Classes', () => {
    it('overlay has loading-overlay class', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.loading-overlay').classes()).toContain('loading-overlay');
    });

    it('loader has loader class', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.loader').classes()).toContain('loader');
    });
  });

  describe('Accessibility', () => {
    it('renders without errors', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
