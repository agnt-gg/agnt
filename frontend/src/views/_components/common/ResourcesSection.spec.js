import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ResourcesSection from './ResourcesSection.vue';

// Mock the config
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    REMOTE_URL: 'http://localhost:3000',
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

const sampleItem = (overrides = {}) => ({
  id: 'item-1',
  user_id: 'user-1',
  user_name: 'Alice',
  type: 'feature_request',
  status: 'open',
  title: 'Add dark mode to workflow editor',
  description: 'It would be great to have dark mode.',
  upvotes: 5,
  downvotes: 1,
  admin_response: null,
  created_at: '2026-07-01 12:00:00',
  updated_at: '2026-07-01 12:00:00',
  has_screenshot: 0,
  my_vote: null,
  ...overrides,
});

const mockListResponse = (items = [], extra = {}) => ({
  ok: true,
  json: () => Promise.resolve({ success: true, items, total: items.length, isAdmin: false, ...extra }),
});

describe('ResourcesSection', () => {
  let wrapper;

  beforeEach(() => {
    global.fetch.mockReset();
    global.fetch.mockResolvedValue(mockListResponse([]));

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

  const createWrapper = () => {
    const mockShowModal = vi.fn().mockResolvedValue(true);
    const wrapper = mount(ResourcesSection, {
      global: {
        stubs: {
          // The feedback board renders inside <Teleport to="body">; without this
          // stub its markup escapes the wrapper subtree and every find() below
          // returns an empty DOMWrapper.
          teleport: true,
          SimpleModal: {
            template: '<div class="simple-modal-stub"></div>',
            methods: {
              showModal: mockShowModal,
            },
          },
          // Stub the shared BaseSelect as a native <select> so tests can drive
          // v-model + @update:modelValue without the teleported CustomSelect dropdown.
          BaseSelect: {
            props: ['modelValue', 'options'],
            emits: ['update:modelValue'],
            template:
              '<select class="base-select-stub" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)">' +
              '<option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>' +
              '</select>',
          },
        },
      },
      attachTo: document.body,
    });

    wrapper.mockShowModal = mockShowModal;
    return wrapper;
  };

  const openBoard = async () => {
    await wrapper.find('.resource-button').trigger('click');
    await flushPromises();
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

  describe('Feedback Board Modal', () => {
    it('does not show board modal initially', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('shows board modal when Feedback button is clicked', async () => {
      wrapper = createWrapper();
      await openBoard();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('.modal-header h3').text()).toBe('Community Feedback');
    });

    it('fetches the feedback list when opened', async () => {
      wrapper = createWrapper();
      await openBoard();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3000/feedback?'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('shows empty state when there are no items', async () => {
      wrapper = createWrapper();
      await openBoard();
      expect(wrapper.find('.board-empty').text()).toContain('No feedback yet');
    });

    it('renders feedback items with vote counts', async () => {
      global.fetch.mockResolvedValue(mockListResponse([sampleItem()]));
      wrapper = createWrapper();
      await openBoard();

      const item = wrapper.find('.feedback-item');
      expect(item.exists()).toBe(true);
      expect(item.find('.item-title').text()).toBe('Add dark mode to workflow editor');
      expect(item.find('.vote-count').text()).toBe('4'); // 5 up - 1 down
      expect(item.find('.status-pill').text()).toBe('Open');
    });

    it('shows error state with retry when list fetch fails', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      wrapper = createWrapper();
      await openBoard();
      expect(wrapper.find('.board-empty').text()).toContain('Network error');
    });

    it('uses the shared BaseSelect component for filter and sort (not raw <select>)', async () => {
      wrapper = createWrapper();
      await openBoard();
      // No native <select> should exist — the board must use the shared custom select.
      expect(wrapper.find('select:not(.base-select-stub)').exists()).toBe(false);
      // Two toolbar selects: filter + sort.
      expect(wrapper.findAll('.board-toolbar .base-select-stub').length).toBe(2);
    });

    it('changing the filter select refetches with the type param', async () => {
      global.fetch.mockResolvedValue(mockListResponse([]));
      wrapper = createWrapper();
      await openBoard();
      global.fetch.mockClear();

      const filterSelect = wrapper.findAll('.board-toolbar .base-select-stub')[0];
      await filterSelect.setValue('bug_report');
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=bug_report'),
        expect.any(Object)
      );
    });

    it('closes modal when close button is clicked', async () => {
      wrapper = createWrapper();
      await openBoard();
      await wrapper.find('.close-btn').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('closes modal when clicking overlay background', async () => {
      wrapper = createWrapper();
      await openBoard();
      await wrapper.find('.modal-overlay').trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });
  });

  describe('Voting', () => {
    it('sends an upvote and applies the returned counts', async () => {
      global.fetch.mockImplementation((url, options = {}) => {
        if (url.includes('/vote')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, upvotes: 6, downvotes: 1, my_vote: 'up' }),
          });
        }
        return Promise.resolve(mockListResponse([sampleItem()]));
      });

      wrapper = createWrapper();
      await openBoard();

      await wrapper.find('.vote-btn').trigger('click'); // first vote-btn is the upvote
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/feedback/item-1/vote',
        expect.objectContaining({ method: 'POST' })
      );
      expect(wrapper.find('.vote-count').text()).toBe('5'); // 6 - 1
      expect(wrapper.find('.vote-btn').classes()).toContain('active');
    });
  });

  describe('Item Expansion', () => {
    it('expands an item to show the description', async () => {
      global.fetch.mockResolvedValue(mockListResponse([sampleItem()]));
      wrapper = createWrapper();
      await openBoard();

      await wrapper.find('.item-body').trigger('click');
      expect(wrapper.find('.item-description').text()).toBe('It would be great to have dark mode.');
    });

    it('shows official response when present', async () => {
      global.fetch.mockResolvedValue(mockListResponse([sampleItem({ admin_response: 'Shipping next week!' })]));
      wrapper = createWrapper();
      await openBoard();

      await wrapper.find('.item-body').trigger('click');
      expect(wrapper.find('.admin-response').text()).toContain('Shipping next week!');
    });

    it('shows admin controls only for admins', async () => {
      global.fetch.mockResolvedValue(mockListResponse([sampleItem()], { isAdmin: true }));
      wrapper = createWrapper();
      await openBoard();

      await wrapper.find('.item-body').trigger('click');
      expect(wrapper.find('.admin-controls').exists()).toBe(true);
    });

    it('hides admin controls for regular users', async () => {
      global.fetch.mockResolvedValue(mockListResponse([sampleItem()]));
      wrapper = createWrapper();
      await openBoard();

      await wrapper.find('.item-body').trigger('click');
      expect(wrapper.find('.admin-controls').exists()).toBe(false);
    });
  });

  describe('Submit Form', () => {
    const openSubmitForm = async () => {
      await openBoard();
      const newBtn = wrapper.findAll('.btn-primary').find((b) => b.text().includes('Submit New'));
      await newBtn.trigger('click');
    };

    it('switches to the submit view', async () => {
      wrapper = createWrapper();
      await openSubmitForm();
      expect(wrapper.find('.modal-header h3').text()).toBe('Submit Feedback');
      expect(wrapper.find('.feedback-textarea').exists()).toBe(true);
      expect(wrapper.find('.image-upload-section').exists()).toBe(true);
    });

    it('disables Submit until the title has at least 3 characters', async () => {
      wrapper = createWrapper();
      await openSubmitForm();

      const findSubmit = () => wrapper.findAll('.btn-primary').find((b) => b.text().includes('Submit'));
      expect(findSubmit().attributes('disabled')).toBeDefined();

      await wrapper.find('.form-input').setValue('My idea');
      // Re-query rather than reusing the pre-render wrapper: the teleport stub
      // rebuilds its slot subtree, so the earlier element is detached. (The real
      // <Teleport> patches in place — verified — so this is a harness detail only.)
      expect(findSubmit().attributes('disabled')).toBeUndefined();
    });

    it('submits the feedback item to the API', async () => {
      wrapper = createWrapper();
      await openSubmitForm();

      await wrapper.find('.form-input').setValue('My new feature idea');
      await wrapper.find('.feedback-textarea').setValue('Details here');

      const submitBtn = wrapper.findAll('.btn-primary').find((b) => b.text().includes('Submit'));
      await submitBtn.trigger('click');
      await flushPromises();

      const createCall = global.fetch.mock.calls.find(
        ([url, options]) => url === 'http://localhost:3000/feedback' && options?.method === 'POST'
      );
      expect(createCall).toBeDefined();
      const body = JSON.parse(createCall[1].body);
      expect(body.title).toBe('My new feature idea');
      expect(body.description).toBe('Details here');
      expect(body.type).toBe('feature_request');
    });

    it('shows success modal and returns to the board on success', async () => {
      wrapper = createWrapper();
      await openSubmitForm();

      await wrapper.find('.form-input').setValue('My new feature idea');
      const submitBtn = wrapper.findAll('.btn-primary').find((b) => b.text().includes('Submit'));
      await submitBtn.trigger('click');
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Feedback Submitted' })
      );
      expect(wrapper.find('.modal-header h3').text()).toBe('Community Feedback');
    });

    it('shows error modal on failed submission', async () => {
      global.fetch.mockImplementation((url, options = {}) => {
        if (options.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: false, error: 'Server error' }),
          });
        }
        return Promise.resolve(mockListResponse([]));
      });

      wrapper = createWrapper();
      await openSubmitForm();

      await wrapper.find('.form-input').setValue('My new feature idea');
      const submitBtn = wrapper.findAll('.btn-primary').find((b) => b.text().includes('Submit'));
      await submitBtn.trigger('click');
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    });

    it('Cancel returns to the board view', async () => {
      wrapper = createWrapper();
      await openSubmitForm();
      await wrapper.find('.btn-secondary').trigger('click');
      expect(wrapper.find('.modal-header h3').text()).toBe('Community Feedback');
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
