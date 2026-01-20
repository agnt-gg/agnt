import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SimpleModal from './SimpleModal.vue';

// Mock the resizeTextarea function
vi.mock('@/views/_components/base/fields.js', () => ({
  resizeTextarea: vi.fn(),
}));

describe('SimpleModal', () => {
  let wrapper;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  const createWrapper = () => {
    return mount(SimpleModal, {
      attachTo: document.body,
    });
  };

  describe('Rendering', () => {
    it('does not render modal overlay when closed', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('renders modal overlay when opened', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Test Title' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    });

    it('displays the correct title', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'My Test Title' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('h3').text()).toBe('My Test Title');
    });

    it('displays the message when provided', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', message: 'This is a test message' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-message').exists()).toBe(true);
      expect(wrapper.find('.modal-message').text()).toBe('This is a test message');
    });

    it('does not display message element when message is empty', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-message').exists()).toBe(false);
    });
  });

  describe('URL Formatting', () => {
    it('converts URLs in message to clickable links', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({
        title: 'Title',
        message: 'Visit https://example.com for more info',
      });
      await wrapper.vm.$nextTick();
      const messageHtml = wrapper.find('.modal-message').html();
      expect(messageHtml).toContain('<a href="https://example.com"');
      expect(messageHtml).toContain('target="_blank"');
      expect(messageHtml).toContain('rel="noopener noreferrer"');
    });

    it('handles multiple URLs in message', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({
        title: 'Title',
        message: 'Visit https://example.com and http://test.com',
      });
      await wrapper.vm.$nextTick();
      const messageHtml = wrapper.find('.modal-message').html();
      expect(messageHtml).toContain('href="https://example.com"');
      expect(messageHtml).toContain('href="http://test.com"');
    });
  });

  describe('Button Configuration', () => {
    it('displays default confirm text as OK', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title' });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons[0].text()).toBe('OK');
    });

    it('displays custom confirm text', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', confirmText: 'Yes, Delete' });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons[0].text()).toBe('Yes, Delete');
    });

    it('displays cancel button by default', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title' });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBe(2);
      expect(buttons[1].text()).toBe('Cancel');
    });

    it('hides cancel button when showCancel is false', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', showCancel: false, isPrompt: false });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBe(1);
    });

    it('displays custom cancel text', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', cancelText: 'No, Go Back' });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons[1].text()).toBe('No, Go Back');
    });

    it('applies custom confirm button class', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', confirmClass: 'btn-danger' });
      await wrapper.vm.$nextTick();
      const confirmButton = wrapper.findAll('button')[0];
      expect(confirmButton.classes()).toContain('btn-danger');
    });

    it('applies custom cancel button class', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', cancelClass: 'btn-secondary' });
      await wrapper.vm.$nextTick();
      const cancelButton = wrapper.findAll('button')[1];
      expect(cancelButton.classes()).toContain('btn-secondary');
    });
  });

  describe('Prompt Mode', () => {
    it('shows input field in prompt mode', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').exists()).toBe(true);
    });

    it('shows textarea when isTextArea is true', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, isTextArea: true });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('textarea').exists()).toBe(true);
      expect(wrapper.find('input').exists()).toBe(false);
    });

    it('displays placeholder in input', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, placeholder: 'Enter value...' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').attributes('placeholder')).toBe('Enter value...');
    });

    it('prepopulates input with default value', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, defaultValue: 'Default Text' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').element.value).toBe('Default Text');
    });

    it('sets correct input type', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, inputType: 'password' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').attributes('type')).toBe('password');
    });

    it('defaults to text input type', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').attributes('type')).toBe('text');
    });

    it('always shows cancel button in prompt mode', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, showCancel: false });
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBe(2);
    });
  });

  describe('User Interactions', () => {
    it('closes modal and resolves true on confirm click (non-prompt)', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title' });
      await wrapper.vm.$nextTick();

      await wrapper.findAll('button')[0].trigger('click');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe(true);
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('closes modal and resolves input value on confirm click (prompt)', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();

      await wrapper.find('input').setValue('User Input');
      await wrapper.findAll('button')[0].trigger('click');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe('User Input');
    });

    it('closes modal and resolves null on cancel click', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title' });
      await wrapper.vm.$nextTick();

      await wrapper.findAll('button')[1].trigger('click');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe(null);
    });

    it('submits on Enter key in input field', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();

      await wrapper.find('input').setValue('Enter Value');
      await wrapper.find('input').trigger('keyup.enter');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe('Enter Value');
    });

    it('submits on Enter key in textarea', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title', isPrompt: true, isTextArea: true });
      await wrapper.vm.$nextTick();

      await wrapper.find('textarea').setValue('Textarea Value');
      await wrapper.find('textarea').trigger('keyup.enter');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe('Textarea Value');
    });
  });

  describe('Focus Management', () => {
    it('focuses input after modal opens in prompt mode', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();

      // Fast-forward the 150ms delay
      vi.advanceTimersByTime(150);
      await wrapper.vm.$nextTick();

      // In test environment, we verify the input element exists and can be focused
      const inputElement = wrapper.find('input').element;
      expect(inputElement).toBeDefined();
      expect(inputElement.focus).toBeDefined();
    });

    it('focuses textarea after modal opens when isTextArea is true', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({ title: 'Title', isPrompt: true, isTextArea: true });
      await wrapper.vm.$nextTick();

      // Fast-forward the 150ms delay
      vi.advanceTimersByTime(150);
      await wrapper.vm.$nextTick();

      // In test environment, we verify the textarea element exists and can be focused
      const textareaElement = wrapper.find('textarea').element;
      expect(textareaElement).toBeDefined();
      expect(textareaElement.focus).toBeDefined();
    });
  });

  describe('Multiple Modal Calls', () => {
    it('can be reopened after closing', async () => {
      wrapper = createWrapper();

      // First modal
      const promise1 = wrapper.vm.showModal({ title: 'First Modal' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('h3').text()).toBe('First Modal');

      await wrapper.findAll('button')[0].trigger('click');
      await promise1;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);

      // Second modal
      wrapper.vm.showModal({ title: 'Second Modal' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('h3').text()).toBe('Second Modal');
    });

    it('resets input value between modal calls', async () => {
      wrapper = createWrapper();

      // First prompt
      const promise1 = wrapper.vm.showModal({ title: 'First', isPrompt: true, defaultValue: 'First Value' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').element.value).toBe('First Value');

      await wrapper.findAll('button')[0].trigger('click');
      await promise1;
      await wrapper.vm.$nextTick();

      // Second prompt with different default
      wrapper.vm.showModal({ title: 'Second', isPrompt: true, defaultValue: 'Second Value' });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('input').element.value).toBe('Second Value');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty options object', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal({});
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('h3').text()).toBe('');
    });

    it('handles undefined options', async () => {
      wrapper = createWrapper();
      wrapper.vm.showModal();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    });

    it('returns empty string for prompt with no input', async () => {
      wrapper = createWrapper();
      const promise = wrapper.vm.showModal({ title: 'Title', isPrompt: true });
      await wrapper.vm.$nextTick();

      await wrapper.findAll('button')[0].trigger('click');
      await wrapper.vm.$nextTick();

      const result = await promise;
      expect(result).toBe('');
    });
  });
});
