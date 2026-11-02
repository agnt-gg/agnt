/**
 * Studio is a layout choice again (it was unplugged on 2026-10-18 while every Studio screen, its rail,
 * custom pages and Navigation settings stayed in the code). AGNT One stays the default.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_UI_MODE, resolveUiMode, UI_MODE_LABELS } from '@/services/uiMode.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const terminal = fs.readFileSync(path.join(here, 'Terminal.vue'), 'utf8');

describe('AGNT One or Studio', () => {
  it('One is the default for anyone who has not chosen; a saved Studio choice wins', () => {
    expect(DEFAULT_UI_MODE).toBe('focused');
    expect(resolveUiMode({ explicit: null })).toBe('focused');
    expect(resolveUiMode({ explicit: 'studio' })).toBe('studio');
    expect(UI_MODE_LABELS.focused).toBe('AGNT One');
  });
  it('Terminal mounts Studio\'s canvas frame for studio and One otherwise, and Ctrl+Shift+S switches', () => {
    expect(terminal).toMatch(/frames = \{ focused: markRaw\(OneShell\), studio: markRaw\(CanvasScreen\) \}/);
    expect(terminal).toMatch(/isUiModeToggleKey/);
    // In Studio the full screen always mounts (One's pages only apply in One).
    expect(terminal).toMatch(/isOne\.value && focusedLocation\(/);
  });
});
