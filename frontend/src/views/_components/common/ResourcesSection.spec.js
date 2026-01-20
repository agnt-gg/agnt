import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import ResourcesSection from './ResourcesSection.vue';

// Mock the config
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    REMOTE_URL: 'http://localhost:3000',
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('ResourcesSection', () => {
  let wrapper;
  let store;

  const createMockStore = (overrides = {}) => {
    return createStore({
      modules: {
        userAuth: {
          namespaced: true,
          getters: {
            userEmail: () => overrides.userEmail || 'test@example.com',
            userName: () => overrides.userName || 'TestUser',
          },
        },
      },
    });
  };

  beforeEach(() => {
    store = createMockStore();

    // Reset fetch mock
    global.fetch.mockReset();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => 'test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  const createWrapper = (storeOverrides = {}) => {
    if (Object.keys(storeOverrides).length > 0) {
      store = createMockStore(storeOverrides);
    }

    const mockShowModal = vi.fn().mockResolvedValue(true);
    const wrapper = mount(ResourcesSection, {
      global: {
        plugins: [store],
        stubs: {
          SimpleModal: {
            template: '<div class="simple-modal-stub"></div>',
            methods: {
              showModal: mockShowModal,
            },
          },
        },
      },
      attachTo: document.body,
    });

    wrapper.mockShowModal = mockShowModal;
    return wrapper;
  };

  describe('Rendering', () => {
    it('renders resources section', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.resources-section').exists()).toBe(true);
    });

    it('displays section title', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.section-title').text()).toBe('RESOURCES');
    });

    it('renders resource links grid', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.resource-links').exists()).toBe(true);
    });

    it('renders Docs link', () => {
      wrapper = createWrapper();
      const docsLink = wrapper.findAll('.resource-link').find((link) => link.text().includes('Docs'));
      expect(docsLink.exists()).toBe(true);
      expect(docsLink.attributes('href')).toBe('https://agnt.gg/docs');
    });

    it('renders GitHub link', () => {
      wrapper = createWrapper();
      const githubLink = wrapper.findAll('.resource-link').find((link) => link.text().includes('GitHub'));
      expect(githubLink.exists()).toBe(true);
      expect(githubLink.attributes('href')).toBe('https://github.com/agnt-gg/agnt');
    });

    it('renders Discord link', () => {
      wrapper = createWrapper();
      const discordLink = wrapper.findAll('.resource-link').find((link) => link.text().includes('Discord'));
      expect(discordLink.exists()).toBe(true);
      expect(discordLink.attributes('href')).toBe('https://discord.com/invite/nwXJMnHmXP');
    });

    it('renders Feedback button', () => {
      wrapper = createWrapper();
      const feedbackBtn = wrapper.find('.resource-button');
      expect(feedbackBtn.exists()).toBe(true);
      expect(feedbackBtn.text()).toContain('Feedback');
    });

    it('external links open in new tab', () => {
      wrapper = createWrapper();
      const links = wrapper.findAll('a.resource-link');
      links.forEach((link) => {
        expect(link.attributes('target')).toBe('_blank');
        expect(link.attributes('rel')).toBe('noopener noreferrer');
      });
    });
  });

  describe('Feedback Modal', () => {
    it('does not show feedback modal initially', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('shows feedback modal when Feedback button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    });

    it('displays modal header with title', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.modal-header h3').text()).toBe('Send Feedback');
    });

    it('displays close button in modal header', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.close-btn').exists()).toBe(true);
    });

    it('displays feedback textarea', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.feedback-textarea').exists()).toBe(true);
    });

    it('displays image upload section', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.image-upload-section').exists()).toBe(true);
    });

    it('displays Cancel and Send buttons', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.btn-secondary').text()).toBe('Cancel');
      expect(wrapper.find('.btn-primary').text()).toBe('Send Feedback');
    });

    it('closes modal when close button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);

      await wrapper.find('.close-btn').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('closes modal when Cancel button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);

      await wrapper.find('.btn-secondary').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('closes modal when clicking overlay background', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);

      await wrapper.find('.modal-overlay').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });
  });

  describe('Feedback Form Validation', () => {
    it('disables Send button when textarea is empty', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined();
    });

    it('enables Send button when textarea has content', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      expect(wrapper.find('.btn-primary').attributes('disabled')).toBeUndefined();
    });

    it('disables Send button when only whitespace', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('   ');
      expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined();
    });
  });

  describe('Image Upload', () => {
    it('shows upload label initially', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.upload-label').text()).toContain('Attach Screenshot (Optional)');
    });

    it('has hidden file input', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      const fileInput = wrapper.find('.file-input');
      // File input should exist but be hidden with CSS
      expect(fileInput.exists()).toBe(true);
    });

    it('accepts image files', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');
      expect(wrapper.find('.file-input').attributes('accept')).toBe('image/*');
    });

    it('shows image preview after upload', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      // Simulate image upload
      wrapper.vm.uploadedImage = new File([''], 'test.png', { type: 'image/png' });
      wrapper.vm.imagePreview = 'data:image/png;base64,test';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.image-preview').exists()).toBe(true);
    });

    it('shows remove button on image preview', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      wrapper.vm.uploadedImage = new File([''], 'test.png', { type: 'image/png' });
      wrapper.vm.imagePreview = 'data:image/png;base64,test';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.remove-image-btn').exists()).toBe(true);
    });

    it('removes image when remove button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      wrapper.vm.uploadedImage = new File([''], 'test.png', { type: 'image/png' });
      wrapper.vm.imagePreview = 'data:image/png;base64,test';
      await wrapper.vm.$nextTick();

      await wrapper.find('.remove-image-btn').trigger('click');

      expect(wrapper.vm.uploadedImage).toBe(null);
      expect(wrapper.vm.imagePreview).toBe('');
    });

    it('changes label text after image upload', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      wrapper.vm.uploadedImage = new File([''], 'test.png', { type: 'image/png' });
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.upload-label').text()).toContain('Change Screenshot');
    });
  });

  describe('Feedback Submission', () => {
    it('submits feedback to API', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('Test feedback message');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/email/send-feedback',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('includes user info in submission', async () => {
      wrapper = createWrapper({ userEmail: 'user@test.com', userName: 'John' });
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(callBody.userEmail).toBe('user@test.com');
      expect(callBody.userName).toBe('John');
    });

    it('includes screenshot in submission when uploaded', async () => {
      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      wrapper.vm.uploadedImage = new File([''], 'test.png', { type: 'image/png' });
      wrapper.vm.imagePreview = 'data:image/png;base64,testdata';
      await wrapper.vm.$nextTick();

      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      const callBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(callBody.screenshot).toBe('data:image/png;base64,testdata');
    });

    it('shows "Sending..." while submitting', async () => {
      // Make fetch hang
      global.fetch.mockImplementation(() => new Promise(() => {}));

      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.btn-primary').text()).toBe('Sending...');
    });

    it('disables button while submitting', async () => {
      global.fetch.mockImplementation(() => new Promise(() => {}));

      wrapper = createWrapper();
      await wrapper.find('.resource-button').trigger('click');

      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      wrapper.find('.btn-primary').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined();
    });

    it('closes modal on successful submission', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      wrapper = createWrapper();

      await wrapper.find('.resource-button').trigger('click');
      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.vm.showFeedbackModal).toBe(false);
    });

    it('resets form on successful submission', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      wrapper = createWrapper();

      await wrapper.find('.resource-button').trigger('click');
      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.vm.feedbackText).toBe('');
      expect(wrapper.vm.uploadedImage).toBe(null);
      expect(wrapper.vm.imagePreview).toBe('');
    });

    it('shows success modal on successful submission', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      wrapper = createWrapper();

      await wrapper.find('.resource-button').trigger('click');
      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Feedback Sent',
        })
      );
    });

    it('shows error modal on failed submission', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, error: 'Server error' }),
      });

      wrapper = createWrapper();

      await wrapper.find('.resource-button').trigger('click');
      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
        })
      );
    });

    it('handles network errors gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();

      await wrapper.find('.resource-button').trigger('click');
      await wrapper.find('.feedback-textarea').setValue('Test feedback');
      await wrapper.find('.btn-primary').trigger('click');
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
        })
      );
    });
  });

  describe('Component Registration', () => {
    it('has correct component name', () => {
      expect(ResourcesSection.name).toBe('ResourcesSection');
    });

    it('registers SimpleModal component', () => {
      expect(ResourcesSection.components.SimpleModal).toBeDefined();
    });
  });
});
