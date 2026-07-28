import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { vTooltip } from './tooltip.js';
import { computeTooltipPosition, normalizeTooltipOptions, isTooltipVisible, __resetTooltipEngine } from './tooltipEngine.js';

const tooltipEl = () => document.querySelector('.tooltip');
const tooltipText = () => document.querySelector('.tooltip-text')?.textContent;

function mountWith(template, data = {}) {
  return mount(
    {
      template,
      data: () => ({ ...data }),
    },
    { global: { directives: { tooltip: vTooltip } }, attachTo: document.body }
  );
}

describe('tooltip engine geometry', () => {
  const trigger = { top: 200, bottom: 230, left: 400, right: 500, width: 100, height: 30 };
  const tooltip = { width: 200, height: 60 };
  const viewport = { width: 1000, height: 800 };

  it('centres above the trigger by default', () => {
    const { top, left, arrowOffset } = computeTooltipPosition({ trigger, tooltip, viewport });
    expect(top).toBe(200 - 60 - 12);
    expect(left).toBe(450 - 100);
    expect(arrowOffset).toBe(0);
  });

  it('places below, left and right on request', () => {
    expect(computeTooltipPosition({ trigger, tooltip, viewport, position: 'bottom' }).top).toBe(230 + 12);
    expect(computeTooltipPosition({ trigger, tooltip, viewport, position: 'left' }).left).toBe(400 - 200 - 12);
    expect(computeTooltipPosition({ trigger, tooltip, viewport, position: 'right' }).left).toBe(500 + 12);
  });

  it('clamps to the left edge and slides the arrow to compensate', () => {
    const nearEdge = { ...trigger, left: 0, right: 100 };
    const { left, arrowOffset } = computeTooltipPosition({ trigger: nearEdge, tooltip, viewport });
    expect(left).toBe(10);
    expect(arrowOffset).toBeLessThan(0);
  });

  it('clamps to the right edge and slides the arrow to compensate', () => {
    const nearEdge = { ...trigger, left: 950, right: 1000 };
    const { left, arrowOffset } = computeTooltipPosition({ trigger: nearEdge, tooltip, viewport });
    expect(left).toBe(1000 - 10 - 200);
    expect(arrowOffset).toBeGreaterThan(0);
  });

  it('clamps vertically without moving the arrow sideways', () => {
    const top = { ...trigger, top: 5, bottom: 35 };
    expect(computeTooltipPosition({ trigger: top, tooltip, viewport }).top).toBe(10);
    // A left/right placement slides vertically, so a horizontal arrow offset
    // would point at nothing.
    const offEdge = { ...trigger, left: 0, right: 100 };
    expect(computeTooltipPosition({ trigger: offEdge, tooltip, viewport, position: 'right' }).arrowOffset).toBe(0);
  });
});

describe('tooltip option normalisation', () => {
  it('accepts a bare string', () => {
    expect(normalizeTooltipOptions('Delete')).toMatchObject({ text: 'Delete', position: 'top' });
  });

  it('treats blank, null and undefined as no tooltip', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(normalizeTooltipOptions(value).text).toBe('');
    }
  });

  it('keeps a literal zero, which is a real label', () => {
    expect(normalizeTooltipOptions(0).text).toBe('0');
  });

  it('reads placement from a modifier', () => {
    expect(normalizeTooltipOptions('x', { bottom: true }).position).toBe('bottom');
  });

  it('ignores an unknown placement rather than emitting a broken class', () => {
    expect(normalizeTooltipOptions({ text: 'x', position: 'sideways' }).position).toBe('top');
  });
});

