import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SharedContentActions from './ContentActions.vue';

// Mock axios
vi.mock('axios');

// Mock the vue-router
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({
    path: '/tool-forge',
  })),
}));

// Mock the store
vi.mock('@/store/state', () => ({
  default: {
    state: {
      chat: {
        messages: [],
        page: 'tool-forge',
      },
    },
    commit: vi.fn(),
  },
}));

// Mock the useCleanup composable
vi.mock('@/composables/useCleanup', () => ({
  useCleanup: () => ({
    setTimeout: vi.fn((fn, delay) => setTimeout(fn, delay)),
    addEventListener: vi.fn(),
  }),
}));

// Mock MathJax
global.MathJax = {
  typesetPromise: vi.fn(() => Promise.resolve()),
};

// Mock hljs
global.hljs = {
  highlightElement: vi.fn(),
};

describe('SharedContentActions', () => {
  let wrapper;
  let clipboardWriteTextMock;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock DOM elements and methods
    document.body.innerHTML = `
      <div id="response-area" data-output-id="test-id">Some test content</div>
      <div id="content-actions" style="display: none;"></div>
    `;

    // Mock navigator.clipboard
    clipboardWriteTextMock = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: clipboardWriteTextMock,
      },
      writable: true,
      configurable: true,
    });

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => JSON.stringify({ 'test-id': 'Some test content' })),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
    });

    // Mock html2canvas and jspdf
    global.html2canvas = vi.fn(() => Promise.resolve({ width: 100, height: 100 }));
    global.jspdf = {
      jsPDF: vi.fn(() => ({ addImage: vi.fn(), save: vi.fn() })),
    };

    // Create a mock SimpleModal component
    const SimpleModalMock = {
      template: '<div class="simple-modal"></div>',
      methods: {
        showModal: vi.fn(() => Promise.resolve(true)),
      },
    };

    // Mount the component with SimpleModal stub
    wrapper = mount(SharedContentActions, {
      global: {
        mocks: {
          $route: { path: '/tool-forge' },
        },
        stubs: {
          SimpleModal: SimpleModalMock,
        },
      },
    });

    // SUPPRESS TEST LOGS
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders correctly', () => {
    expect(wrapper.find('.content-actions-wrapper').exists()).toBe(true);
  });

  // Action buttons are labelled by the shared <Tooltip> wrapper rather than a
  // native title attribute, so look the button up through its tooltip text.
  const actionButton = (label) => {
    const tip = wrapper.findAllComponents({ name: 'Tooltip' }).find((t) => t.props('text') === label);
    return tip ? tip.find('button') : null;
  };

  it.each([['Copy'], ['Clear Content'], ['Delete Content'], ['Save'], ['Import'], ['Share'], ['Download PDF']])(
    'has a %s action button',
    (label) => {
      const button = actionButton(label);
      expect(button, `no Tooltip labelled "${label}"`).not.toBeNull();
      expect(button.exists()).toBe(true);
    }
  );

  it('exposes exactly the expected set of labelled actions', () => {
    const labels = wrapper.findAllComponents({ name: 'Tooltip' }).map((t) => t.props('text'));
    expect([...labels].sort()).toEqual(
      ['Clear Content', 'Copy', 'Delete Content', 'Download PDF', 'Import', 'Save', 'Share'].sort()
    );
  });
});
