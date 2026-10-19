/**
 * Reported 2026-10-07: in Focused the window could not be dragged, and had no
 * minimize / maximize / close. Studio's toolbar provided both; Focused replaced it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const win = vi.hoisted(() => ({ minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() }));
vi.mock('@/composables/useElectron', async () => {
  const { ref } = await import('vue');
  return { useElectron: () => ({ isElectron: ref(!!globalThis.window?.electron) }), electronUtils: { window: win } };
});

import FocusedWindowControls from './FocusedWindowControls.vue';
const DIR = dirname(fileURLToPath(import.meta.url));
const BAR = readFileSync(join(DIR, 'FocusedWindowControls.vue'), 'utf8');
// The frame these controls sit in: AGNT One's top bar.
const SHELL = readFileSync(join(DIR, '../One/OneShell.vue'), 'utf8');
const CSS = readFileSync(join(DIR, '../One/one.css'), 'utf8');

describe('AGNT One top bar: window drag + window buttons', () => {
  afterEach(() => { delete window.electron; vi.clearAllMocks(); });

  it('desktop: minimize, maximize and close each do their job', async () => {
    window.electron = {};
    const w = mount(FocusedWindowControls);
    const buttons = w.findAll('button');
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Minimize window', 'Maximize window', 'Close window']);
    await buttons[0].trigger('click'); await buttons[1].trigger('click'); await buttons[2].trigger('click');
    expect(win.minimize).toHaveBeenCalledOnce();
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
    w.unmount();
  });

  // Reported 2026-10-09 on a Mac: red alone in the top-right corner, yellow and
  // green at the far left. The red button's bare "close" class met the global
  // button.close rule (absolute, top 0, right 0) and the group had order: -1.
  // Positions are pinned in a real browser by tests/e2e/mac-window-controls.spec.js.
  it('macOS: red, yellow, green, with classes no global rule can catch, never moved left', () => {
    window.electron = {};
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const w = mount(FocusedWindowControls);
      const buttons = w.findAll('button');
      expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Close window', 'Minimize window', 'Maximize window']);
      for (const button of buttons) {
        expect(button.classes()).not.toContain('close');
        expect(button.classes()).not.toContain('min');
        expect(button.classes()).not.toContain('max');
      }
      w.unmount();
    } finally {
      delete navigator.platform; // back to the prototype's own value
    }
    const macRule = BAR.match(/\.focused-window-controls\.mac \{([^}]*)\}/)[1];
    expect(macRule).not.toMatch(/order:/);
    expect(macRule).not.toMatch(/margin(-left)?:\s*0 /);
  });

  it('browser: renders nothing (the browser owns its own window)', () => {
    const w = mount(FocusedWindowControls);
    expect(w.find('[data-testid="focused-window-controls"]').exists()).toBe(false);
    w.unmount();
  });

  // Reported 2026-10-07: "now it's not draggable", and two bars (drag strip
  // + title bar) where there should be one.
  it('one bar: title, capsule and window buttons share the drag area, always rendered', () => {
    expect(SHELL).not.toMatch(/FocusedWindowBar/);
    expect(SHELL).toMatch(/<header class="one-topbar" :class="\{ 'is-window-bar': isElectron \}"/);
    const header = SHELL.slice(SHELL.indexOf('class="one-topbar"'), SHELL.indexOf('</header>'));
    for (const piece of ['one-title', '<OneCapsule', '<FocusedWindowControls />']) expect(header).toContain(piece);
  });

  it('the bar drags like Studio\'s toolbar did (positioned, own stacking order); what you press in it does not', () => {
    expect(CSS).toMatch(/\.ui-one \.one-topbar \{[^}]*position: relative;[^}]*z-index: 50;/);
    expect(CSS).toMatch(/\.one-topbar\.is-window-bar \{\s*-webkit-app-region: drag;/);
    expect(CSS).toMatch(/\.one-topbar\.is-window-bar button,\s*\.ui-one \.one-topbar\.is-window-bar \.one-capsule-anchor \{\s*-webkit-app-region: no-drag;/);
    expect(BAR).toMatch(/\.focused-window-controls \{[^}]*-webkit-app-region: no-drag;/);
    // The rail drags too; its buttons do not.
    expect(CSS).toMatch(/\.has-window-bar \.one-rail \{\s*-webkit-app-region: drag;/);
    expect(CSS).toMatch(/\.has-window-bar \.one-rail-btn \{\s*-webkit-app-region: no-drag;/);
  });
});
