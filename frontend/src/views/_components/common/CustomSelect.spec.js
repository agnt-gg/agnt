import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CustomSelect from './CustomSelect.vue';

// Mock the toggleDropdown function
vi.mock('@/base/js/fields', () => ({
  toggleDropdown: vi.fn(),
}));

describe('CustomSelect', () => {
  const options = [
    { label: 'Option 1', value: 1 },
    { label: 'Option 2', value: 2 },
    { label: 'Option 3', value: 3 },
  ];

  // Setup teleport target before each test
  beforeEach(() => {
    const teleportTarget = document.createElement('div');
    teleportTarget.id = 'teleport-target';
    document.body.appendChild(teleportTarget);
  });

  // Cleanup after each test
  afterEach(() => {
    const teleportTarget = document.getElementById('teleport-target');
    if (teleportTarget) {
      document.body.removeChild(teleportTarget);
    }
  });

  it('renders correctly with default placeholder', async () => {
    const wrapper = mount(CustomSelect, {
      props: { options },
      attachTo: document.body,
    });
    expect(wrapper.find('.selected').text()).toBe('Select an Option');

    // Open dropdown to render options
    await wrapper.find('.selected').trigger('click');
    await wrapper.vm.$nextTick();

    // Options are rendered in teleported container
    const optionsInBody = document.querySelectorAll('.option');
    expect(optionsInBody).toHaveLength(3);

    wrapper.unmount();
  });

  it('renders correctly with custom placeholder', () => {
    const placeholder = 'Choose an option';
    const wrapper = mount(CustomSelect, {
      props: { options, placeholder },
    });
    expect(wrapper.find('.selected').text()).toBe('Choose an option');
  });

  it('selects an option when clicked', async () => {
    const wrapper = mount(CustomSelect, {
      props: { options },
      attachTo: document.body,
    });

    // Open dropdown first
    await wrapper.find('.selected').trigger('click');
    await wrapper.vm.$nextTick();

    // Click option in teleported container
    const optionsInBody = document.querySelectorAll('.option');
    await optionsInBody[1].dispatchEvent(new Event('click'));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.selected').text()).toBe('Option 2');
    expect(wrapper.emitted('option-selected')).toBeTruthy();
    expect(wrapper.emitted('option-selected')[0]).toEqual([{ label: 'Option 2', value: 2 }]);

    wrapper.unmount();
  });

  it('handles keyboard navigation', async () => {
    const wrapper = mount(CustomSelect, {
      props: { options },
      attachTo: document.body,
    });

    // Open the dropdown
    await wrapper.find('.selected').trigger('click');
    await wrapper.vm.$nextTick();

    // Check if the first option is highlighted
    await wrapper.trigger('keydown', { key: 'ArrowDown' });
    await wrapper.vm.$nextTick();

    const optionsInBody = document.querySelectorAll('.option');
    expect(optionsInBody[0].classList.contains('highlighted')).toBe(true);

    // Navigate down again
    await wrapper.trigger('keydown', { key: 'ArrowDown' });
    await wrapper.vm.$nextTick();

    // Check if the second option is highlighted
    expect(optionsInBody[1].classList.contains('highlighted')).toBe(true);

    // Press Enter to select the highlighted option
    await wrapper.trigger('keydown', { key: 'Enter' });
    await wrapper.vm.$nextTick();

    // Check if the correct option is selected
    expect(wrapper.find('.selected').text()).toBe('Option 2');
    expect(wrapper.emitted('option-selected')).toBeTruthy();
    expect(wrapper.emitted('option-selected')[0]).toEqual([{ label: 'Option 2', value: 2 }]);

    wrapper.unmount();
  });
});
