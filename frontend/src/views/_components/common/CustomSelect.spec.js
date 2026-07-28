import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

  describe('v-model', () => {
    it('renders the bound value on first paint, with no post-mount correction', () => {
      // The old contract required the parent to poke setSelectedOption after
      // mount, which showed the placeholder for a frame first.
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 3 } });
      expect(wrapper.find('.selected').text()).toBe('Option 3');
      wrapper.unmount();
    });

    it('emits update:modelValue with the option value', async () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 1 }, attachTo: document.body });

      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();
      document.querySelectorAll('.option')[1].dispatchEvent(new Event('click'));
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:modelValue')[0]).toEqual([2]);
      wrapper.unmount();
    });

    it('preserves the value type instead of stringifying it', async () => {
      // A native <select> coerces every value to a string, which is why call
      // sites needed v-model.number. Options carry their own values here.
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 1 }, attachTo: document.body });

      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();
      document.querySelectorAll('.option')[2].dispatchEvent(new Event('click'));
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('update:modelValue')[0][0]).toBe(3);
      expect(typeof wrapper.emitted('update:modelValue')[0][0]).toBe('number');
      wrapper.unmount();
    });

    it('follows the bound value when the parent changes it', async () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 1 } });
      await wrapper.setProps({ modelValue: 2 });
      expect(wrapper.find('.selected').text()).toBe('Option 2');
      wrapper.unmount();
    });

    it('falls back to the placeholder when the value matches no option', () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 99, placeholder: 'Pick one' } });
      expect(wrapper.find('.selected').text()).toBe('Pick one');
      expect(wrapper.find('.selected').classes()).toContain('placeholder');
      wrapper.unmount();
    });

    it('shows the placeholder for an empty-string value with no matching option', () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: '', placeholder: 'Select a skill...' } });
      expect(wrapper.find('.selected').text()).toBe('Select a skill...');
      wrapper.unmount();
    });

    it('goes stale-safe when the options list drops the selected value', async () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 3 } });
      await wrapper.setProps({ options: options.slice(0, 2) });
      expect(wrapper.find('.selected').text()).toBe('Select an Option');
      wrapper.unmount();
    });

    it('still supports the legacy ref-driven mode when unbound', async () => {
      const wrapper = mount(CustomSelect, { props: { options } });
      wrapper.vm.setSelectedOption(options[1]);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.selected').text()).toBe('Option 2');
      wrapper.unmount();
    });
  });

  describe('disabled', () => {
    it('does not open on click', async () => {
      const wrapper = mount(CustomSelect, { props: { options, disabled: true }, attachTo: document.body });
      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      expect(document.querySelectorAll('.option')).toHaveLength(0);
      expect(wrapper.classes()).toContain('is-disabled');
      wrapper.unmount();
    });

    it('does not open on keyboard', async () => {
      const wrapper = mount(CustomSelect, { props: { options, disabled: true }, attachTo: document.body });
      await wrapper.trigger('keydown', { key: 'Enter' });
      await wrapper.vm.$nextTick();

      expect(document.querySelectorAll('.option')).toHaveLength(0);
      wrapper.unmount();
    });

    it('is removed from the tab order and announced to assistive tech', () => {
      const wrapper = mount(CustomSelect, { props: { options, disabled: true } });
      expect(wrapper.attributes('tabindex')).toBe('-1');
      expect(wrapper.attributes('aria-disabled')).toBe('true');
      wrapper.unmount();
    });
  });

  describe('long labels', () => {
    const long = [{ label: 'An extremely long option label that cannot fit an 80px control', value: 'x' }];

    it('renders the label in its own truncatable element', () => {
      const wrapper = mount(CustomSelect, { props: { options: long, modelValue: 'x' } });
      expect(wrapper.find('.selected-label').exists()).toBe(true);
      expect(wrapper.find('.selected-label').text()).toBe(long[0].label);
      wrapper.unmount();
    });

    it('exposes the full text on hover so truncation never hides information', async () => {
      // Via the app's tooltip rather than the OS one, so it is themed and
      // appears immediately.
      const wrapper = mount(CustomSelect, { props: { options: long, modelValue: 'x' }, attachTo: document.body });
      await wrapper.find('.selected').trigger('mouseenter');

      expect(document.querySelector('.tooltip-text')?.textContent).toBe(long[0].label);
      expect(wrapper.find('.selected').attributes('title')).toBeUndefined();

      await wrapper.find('.selected').trigger('mouseleave');
      wrapper.unmount();
    });
  });

  describe('open behaviour', () => {
    it('highlights the current option so keyboard nav starts where the user is', async () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 3 }, attachTo: document.body });
      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      expect(document.querySelectorAll('.option')[2].classList.contains('highlighted')).toBe(true);
      wrapper.unmount();
    });

    it('marks the current option as selected in the menu', async () => {
      const wrapper = mount(CustomSelect, { props: { options, modelValue: 2 }, attachTo: document.body });
      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      const rendered = document.querySelectorAll('.option');
      expect(rendered[1].getAttribute('aria-selected')).toBe('true');
      expect(rendered[0].getAttribute('aria-selected')).toBe('false');
      wrapper.unmount();
    });

    it('lets the menu grow past a narrow trigger so a long option stays readable', async () => {
      const wrapper = mount(CustomSelect, {
        props: { options: [{ label: 'An extremely long option label', value: 'x' }], modelValue: 'x' },
        attachTo: document.body,
      });
      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      const style = wrapper.vm.dropdownStyle;
      expect(style.width).toBe('max-content');
      expect(style.minWidth).toMatch(/px$/);
      expect(style.maxWidth).toMatch(/px$/);
      wrapper.unmount();
    });

    it('clamps the menu inside the viewport rather than off the right edge', async () => {
      const wrapper = mount(CustomSelect, { props: { options }, attachTo: document.body });
      // Pin the trigger near the right edge of the window.
      wrapper.element.getBoundingClientRect = () => ({ left: window.innerWidth - 120, bottom: 40, width: 100, height: 32 });

      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      const left = window.innerWidth - 120;
      expect(parseFloat(wrapper.vm.dropdownStyle.maxWidth)).toBeLessThanOrEqual(window.innerWidth - left);
      wrapper.unmount();
    });

    it('never lets the menu be narrower than its trigger', async () => {
      const wrapper = mount(CustomSelect, { props: { options }, attachTo: document.body });
      wrapper.element.getBoundingClientRect = () => ({ left: 10, bottom: 40, width: 260, height: 32 });

      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dropdownStyle.minWidth).toBe('260px');
      expect(parseFloat(wrapper.vm.dropdownStyle.maxWidth)).toBeGreaterThanOrEqual(260);
      wrapper.unmount();
    });

    it('carries the trigger type scale onto the teleported menu', async () => {
      // The menu lives in <body> and inherits nothing from the call site, so a
      // caller's font-size would otherwise apply to the trigger only.
      const wrapper = mount(CustomSelect, { props: { options }, attachTo: document.body });
      wrapper.element.style.fontSize = '11px';
      wrapper.element.style.fontFamily = 'Courier New';

      await wrapper.find('.selected').trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dropdownStyle.fontSize).toBe('11px');
      expect(wrapper.vm.dropdownStyle.fontFamily).toBe('Courier New');
      wrapper.unmount();
    });
  });

  describe('chrome ownership', () => {
    // Call sites keep classes written for a native <select>. Those rules carry
    // layout AND chrome; only layout may survive the swap.
    const source = readFileSync(path.resolve('src/views/_components/common/CustomSelect.vue'), 'utf8');
    const chromeRule = source.match(/\.custom-select\.custom-select\s*\{([^}]*)\}/);

    it('wins chrome deterministically instead of relying on source order', () => {
      expect(chromeRule, 'the doubled-class chrome rule must exist').toBeTruthy();
      for (const property of ['background', 'border', 'border-radius', 'padding', 'box-sizing']) {
        expect(chromeRule[1]).toContain(property);
      }
    });

    it('leaves width and height to the call site', () => {
      expect(chromeRule[1]).not.toMatch(/(^|[;\s])width\s*:/);
      expect(chromeRule[1]).not.toMatch(/(^|[;\s])height\s*:/);
    });

    it('declares its default width at zero specificity so a call site can beat it', () => {
      // `.custom-select` and a caller's `.sort-select` are both one class, so a
      // plain rule would tie and be decided by bundle order. :where() cannot.
      expect(source).toMatch(/:where\(\.custom-select\)\s*\{[^}]*width\s*:/);

      const plainRules = [...source.matchAll(/(^|\})\s*\.custom-select\s*\{([^}]*)\}/g)];
      for (const rule of plainRules) {
        expect(rule[2], 'width must not be declared on the single-class rule').not.toMatch(/(^|[;\s])width\s*:/);
      }
    });

    it('styles every state class the template applies', () => {
      // `highlighted` was applied by the template while the stylesheet said
      // `highlight`, so keyboard navigation moved a cursor nobody could see.
      // A class with no rule is invisible in exactly the same way a missing
      // component is, and just as silent.
      const template = /<template>([\s\S]*?)<\/template>/.exec(source)[1];
      const styles = source.slice(source.indexOf('<style'));

      const applied = new Set();
      for (const match of template.matchAll(/\{\s*([a-zA-Z][\w-]*)\s*:/g)) applied.add(match[1]);

      const unstyled = [...applied].filter((name) => !new RegExp(`\\.${name}\\b`).test(styles));
      expect(unstyled, `state class(es) applied by the template but never styled: ${unstyled.join(', ')}`).toEqual([]);
    });

    it('gives the selected option a cue that is not only colour', () => {
      const rule = /\.option\.selected\s*\{([^}]*)\}/.exec(source);
      expect(rule).toBeTruthy();
      expect(rule[1]).toMatch(/background/);
    });

    it('draws the caret in a colour that is visible against the surface', () => {
      // --terminal-border-color on the app background is ~1.3:1.
      const caret = /\.selected::after\s*\{([^}]*)\}/.exec(source);
      expect(caret[1]).toContain('border-top-color: var(--color-text-muted)');
    });

    it('does not reach for !important to get there', () => {
      expect(chromeRule[1]).not.toContain('!important');
    });

    it('truncates a long label on a flex CHILD, since ellipsis cannot apply to the flex box itself', () => {
      // `.selected` is display:flex, so text-overflow declared on it is inert
      // and a long option runs straight through the right border.
      const label = source.match(/\.custom-select \.selected-label\s*\{([^}]*)\}/);
      expect(label, 'the label needs its own element').toBeTruthy();
      expect(label[1]).toContain('text-overflow: ellipsis');
      expect(label[1]).toContain('min-width: 0');
      expect(label[1]).toContain('white-space: nowrap');
    });
  });
});
