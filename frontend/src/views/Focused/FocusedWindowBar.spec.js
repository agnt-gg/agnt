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

import FocusedWindowBar from './FocusedWindowBar.vue';
const DIR = dirname(fileURLToPath(import.meta.url));
const BAR = readFileSync(join(DIR, 'FocusedWindowBar.vue'), 'utf8');
const SHELL = readFileSync(join(DIR, 'FocusedShell.vue'), 'utf8');
const CSS = readFileSync(join(DIR, 'focused.css'), 'utf8');

describe('Focused window bar', () => {
  afterEach(() => { delete window.electron; vi.clearAllMocks(); });

  it('desktop: minimize, maximize and close each do their job', async () => {
    window.electron = {};
    const w = mount(FocusedWindowBar);
    const buttons = w.findAll('button');
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Minimize window', 'Maximize window', 'Close window']);
    await buttons[0].trigger('click'); await buttons[1].trigger('click'); await buttons[2].trigger('click');
    expect(win.minimize).toHaveBeenCalledOnce();
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
    w.unmount();
  });

  it('browser: renders nothing (the browser owns its own window)', () => {
    const w = mount(FocusedWindowBar);
    expect(w.find('[data-testid="focused-window-bar"]').exists()).toBe(false);
    w.unmount();
  });

  it('the strip drags the window, the buttons do not', () => {
    expect(BAR).toMatch(/\.focused-window-bar \{[^}]*-webkit-app-region: drag;/);
    expect(BAR).toMatch(/\.fwb-win, \.fwb-mac \{[^}]*-webkit-app-region: no-drag;/);
  });

  it('the shell mounts it and reserves its height only in the desktop app', () => {
    expect(SHELL).toMatch(/<FocusedWindowBar \/>/);
    expect(SHELL).toMatch(/'has-window-bar': isElectron/);
    expect(CSS).toMatch(/\.ui-focused\.ui-focused\.has-window-bar \{[^}]*padding-top: var\(--focused-window-bar-height\);/);
  });
});
