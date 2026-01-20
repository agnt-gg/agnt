import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import PopupTutorial from './PopupTutorial.vue';

describe('PopupTutorial', () => {
  let wrapper;
  let store;
  const mockConfig = [
    { title: 'Step 1', content: 'This is step 1', position: 'center' },
    { title: 'Step 2', content: 'This is step 2', position: 'bottom', target: 'target-element' },
    { title: 'Step 3', content: 'This is step 3', position: 'right', target: 'target-element', autoProgress: 1000 },
  ];

  beforeEach(() => {
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

  it('renders when startTutorial is true', async () => {
    wrapper = createWrapper({ startTutorial: true });
    expect(wrapper.find('.popup-tutorial').exists()).toBe(true);
  });

  it('does not render when startTutorial is false', () => {
    wrapper = createWrapper({ startTutorial: false });
    expect(wrapper.find('.popup-tutorial').exists()).toBe(false);
  });

  it('displays the correct content for each step', async () => {
    wrapper = createWrapper({ startTutorial: true });

    expect(wrapper.find('h3').text()).toBe('Step 1');
    expect(wrapper.find('p').text()).toBe('This is step 1');

    await wrapper.find('.next-button').trigger('click');
    expect(wrapper.find('h3').text()).toBe('Step 2');
    expect(wrapper.find('p').text()).toBe('This is step 2');
  });

  it('closes the tutorial when close button is clicked', async () => {
    wrapper = createWrapper({ startTutorial: true });

    await wrapper.find('.close-button').trigger('click');
    expect(wrapper.emitted().close).toBeTruthy();
  });

  it('emits close event when tutorial is completed', async () => {
    wrapper = createWrapper({ startTutorial: true });

    // Go through all steps
    for (let i = 0; i < mockConfig.length; i++) {
      await wrapper.find('.next-button').trigger('click');
    }

    expect(wrapper.emitted().close).toBeTruthy();
  });
});
