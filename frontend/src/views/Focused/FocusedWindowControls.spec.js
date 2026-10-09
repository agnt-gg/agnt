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
const SHELL = readFileSync(join(DIR, 'FocusedShell.vue'), 'utf8');
const CSS = readFileSync(join(DIR, 'focused.css'), 'utf8');

describe('Focused top bar: window drag + window buttons', () => {
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
  it('one bar: title, sidebar controls and window buttons share the drag area', () => {
    expect(SHELL).not.toMatch(/FocusedWindowBar/);
    expect(SHELL).toMatch(/<header v-if="isElectron \|\| [^"]*" class="focused-topbar"[^>]*'is-window-bar': isElectron/);
    const header = SHELL.slice(SHELL.indexOf('class="focused-topbar"'), SHELL.indexOf('</header>'));
    for (const piece of ['aria-label="Open sidebar"', 'aria-label="New chat"', 'focused-chat-title', '<FocusedWindowControls />']) expect(header).toContain(piece);
  });

  it('the bar drags like Studio\'s toolbar (positioned, own stacking order); its buttons do not', () => {
    expect(CSS).toMatch(/\.focused-topbar\.is-window-bar\.is-window-bar \{[^}]*position: relative;[^}]*z-index: 50;[^}]*-webkit-app-region: drag;/);
    expect(CSS).toMatch(/\.is-window-bar \.focused-icon-btn \{\s*-webkit-app-region: no-drag;/);
    expect(BAR).toMatch(/\.focused-window-controls \{[^}]*-webkit-app-region: no-drag;/);
    expect(CSS).toMatch(/\.has-window-bar \.focused-side-head \{[^}]*-webkit-app-region: drag;/);
    expect(CSS).toMatch(/\.focused-side-head input \{\s*-webkit-app-region: no-drag;/);
  });
});
