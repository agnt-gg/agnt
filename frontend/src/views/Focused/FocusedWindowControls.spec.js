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
// Docs renders outside the frame (its own route), so it carries its own bar.
const DOCS = readFileSync(join(DIR, '../Docs/Docs.vue'), 'utf8');

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
    for (const piece of ['<OneCapsule', '<FocusedWindowControls />']) expect(header).toContain(piece);
    // No conversation title in the bar (removed 2026-10-21).
    expect(header).not.toContain('one-title');
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

  // Reported 2026-10-21: the 8px gutters beside the floating sheet did not
  // drag. Gutters exist only with a custom background; flush, the strip stays
  // 8px, or it would cover the first 9px of every page under the 48px bar.
  it('the top edge drags end to end: the band covers the gutters where there are any', () => {
    expect(CSS).toMatch(/\.ui-one\.has-window-bar::before \{[^}]*left: 0;[^}]*right: 0;[^}]*height: 8px;[^}]*-webkit-app-region: drag;/);
    expect(CSS).toMatch(/body\.custom-bg \.ui-one\.has-window-bar:not\(\.is-compact\)::before \{\s*height: 57px;/);
    expect(CSS).not.toMatch(/^\.ui-one\.has-window-bar:not\(\.is-compact\)::before/m);
  });

  // Reported 2026-10-21: "a weird border and margin": the panel was a sheet
  // set 8px down with a top-left rounded corner, read as pushed off the page.
  it('the panel is flush: no gap above it, no rounded corner, one divider on its left', () => {
    const rule = CSS.match(/\n\.ui-one \.one-main \{([^}]*)\}/)[1];
    expect(rule).not.toMatch(/margin|radius|border-top/);
    expect(rule).toMatch(/border-left: 1px solid var\(--terminal-border-color\);/);
    // The open drawer's own right edge is the divider: never two lines side by side.
    expect(CSS).toMatch(/\.ui-one \.one-drawer \+ \.one-main \{\s*border-left: 0;/);
    const SHELL_TEMPLATE = SHELL.slice(SHELL.indexOf('<FocusedSidebar'), SHELL.indexOf('<main class="focused-main one-main"'));
    // Adjacent on desktop: between the drawer and the panel there is only the
    // phone's scrim, rendered only when isMobile.
    const between = SHELL_TEMPLATE.replace(/<!--[\s\S]*?-->/g, '').slice(SHELL_TEMPLATE.replace(/<!--[\s\S]*?-->/g, '').indexOf('/>') + 2);
    const tags = between.match(/<[a-zA-Z][^>]*>/g) || [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/^<button v-if="isMobile && drawerShown"[^>]*class="focused-scrim"/);
  });

  // Reported 2026-10-21: "min max close from all screens". The Workflow Forge
  // hid the top bar (a page rule hiding every <header>, now refused by
  // styles/globalStyleLeaks.spec.js), and Docs, outside the frame, had no
  // bar at all: no drag, no buttons, no way back.
  it('Docs, outside the frame, has the same bar: drag strip, a way back, the window buttons', () => {
    const bar = DOCS.slice(DOCS.indexOf('class="docs-window-bar"'), DOCS.indexOf('<div class="docs-container"'));
    expect(DOCS).toMatch(/<div v-if="isElectron" class="docs-window-bar"/);
    expect(bar).toContain('<FocusedWindowControls />');
    expect(bar).toMatch(/@click="backToApp"/);
    expect(DOCS).toMatch(/\.docs-window-bar \{[^}]*-webkit-app-region: drag;/);
    expect(DOCS).toMatch(/\.docs-window-bar button \{\s*-webkit-app-region: no-drag;/);
    // The layout starts below the bar instead of under it.
    expect(DOCS).toMatch(/\.docs-container\.below-window-bar \{[^}]*top: 40px;/);
  });
});