describe('v-tooltip directive', () => {
  beforeEach(() => {
    __resetTooltipEngine();
    vi.stubGlobal('requestAnimationFrame', (cb) => cb(0));
  });

  afterEach(() => {
    __resetTooltipEngine();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('showing', () => {
    it('shows on hover and hides on leave', async () => {
      const w = mountWith(`<button v-tooltip="'Delete'">x</button>`);
      expect(tooltipEl()).toBeNull();

      await w.trigger('mouseenter');
      expect(tooltipText()).toBe('Delete');

      await w.trigger('mouseleave');
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('shows on keyboard focus, which the wrapper component never did', async () => {
      // focus/blur do not bubble; focusin/focusout do. This is the whole bug.
      const w = mountWith(`<button v-tooltip="'Delete'">x</button>`);
      await w.trigger('focusin');
      expect(tooltipText()).toBe('Delete');

      await w.trigger('focusout');
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('never shows an empty box for a blank binding', async () => {
      const w = mountWith(`<button v-tooltip="reason">x</button>`, { reason: '' });
      await w.trigger('mouseenter');
      expect(tooltipEl()).toBeNull();
      w.unmount();
    });

    it('renders text, not markup', async () => {
      const w = mountWith(`<button v-tooltip="evil">x</button>`, { evil: '<img src=x onerror=alert(1)>' });
      await w.trigger('mouseenter');
      expect(document.querySelector('.tooltip img')).toBeNull();
      expect(tooltipText()).toBe('<img src=x onerror=alert(1)>');
      w.unmount();
    });

    it('applies the placement modifier as a class', async () => {
      const w = mountWith(`<button v-tooltip.bottom="'Forward'">x</button>`);
      await w.trigger('mouseenter');
      expect(tooltipEl().classList.contains('bottom')).toBe(true);
      w.unmount();
    });

    it('shows an optional heading only when one is given', async () => {
      const w = mountWith(`<button v-tooltip="{ text: 'Body', title: 'Heading' }">x</button>`);
      await w.trigger('mouseenter');
      expect(document.querySelector('.tooltip-title').textContent).toBe('Heading');
      expect(document.querySelector('.tooltip-title').style.display).not.toBe('none');
      await w.trigger('mouseleave');

      const plain = mountWith(`<button v-tooltip="'Body'">y</button>`);
      await plain.trigger('mouseenter');
      expect(document.querySelector('.tooltip-title').style.display).toBe('none');
      w.unmount();
      plain.unmount();
    });

    it('keeps only one tooltip alive across triggers', async () => {
      const w = mountWith(`<div><button id="a" v-tooltip="'A'">a</button><button id="b" v-tooltip="'B'">b</button></div>`);
      await w.find('#a').trigger('mouseenter');
      await w.find('#b').trigger('mouseenter');

      expect(document.querySelectorAll('.tooltip')).toHaveLength(1);
      expect(tooltipText()).toBe('B');
      w.unmount();
    });
  });

  describe('reactivity', () => {
    it('updates the visible tooltip when the bound value changes', async () => {
      const w = mountWith(`<button v-tooltip="label">x</button>`, { label: 'Pause' });
      await w.trigger('mouseenter');
      expect(tooltipText()).toBe('Pause');

      await w.setData({ label: 'Activate' });
      expect(tooltipText()).toBe('Activate');
      w.unmount();
    });

    it('hides a visible tooltip when the value goes blank', async () => {
      const w = mountWith(`<button v-tooltip="label">x</button>`, { label: 'Reason' });
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);

      await w.setData({ label: '' });
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });
  });

  describe('accessible name', () => {
    // `title` doubles as the accessible name on an icon-only control. Dropping
    // it without replacement would silently unname ~50 buttons in this app.
    it('names an icon-only control that has no other name', async () => {
      const w = mountWith(`<button v-tooltip="'Delete'"><i class="fas fa-trash"></i></button>`);
      expect(w.attributes('aria-label')).toBe('Delete');
      w.unmount();
    });

    it('leaves a control that already has visible text alone', () => {
      const w = mountWith(`<button v-tooltip="'Extra detail'">Save</button>`);
      expect(w.attributes('aria-label')).toBeUndefined();
      w.unmount();
    });

    it('never overwrites an explicit aria-label', () => {
      const w = mountWith(`<button aria-label="Preview sound" v-tooltip="'Preview'"><i></i></button>`);
      expect(w.attributes('aria-label')).toBe('Preview sound');
      w.unmount();
    });

    it('keeps the generated name in sync with the binding', async () => {
      const w = mountWith(`<button v-tooltip="label"><i></i></button>`, { label: 'Pause' });
      expect(w.attributes('aria-label')).toBe('Pause');
      await w.setData({ label: 'Activate' });
      expect(w.attributes('aria-label')).toBe('Activate');
      w.unmount();
    });

    it('describes the trigger while the tooltip is open', async () => {
      const w = mountWith(`<button v-tooltip="'Delete'">x</button>`);
      await w.trigger('mouseenter');
      expect(w.attributes('aria-describedby')).toBe(tooltipEl().id);

      await w.trigger('mouseleave');
      expect(w.attributes('aria-describedby')).toBeUndefined();
      w.unmount();
    });
  });

  describe('lifetime', () => {
    it('takes the tooltip down with the element that owns it', async () => {
      const w = mountWith(`<button v-if="alive" v-tooltip="'Delete'">x</button>`, { alive: true });
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);

      await w.setData({ alive: false });
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('suppresses a native title so the OS tooltip cannot double up', async () => {
      const w = mountWith(`<button title="Old" v-tooltip="'New'">x</button>`);
      expect(w.attributes('title')).toBeUndefined();

      await w.trigger('mouseenter');
      expect(tooltipText()).toBe('New');
      w.unmount();
    });

    it('hides on Escape', async () => {
      const w = mountWith(`<button v-tooltip="'Delete'">x</button>`);
      await w.trigger('mouseenter');
      expect(isTooltipVisible()).toBe(true);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });

    it('hides on scroll, since the box is positioned against the viewport', async () => {
      const w = mountWith(`<button v-tooltip="'Delete'">x</button>`);
      await w.trigger('mouseenter');
      window.dispatchEvent(new Event('scroll'));
      expect(isTooltipVisible()).toBe(false);
      w.unmount();
    });
  });
});
