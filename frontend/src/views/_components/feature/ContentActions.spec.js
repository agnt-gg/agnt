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

  it('has a copy button', () => {
    const copyButton = wrapper.find('button[title="Copy"]');
    expect(copyButton.exists()).toBe(true);
  });

  it('has a clear content button', () => {
    const clearButton = wrapper.find('button[title="Clear Content"]');
    expect(clearButton.exists()).toBe(true);
  });

  it('has a delete content button', () => {
    const deleteButton = wrapper.find('button[title="Delete Content"]');
    expect(deleteButton.exists()).toBe(true);
  });

  it('has a save button', () => {
    const saveButton = wrapper.find('button[title="Save"]');
    expect(saveButton.exists()).toBe(true);
  });

  it('has an import button', () => {
    const importButton = wrapper.find('button[title="Import"]');
    expect(importButton.exists()).toBe(true);
  });

  it('has a share button', () => {
    const shareButton = wrapper.find('button[title="Share"]');
    expect(shareButton.exists()).toBe(true);
  });
});
