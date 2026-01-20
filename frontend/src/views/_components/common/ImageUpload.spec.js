import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ImageUpload from './ImageUpload.vue';

describe('ImageUpload', () => {
  let wrapper;

  // Mock FileReader
  const mockFileReader = {
    readAsDataURL: vi.fn(),
    result: 'data:image/png;base64,mockBase64Data',
    onload: null,
    onerror: null,
  };

  // Mock Image
  const mockImage = {
    width: 100,
    height: 100,
    onload: null,
    onerror: null,
    src: '',
  };

  // Store original createElement
  let originalCreateElement;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock FileReader
    global.FileReader = vi.fn(() => mockFileReader);

    // Mock Image
    global.Image = vi.fn(() => mockImage);

    // Store original and mock canvas
    originalCreateElement = document.createElement;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      })),
      toDataURL: vi.fn(() => 'data:image/png;base64,compressedData'),
    };
    document.createElement = vi.fn((tag) => {
      if (tag === 'canvas') return mockCanvas;
      return originalCreateElement.call(document, tag);
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Restore original createElement
    if (originalCreateElement) {
      document.createElement = originalCreateElement;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(ImageUpload, {
      props: {
        ...props,
      },
      attachTo: document.body,
    });
  };

  const createMockFile = (name = 'test.png', type = 'image/png', size = 1024) => {
    return new File(['mock content'], name, { type, size });
  };

  describe('Rendering', () => {
    it('renders upload area', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.upload-area').exists()).toBe(true);
    });

    it('renders upload prompt when no images', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.upload-prompt').exists()).toBe(true);
    });

    it('displays label when provided', () => {
      wrapper = createWrapper({ label: 'Upload Image' });
      expect(wrapper.find('.upload-label').text()).toBe('Upload Image');
    });

    it('does not display label when not provided', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.upload-label').exists()).toBe(false);
    });

    it('displays correct prompt text for single mode', () => {
      wrapper = createWrapper({ multiple: false });
      expect(wrapper.find('.prompt-text').text()).toBe('Click or drag image here');
    });

    it('displays correct prompt text for multiple mode', () => {
      wrapper = createWrapper({ multiple: true });
      expect(wrapper.find('.prompt-text').text()).toBe('Click or drag images here');
    });

    it('displays size hint', () => {
      wrapper = createWrapper({ maxSize: 500 });
      expect(wrapper.find('.prompt-hint').text()).toContain('Max 500KB');
    });

    it('displays count hint in multiple mode', () => {
      wrapper = createWrapper({ multiple: true, maxImages: 3 });
      expect(wrapper.find('.prompt-hint').text()).toContain('up to 3 images');
    });

    it('hides file input', () => {
      wrapper = createWrapper();
      // File input exists but is hidden via CSS (position: absolute, opacity: 0, etc.)
      const fileInput = wrapper.find('.file-input');
      expect(fileInput.exists()).toBe(true);
    });
  });

  describe('Image Preview', () => {
    it('shows image preview when modelValue is provided', () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });
      expect(wrapper.find('.image-previews').exists()).toBe(true);
      expect(wrapper.find('.preview-image').exists()).toBe(true);
    });

    it('shows multiple previews for array modelValue', () => {
      wrapper = createWrapper({
        modelValue: ['data:image/png;base64,test1', 'data:image/png;base64,test2'],
        multiple: true,
      });
      expect(wrapper.findAll('.image-preview-item').length).toBe(2);
    });

    it('hides upload prompt when images exist', () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });
      expect(wrapper.find('.upload-prompt').exists()).toBe(false);
    });

    it('shows remove button on image preview', () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });
      expect(wrapper.find('.remove-image-btn').exists()).toBe(true);
    });

    it('applies correct preview size class', () => {
      wrapper = createWrapper({
        modelValue: 'data:image/png;base64,test',
        previewSize: 'large',
      });
      expect(wrapper.find('.image-previews').classes()).toContain('large');
    });
  });

  describe('Add More Button', () => {
    it('shows add more button in multiple mode with images', () => {
      wrapper = createWrapper({
        modelValue: ['data:image/png;base64,test'],
        multiple: true,
        maxImages: 5,
      });
      expect(wrapper.find('.add-more-btn').exists()).toBe(true);
    });

    it('hides add more button when max images reached', () => {
      wrapper = createWrapper({
        modelValue: ['img1', 'img2', 'img3'],
        multiple: true,
        maxImages: 3,
      });
      expect(wrapper.find('.add-more-btn').exists()).toBe(false);
    });

    it('hides add more button in single mode', () => {
      wrapper = createWrapper({
        modelValue: 'data:image/png;base64,test',
        multiple: false,
      });
      expect(wrapper.find('.add-more-btn').exists()).toBe(false);
    });
  });

  describe('File Input Trigger', () => {
    it('triggers file input when upload area is clicked', async () => {
      wrapper = createWrapper();
      const fileInput = wrapper.find('.file-input');
      const clickSpy = vi.spyOn(fileInput.element, 'click');

      await wrapper.find('.upload-area').trigger('click');

      expect(clickSpy).toHaveBeenCalled();
    });

    it('triggers file input when add more button is clicked', async () => {
      wrapper = createWrapper({
        modelValue: ['data:image/png;base64,test'],
        multiple: true,
      });
      const fileInput = wrapper.find('.file-input');
      const clickSpy = vi.spyOn(fileInput.element, 'click');

      await wrapper.find('.add-more-btn').trigger('click');

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Drag and Drop', () => {
    it('adds drag-over class on dragover', async () => {
      wrapper = createWrapper();
      await wrapper.find('.upload-area').trigger('dragover');
      expect(wrapper.find('.upload-area').classes()).toContain('drag-over');
    });

    it('removes drag-over class on dragleave', async () => {
      wrapper = createWrapper();
      await wrapper.find('.upload-area').trigger('dragover');
      await wrapper.find('.upload-area').trigger('dragleave');
      expect(wrapper.find('.upload-area').classes()).not.toContain('drag-over');
    });

    it('removes drag-over class on drop', async () => {
      wrapper = createWrapper();
      await wrapper.find('.upload-area').trigger('dragover');

      const dropEvent = {
        dataTransfer: {
          files: [],
        },
      };
      await wrapper.find('.upload-area').trigger('drop', dropEvent);

      expect(wrapper.find('.upload-area').classes()).not.toContain('drag-over');
    });
  });

  describe('Remove Image', () => {
    it('emits null when removing single image', async () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });

      await wrapper.find('.remove-image-btn').trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual([null]);
    });

    it('emits updated array when removing from multiple images', async () => {
      wrapper = createWrapper({
        modelValue: ['img1', 'img2', 'img3'],
        multiple: true,
      });

      const removeButtons = wrapper.findAll('.remove-image-btn');
      await removeButtons[1].trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual([['img1', 'img3']]);
    });

    it('emits empty array when removing last image in multiple mode', async () => {
      wrapper = createWrapper({
        modelValue: ['img1'],
        multiple: true,
      });

      await wrapper.find('.remove-image-btn').trigger('click');

      expect(wrapper.emitted('update:modelValue')[0]).toEqual([[]]);
    });

    it('clears error message when removing image', async () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });
      wrapper.vm.errorMessage = 'Some error';
      await wrapper.vm.$nextTick();

      await wrapper.find('.remove-image-btn').trigger('click');

      expect(wrapper.vm.errorMessage).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('shows error message when set', async () => {
      wrapper = createWrapper();
      wrapper.vm.errorMessage = 'Test error message';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toContain('Test error message');
    });

    it('clears error message after 5 seconds', async () => {
      wrapper = createWrapper();
      wrapper.vm.errorMessage = 'Test error';
      await wrapper.vm.$nextTick();

      vi.advanceTimersByTime(5000);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.errorMessage).toBe('');
    });

    it('emits error event on invalid file', async () => {
      wrapper = createWrapper();

      // Simulate file selection with non-image file
      const fileInput = wrapper.find('.file-input');
      const mockEvent = {
        target: {
          files: [new File(['content'], 'test.txt', { type: 'text/plain' })],
          value: 'test.txt',
        },
      };

      await wrapper.vm.handleFileSelect(mockEvent);

      expect(wrapper.emitted('error')).toBeTruthy();
      expect(wrapper.emitted('error')[0]).toEqual(['Please select valid image files']);
    });
  });

  describe('Info Message', () => {
    it('shows info message when set', async () => {
      wrapper = createWrapper();
      wrapper.vm.infoMessage = 'Processing images...';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.info-message').exists()).toBe(true);
      expect(wrapper.find('.info-message').text()).toBe('Processing images...');
    });
  });

  describe('Props Validation', () => {
    it('accepts valid previewSize values', () => {
      const validator = ImageUpload.props.previewSize.validator;
      expect(validator('small')).toBe(true);
      expect(validator('medium')).toBe(true);
      expect(validator('large')).toBe(true);
      expect(validator('invalid')).toBe(false);
    });

    it('uses default maxSize of 200KB', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.prompt-hint').text()).toContain('Max 200KB');
    });

    it('uses default maxImages of 5', () => {
      wrapper = createWrapper({ multiple: true });
      expect(wrapper.find('.prompt-hint').text()).toContain('up to 5 images');
    });
  });

  describe('CSS Classes', () => {
    it('adds has-images class when images exist', () => {
      wrapper = createWrapper({ modelValue: 'data:image/png;base64,test' });
      expect(wrapper.find('.upload-area').classes()).toContain('has-images');
    });

    it('adds multiple class in multiple mode', () => {
      wrapper = createWrapper({ multiple: true });
      expect(wrapper.find('.upload-area').classes()).toContain('multiple');
    });

    it('does not have has-images class when no images', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.upload-area').classes()).not.toContain('has-images');
    });
  });

  describe('Computed Properties', () => {
    it('imageArray returns empty array for null modelValue', () => {
      wrapper = createWrapper({ modelValue: null });
      expect(wrapper.vm.imageArray).toEqual([]);
    });

    it('imageArray wraps single value in array', () => {
      wrapper = createWrapper({ modelValue: 'single-image' });
      expect(wrapper.vm.imageArray).toEqual(['single-image']);
    });

    it('imageArray returns array as-is', () => {
      wrapper = createWrapper({ modelValue: ['img1', 'img2'] });
      expect(wrapper.vm.imageArray).toEqual(['img1', 'img2']);
    });

    it('hasImages returns false for empty array', () => {
      wrapper = createWrapper({ modelValue: [] });
      expect(wrapper.vm.hasImages).toBe(false);
    });

    it('hasImages returns true for non-empty array', () => {
      wrapper = createWrapper({ modelValue: ['img1'] });
      expect(wrapper.vm.hasImages).toBe(true);
    });

    it('canAddMore returns true when under limit', () => {
      wrapper = createWrapper({
        modelValue: ['img1'],
        multiple: true,
        maxImages: 5,
      });
      expect(wrapper.vm.canAddMore).toBe(true);
    });

    it('canAddMore returns false when at limit', () => {
      wrapper = createWrapper({
        modelValue: ['img1', 'img2', 'img3'],
        multiple: true,
        maxImages: 3,
      });
      expect(wrapper.vm.canAddMore).toBe(false);
    });
  });

  describe('File Accept Attribute', () => {
    it('uses default accept attribute', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.file-input').attributes('accept')).toBe('image/*');
    });

    it('uses custom accept attribute', () => {
      wrapper = createWrapper({ accept: 'image/png,image/jpeg' });
      expect(wrapper.find('.file-input').attributes('accept')).toBe('image/png,image/jpeg');
    });
  });

  describe('Multiple Attribute', () => {
    it('file input has multiple attribute in multiple mode', () => {
      wrapper = createWrapper({ multiple: true });
      expect(wrapper.find('.file-input').attributes('multiple')).toBeDefined();
    });

    it('file input does not have multiple attribute in single mode', () => {
      wrapper = createWrapper({ multiple: false });
      expect(wrapper.find('.file-input').attributes('multiple')).toBeUndefined();
    });
  });
});
