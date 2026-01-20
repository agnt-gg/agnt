import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import MarketplaceFormModal from './MarketplaceFormModal.vue';

describe('MarketplaceFormModal', () => {
  let wrapper;
  let store;

  const createMockStore = (planType = 'free') => {
    return createStore({
      modules: {
        userAuth: {
          namespaced: true,
          getters: {
            planType: () => planType,
          },
        },
      },
    });
  };

  const defaultCategories = ['Automation', 'Data Processing', 'AI/ML', 'Utilities', 'Integration'];

  const mockItem = {
    id: 'test-123',
    name: 'Test Item',
    title: 'Test Item',
    description: 'Test description',
    category: 'Automation',
    tags: ['tag1', 'tag2'],
    price: 0,
    preview_image: 'data:image/png;base64,test',
    requirements: 'Node.js 18+',
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
    if (storeOverrides.planType !== undefined) {
      store = createMockStore(storeOverrides.planType);
    }

    return mount(MarketplaceFormModal, {
      props: {
        isOpen: true,
        mode: 'publish',
        itemType: 'workflow',
        categories: defaultCategories,
        ...props,
      },
      global: {
        plugins: [store],
        stubs: {
          SimpleModal: {
            template: '<div class="simple-modal-stub"></div>',
            methods: {
              showModal: vi.fn().mockResolvedValue(true),
            },
          },
          ImageUpload: {
            template: '<div class="image-upload-stub"></div>',
            props: ['modelValue', 'label', 'multiple', 'maxSize', 'previewSize'],
          },
        },
      },
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('renders when isOpen is true', () => {
      wrapper = createWrapper({ isOpen: true });
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    });

    it('does not render when isOpen is false', () => {
      wrapper = createWrapper({ isOpen: false });
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('displays correct title for publish mode', () => {
      wrapper = createWrapper({ mode: 'publish', itemType: 'workflow' });
      expect(wrapper.find('.modal-header h2').text()).toBe('Publish Workflow to Marketplace');
    });

    it('displays correct title for edit mode', () => {
      wrapper = createWrapper({ mode: 'edit', itemType: 'workflow' });
      expect(wrapper.find('.modal-header h2').text()).toBe('Edit Marketplace Listing');
    });

    it('displays correct title for agent type', () => {
      wrapper = createWrapper({ mode: 'publish', itemType: 'agent' });
      expect(wrapper.find('.modal-header h2').text()).toBe('Publish Agent to Marketplace');
    });

    it('displays correct title for tool type', () => {
      wrapper = createWrapper({ mode: 'publish', itemType: 'tool' });
      expect(wrapper.find('.modal-header h2').text()).toBe('Publish Tool to Marketplace');
    });

    it('renders form fields', () => {
      wrapper = createWrapper();
      expect(wrapper.find('input[type="text"]').exists()).toBe(true);
      expect(wrapper.find('textarea').exists()).toBe(true);
      expect(wrapper.find('select').exists()).toBe(true);
    });

    it('renders category options', () => {
      wrapper = createWrapper();
      const options = wrapper.findAll('select option');
      expect(options.length).toBe(defaultCategories.length + 1); // +1 for placeholder
    });

    it('renders close button', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.close-button').exists()).toBe(true);
    });

    it('renders cancel and submit buttons', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.cancel-btn').exists()).toBe(true);
      expect(wrapper.find('.publish-btn').exists()).toBe(true);
    });
  });

  describe('Form Pre-population', () => {
    it('pre-fills form with item data', () => {
      wrapper = createWrapper({ item: mockItem });

      expect(wrapper.find('input[type="text"]').element.value).toBe('Test Item');
      expect(wrapper.find('textarea').element.value).toBe('Test description');
      expect(wrapper.find('select').element.value).toBe('Automation');
    });

    it('pre-fills tags from item', () => {
      wrapper = createWrapper({ item: mockItem });
      expect(wrapper.vm.formData.tags).toEqual(['tag1', 'tag2']);
    });

    it('uses agent avatar as preview image if no preview_image', () => {
      const agentItem = {
        ...mockItem,
        avatar: 'data:image/png;base64,avatar',
        preview_image: '',
      };
      wrapper = createWrapper({ item: agentItem, itemType: 'agent' });
      expect(wrapper.vm.formData.preview_image).toBe('data:image/png;base64,avatar');
    });
  });

  describe('Form Validation', () => {
    it('disables submit when required fields are empty', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.publish-btn').attributes('disabled')).toBeDefined();
    });

    it('enables submit when required fields are filled', async () => {
      wrapper = createWrapper();

      await wrapper.find('input[type="text"]').setValue('Test Title');
      await wrapper.find('textarea').setValue('Test Description');
      await wrapper.find('select').setValue('Automation');

      expect(wrapper.find('.publish-btn').attributes('disabled')).toBeUndefined();
    });

    it('disables submit when price > 0 and stripe not connected', async () => {
      wrapper = createWrapper({ stripeConnected: false }, { planType: 'personal' });

      await wrapper.find('input[type="text"]').setValue('Test Title');
      await wrapper.find('textarea').setValue('Test Description');
      await wrapper.find('select').setValue('Automation');
      await wrapper.find('input[type="number"]').setValue(10);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.publish-btn').attributes('disabled')).toBeDefined();
    });

    it('enables submit when price > 0 and stripe is connected', async () => {
      wrapper = createWrapper({ stripeConnected: true }, { planType: 'personal' });

      await wrapper.find('input[type="text"]').setValue('Test Title');
      await wrapper.find('textarea').setValue('Test Description');
      await wrapper.find('select').setValue('Automation');
      await wrapper.find('input[type="number"]').setValue(10);

      expect(wrapper.find('.publish-btn').attributes('disabled')).toBeUndefined();
    });
  });

  describe('Tags Management', () => {
    it('parses tags from comma-separated input', async () => {
      wrapper = createWrapper();

      const tagsInput = wrapper.findAll('input[type="text"]')[1];
      await tagsInput.setValue('tag1, tag2, tag3');
      await tagsInput.trigger('blur');

      expect(wrapper.vm.formData.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('displays tags as chips', async () => {
      wrapper = createWrapper({ item: mockItem });
      await wrapper.vm.$nextTick();

      expect(wrapper.findAll('.tag').length).toBe(2);
    });

    it('removes tag when clicking remove button', async () => {
      wrapper = createWrapper({ item: mockItem });
      await wrapper.vm.$nextTick();

      const removeButtons = wrapper.findAll('.tag i');
      await removeButtons[0].trigger('click');

      expect(wrapper.vm.formData.tags).toEqual(['tag2']);
    });

    it('filters empty tags', async () => {
      wrapper = createWrapper();

      const tagsInput = wrapper.findAll('input[type="text"]')[1];
      await tagsInput.setValue('tag1, , tag2, ');
      await tagsInput.trigger('blur');

      expect(wrapper.vm.formData.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('Price Input', () => {
    it('disables price input for free users', () => {
      wrapper = createWrapper({}, { planType: 'free' });
      expect(wrapper.find('input[type="number"]').attributes('disabled')).toBeDefined();
    });

    it('enables price input for pro users', () => {
      wrapper = createWrapper({}, { planType: 'personal' });
      expect(wrapper.find('input[type="number"]').attributes('disabled')).toBeUndefined();
    });

    it('shows upgrade prompt for free users', () => {
      wrapper = createWrapper({}, { planType: 'free' });
      expect(wrapper.find('.pro-upgrade-prompt').exists()).toBe(true);
    });

    it('hides upgrade prompt for pro users', () => {
      wrapper = createWrapper({}, { planType: 'personal' });
      expect(wrapper.find('.pro-upgrade-prompt').exists()).toBe(false);
    });

    it('enforces max price of 99999', async () => {
      wrapper = createWrapper({}, { planType: 'personal' });

      const priceInput = wrapper.find('input[type="number"]');
      await priceInput.setValue(100000);
      await priceInput.trigger('input');

      expect(wrapper.vm.formData.price).toBe(99999);
    });

    it('shows revenue info when price > 0', async () => {
      wrapper = createWrapper({}, { planType: 'personal' });

      await wrapper.find('input[type="number"]').setValue(10);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.revenue-info').exists()).toBe(true);
    });

    it('hides revenue info when price is 0', () => {
      wrapper = createWrapper({}, { planType: 'personal' });
      expect(wrapper.find('.revenue-info').exists()).toBe(false);
    });
  });

  describe('Stripe Warning', () => {
    it('shows stripe warning when price > 0 and not connected', async () => {
      wrapper = createWrapper({ stripeConnected: false }, { planType: 'personal' });

      await wrapper.find('input[type="number"]').setValue(10);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.stripe-warning').exists()).toBe(true);
    });

    it('hides stripe warning when stripe is connected', async () => {
      wrapper = createWrapper({ stripeConnected: true }, { planType: 'personal' });

      await wrapper.find('input[type="number"]').setValue(10);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.stripe-warning').exists()).toBe(false);
    });

    it('hides stripe warning when price is 0', () => {
      wrapper = createWrapper({ stripeConnected: false });
      expect(wrapper.find('.stripe-warning').exists()).toBe(false);
    });

    it('emits setup-stripe when setup button clicked', async () => {
      wrapper = createWrapper({ stripeConnected: false }, { planType: 'personal' });

      await wrapper.find('input[type="number"]').setValue(10);
      await wrapper.vm.$nextTick();

      await wrapper.find('.setup-stripe-btn').trigger('click');

      expect(wrapper.emitted('setup-stripe')).toBeTruthy();
    });
  });

  describe('Events', () => {
    it('emits close when close button clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.close-button').trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close when cancel button clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('.cancel-btn').trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close when clicking overlay', async () => {
      wrapper = createWrapper();
      await wrapper.find('.modal-overlay').trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits submit with form data on submit', async () => {
      wrapper = createWrapper({ item: mockItem });

      await wrapper.find('input[type="text"]').setValue('Updated Title');
      await wrapper.find('textarea').setValue('Updated Description');
      await wrapper.find('select').setValue('Automation');

      await wrapper.find('form').trigger('submit');

      expect(wrapper.emitted('submit')).toBeTruthy();
      expect(wrapper.emitted('submit')[0][0].title).toBe('Updated Title');
    });

    it('includes workflow_id in payload for workflow publish', async () => {
      wrapper = createWrapper({
        mode: 'publish',
        itemType: 'workflow',
        item: { id: 'workflow-123', name: 'Test', description: 'Test', category: 'Automation' },
      });

      await wrapper.find('input[type="text"]').setValue('Test');
      await wrapper.find('textarea').setValue('Test');
      await wrapper.find('select').setValue('Automation');

      await wrapper.find('form').trigger('submit');

      expect(wrapper.emitted('submit')[0][0].workflow_id).toBe('workflow-123');
    });

    it('includes asset_id and asset_type for agent publish', async () => {
      wrapper = createWrapper({
        mode: 'publish',
        itemType: 'agent',
        item: { id: 'agent-123', name: 'Test', description: 'Test', category: 'Automation' },
      });

      await wrapper.find('input[type="text"]').setValue('Test');
      await wrapper.find('textarea').setValue('Test');
      await wrapper.find('select').setValue('Automation');

      await wrapper.find('form').trigger('submit');

      const payload = wrapper.emitted('submit')[0][0];
      expect(payload.asset_id).toBe('agent-123');
      expect(payload.asset_type).toBe('agent');
    });

    it('emits open-billing when upgrade link clicked', async () => {
      wrapper = createWrapper({}, { planType: 'free' });

      await wrapper.find('.upgrade-link').trigger('click');

      expect(wrapper.emitted('open-billing')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('Submit Button Text', () => {
    it('shows "Publish to Marketplace" in publish mode', () => {
      wrapper = createWrapper({ mode: 'publish' });
      expect(wrapper.find('.publish-btn').text()).toContain('Publish to Marketplace');
    });

    it('shows "Save Changes" in edit mode', () => {
      wrapper = createWrapper({ mode: 'edit' });
      expect(wrapper.find('.publish-btn').text()).toContain('Save Changes');
    });
  });

  describe('Conditional Fields', () => {
    it('shows preview image when showPreviewImage is true', () => {
      wrapper = createWrapper({ showPreviewImage: true });
      expect(wrapper.find('.image-upload-stub').exists()).toBe(true);
    });

    it('hides preview image when showPreviewImage is false', () => {
      wrapper = createWrapper({ showPreviewImage: false });
      expect(wrapper.find('.image-upload-stub').exists()).toBe(false);
    });

    it('shows requirements when showRequirements is true', () => {
      wrapper = createWrapper({ showRequirements: true });
      expect(wrapper.text()).toContain('Requirements');
    });

    it('hides requirements when showRequirements is false', () => {
      wrapper = createWrapper({ showRequirements: false });
      const labels = wrapper.findAll('label');
      const hasRequirements = labels.some((l) => l.text().includes('Requirements'));
      expect(hasRequirements).toBe(false);
    });
  });

  describe('Props Validation', () => {
    it('validates mode prop', () => {
      const validator = MarketplaceFormModal.props.mode.validator;
      expect(validator('publish')).toBe(true);
      expect(validator('edit')).toBe(true);
      expect(validator('invalid')).toBe(false);
    });

    it('validates itemType prop', () => {
      const validator = MarketplaceFormModal.props.itemType.validator;
      expect(validator('workflow')).toBe(true);
      expect(validator('agent')).toBe(true);
      expect(validator('tool')).toBe(true);
      expect(validator('marketplace-item')).toBe(true);
      expect(validator('invalid')).toBe(false);
    });
  });

  describe('Component Registration', () => {
    it('has correct component name', () => {
      expect(MarketplaceFormModal.name).toBe('MarketplaceFormModal');
    });

    it('registers SimpleModal component', () => {
      expect(MarketplaceFormModal.components.SimpleModal).toBeDefined();
    });

    it('registers ImageUpload component', () => {
      expect(MarketplaceFormModal.components.ImageUpload).toBeDefined();
    });
  });
});
