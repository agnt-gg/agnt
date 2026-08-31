import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Tooltip from './Tooltip.vue';
import { isTooltipVisible, __resetTooltipEngine } from '@/directives/tooltipEngine.js';

/**
 * This component had no tests and 276 call sites. These cover its public
 * contract so the move onto the shared engine is verifiable rather than hoped.
 */

const tooltipEl = () => document.querySelector('.tooltip');
const tooltipText = () => document.querySelector('.tooltip-text')?.textContent;

const mountTooltip = (props = {}, slot = '<button id="trigger">Act</button>') =>
  mount(Tooltip, { props: { text: 'Delete', ...props }, slots: { default: slot }, attachTo: document.body });

describe('Tooltip', () => {
  beforeEach(() => {
    __resetTooltipEngine();
    vi.stubGlobal('requestAnimationFrame', (cb) => cb(0));
  });

  afterEach(() => {
    __resetTooltipEngine();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('public contract', () => {
    it('renders its slot inside the container', () => {
      const w = mountTooltip();
      expect(w.find('.tooltip-container').exists()).toBe(true);
      expect(w.find('#trigger').exists()).toBe(true);
      w.unmount();
    });

    it('shows the text on hover and hides on leave', async () => {
      const w = mountTooltip({ text: 'Delete this item' });
      expect(tooltipEl()).toBeNull();

      await w.trigger('mouseenter');
      expect(tooltipText()).toBe('Delete this item');

      await w.trigger('mouseleave');
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('renders an optional heading', async () => {
      const w = mountTooltip({ text: 'Body', title: 'Heading' });
      await w.trigger('mouseenter');
      expect(document.querySelector('.tooltip-title').textContent).toBe('Heading');
      w.unmount();
    });

    it('honours the position prop', async () => {
      const w = mountTooltip({ position: 'right' });
      await w.trigger('mouseenter');
      expect(tooltipEl().classList.contains('right')).toBe(true);
      w.unmount();
    });

    it('honours the width prop', async () => {
      const w = mountTooltip({ width: '260px' });
      await w.trigger('mouseenter');
      expect(tooltipEl().style.width).toBe('260px');
      w.unmount();
    });

    it('rejects an invalid position at the prop boundary', () => {
      const validator = Tooltip.props.position.validator;
      expect(validator('top')).toBe(true);
      expect(validator('sideways')).toBe(false);
    });

    it('still exposes show and hide for callers that drive it by ref', async () => {
      const w = mountTooltip();
      w.vm.show();
      expect(isTooltipVisible()).toBe(true);
      w.vm.hide();
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });
  });

  describe('disabled', () => {
    it('shows nothing on hover while disabled', async () => {
      const w = mountTooltip({ disabled: true });
      await w.trigger('mouseenter');
      expect(tooltipEl()).toBeNull();
      w.unmount();
    });

    it('retracts a tooltip that is already open when it becomes disabled', async () => {
      // The control that flips the condition is usually the one under the
      // pointer (the sidebar's collapse button expands the rail beneath the
      // cursor), so mouseleave will not fire to clean this up.
      const w = mountTooltip();
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);

      await w.setProps({ disabled: true });
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('does not retract on an unrelated prop change', async () => {
      const w = mountTooltip();
      await w.trigger('mouseenter');
      await w.setProps({ text: 'Delete for good' });
      expect(isTooltipVisible()).toBe(true);
      w.unmount();
    });

    it('works again once re-enabled', async () => {
      const w = mountTooltip({ disabled: true });
      await w.trigger('mouseenter');
      expect(tooltipEl()).toBeNull();

      await w.setProps({ disabled: false });
      await w.trigger('mouseenter');
      expect(tooltipText()).toBe('Delete');
      w.unmount();
    });

    it('defaults to enabled, so no existing call site changes behaviour', async () => {
      expect(Tooltip.props.disabled.default).toBe(false);
      const w = mountTooltip();
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);
      w.unmount();
    });
  });

  describe('bugs this refactor fixed', () => {
    it('shows on keyboard focus of the wrapped control', async () => {
      // `focus` does not bubble, so the old @focus listener on the wrapper
      // never fired and no keyboard user ever saw one of these.
      const w = mountTooltip();
      w.find('#trigger').element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await w.vm.$nextTick();

      expect(tooltipText()).toBe('Delete');
      w.unmount();
    });

    it('hides when focus leaves the wrapped control', async () => {
      const w = mountTooltip();
      const trigger = w.find('#trigger').element;
      trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await w.vm.$nextTick();
      trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await w.vm.$nextTick();

      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('renders nothing for blank text instead of an empty box', async () => {
      const w = mountTooltip({ text: '' });
      await w.trigger('mouseenter');
      expect(tooltipEl()).toBeNull();
      w.unmount();
    });

    it('does not strand its tooltip when unmounted while open', async () => {
      const w = mountTooltip();
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);

      w.unmount();
      expect(isTooltipVisible()).toBe(false);
    });
  });

  describe('single implementation', () => {
    const source = readFileSync(path.resolve('src/views/Terminal/_components/Tooltip.vue'), 'utf8');

    it('delegates to the shared engine rather than positioning its own box', () => {
      expect(source).toContain("from '@/directives/tooltipEngine.js'");
      // A second copy of the geometry here is how the two surfaces drift apart.
      expect(source).not.toMatch(/getBoundingClientRect/);
      expect(source).not.toMatch(/innerWidth/);
    });

    it('does not carry a private copy of the tooltip styling', () => {
      // These rules are global now (styles/components/_tooltip.css) because
      // v-tooltip renders on screens that never import this component.
      const globalStyle = /<style(?![^>]*scoped)[^>]*>([\s\S]*?)<\/style>/.exec(source);
      expect(globalStyle).toBeNull();
    });

    it('keeps the tooltip presentation in the always-loaded stylesheet', () => {
      const css = readFileSync(path.resolve('src/styles/components/_tooltip.css'), 'utf8');
      for (const selector of ['.tooltip', '.tooltip-content', '.tooltip-title', '.tooltip-text', '.tooltip-arrow']) {
        expect(css).toContain(selector);
      }
      const main = readFileSync(path.resolve('src/styles/main.css'), 'utf8');
      expect(main).toContain('_tooltip.css');
    });
  });
});
